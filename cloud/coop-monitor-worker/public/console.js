// Console and Settings tabs (stage 2). DOM only, CSP-safe: no innerHTML; device text goes in textContent.
//
//   createConsoleTab({ send, current, connection, reload, now }) -> { render(consolePayload), sync(device) }
//   createSettingsTab({ send, current, connection, reload }) -> { fill(device), status(device) }
//
// app.js keeps the shared state (logCursor, formDevice) and decides when these run.
import { formatDateTime, formatNumber } from './format.js?v=0242141ec619';
import { badge, confirmDialog, el, emptyState, notice, setRelativeTime } from './ui.js?v=c84da061d886';

const $ = id => document.getElementById(id);

// Descriptions follow firmware/coop_monitor/README.md (dashboard command table, calibration section).
export const COMMANDS = {
  CAL_SHOW: { name: 'Show calibration', group: 'check', text: 'Reports the saved calibration baseline and threshold values. Changes nothing.' },
  NET_STATUS: { name: 'Network status', group: 'check', text: 'Reports the Wi-Fi link, upload state, readings waiting to upload and any dropped. No passwords are shown.' },
  CONFIG_SHOW: { name: 'Show applied settings', group: 'check', text: 'Reports the monitoring settings the device is actually using, with their revision.' },
  CAL_EXPORT: { name: 'Export calibration record', group: 'check', text: 'Returns the saved calibration profile as a record you can keep as a backup.' },
  HELP: { name: 'List commands', group: 'check', text: 'Returns the list of commands the device accepts.' },
  CAL_START: { name: 'Start calibration', group: 'calibration', text: 'Measures a new clean-air baseline: about 10 minutes settling, then 5 minutes measuring. Gas warnings are paused meanwhile.' },
  CAL_CANCEL: { name: 'Cancel calibration', group: 'calibration', text: 'Stops a calibration in progress. The previous calibration is kept.' },
  NET_RECONNECT: { name: 'Reconnect Wi-Fi', group: 'disruptive', text: 'Drops and re-joins Wi-Fi. Uploads stop until the link is back.' },
  RESTART: { name: 'Restart device', group: 'disruptive', text: 'Reboots the monitor. Uploads stop briefly and gas warnings are paused for about 10 minutes while the sensor warms up.' },
  // MicroSD backup (firmware/coop_monitor/sd_backup.h). The card is an extra copy; cloud uploads never depend on it.
  SD_STATUS: { name: 'SD card status', group: 'storage', text: 'Reports whether the backup card is mounted, the current file and its size, data still waiting in RAM, write or verify errors and seconds since the last write. Changes nothing.' },
  SD_TAIL: { name: 'Show newest card lines', group: 'storage', text: 'Returns the newest complete lines written to the card this boot (about 300 characters), to check that the backup is being written. Changes nothing.' },
  SD_FLUSH: { name: 'Write to card now', group: 'storage', text: 'Writes buffered readings to the card now instead of at the next scheduled write (every 15 minutes, or sooner when the buffer fills). Only whole 512-byte blocks are written; the rest waits in RAM.' },
  SD_MOUNT: { name: 'Mount card', group: 'storage', text: 'Mounts the card after an eject or a card swap and starts a new backup file. The device also retries on its own every few minutes.' },
  SD_EJECT: { name: 'Eject card', group: 'storage', danger: true, text: 'Writes everything still in RAM, then unmounts the card so it can be removed safely. SD backup stays paused until “Mount card”.' },
};
const GROUPS = [['check', 'Check', 'Read-only reports'], ['calibration', 'Calibration', ''], ['storage', 'SD card backup', 'Extra copy on the device; uploads are not affected'], ['disruptive', 'Disruptive', 'Interrupts monitoring briefly']];

// Remote SD commands first shipped in firmware cloudflare-1.2.0; older firmware ignores them and they expire.
export const SD_COMMANDS_FIRMWARE = 'cloudflare-1.2.0';
export function supportsSdCommands(version) {
  const parse = v => /^cloudflare-(\d+)\.(\d+)\.(\d+)$/.exec(String(v ?? ''))?.slice(1).map(Number);
  const have = parse(version), need = parse(SD_COMMANDS_FIRMWARE);
  if (!have) return false;
  for (let i = 0; i < 3; i++) if (have[i] !== need[i]) return have[i] > need[i];
  return true;
}

const STATUS = {
  queued: ['Queued', 'info', 'Waiting for the device to pick it up. It expires after 60 seconds if the device does not start it.'],
  accepted: ['Accepted', 'info', 'The device has received the command and will run it.'],
  running: ['Running', 'info', 'The device is running the command.'],
  completed: ['Completed', 'ok', 'The device reported that the command finished.'],
  failed: ['Failed', 'danger', 'The device reported that the command failed. See its message below.'],
  expired: ['Expired', 'muted', 'The device did not pick it up within 60 seconds, so it was not run.'],
  uncertain: ['Uncertain', 'warn', 'The device restarted before confirming the result, so it is unknown whether the command finished. It was not repeated.'],
};

const LOG_CAP = 30000;

export function createConsoleTab({ send, current, connection, reload, now = Date.now }) {
  const form = $('command-form'), select = $('command'), picker = $('command-picker'), submit = $('command-send');
  const logs = $('logs'), commandsList = $('commands');
  let commandSignature = '', filter = 'all', sdSupported = null;
  const storageNote = el('p', 'command-group-note');

  // ---- Command picker: described radio cards, the hidden <select id="command"> holds the token ----
  for (const [group, title, hint] of GROUPS) {
    const set = el('fieldset', `command-group ${group}`), legend = el('legend', 'section-title', title);
    if (hint) legend.append(el('span', 'command-group-hint', ` · ${hint}`));
    set.append(legend);
    for (const [type, c] of Object.entries(COMMANDS).filter(([, c]) => c.group === group)) {
      const label = el('label', 'command-option'), radio = el('input'), body = el('span', 'command-option-body'), head = el('span', 'command-option-head');
      radio.type = 'radio'; radio.name = 'command-choice'; radio.value = type; radio.checked = select.value === type;
      head.append(el('span', 'command-option-name', c.name), el('code', 'command-token', type));
      body.append(head, el('span', 'command-option-text', c.text));
      label.append(radio, body);
      radio.addEventListener('change', () => { select.value = type; update(); });
      set.append(label);
    }
    if (group === 'storage') { storageNote.hidden = true; set.append(storageNote); }
    picker.append(set);
  }
  function update() {
    const type = select.value, c = COMMANDS[type];
    $('cal-confirm-label').hidden = type !== 'CAL_START';
    submit.textContent = `Send “${c.name}”`;
    submit.className = c.group === 'disruptive' || c.danger ? 'danger' : 'primary';
  }
  // SD cards are offered only when the device's reported firmware can run them.
  function syncStorage(d) {
    const version = d?.state?.firmwareVersion, supported = supportsSdCommands(version), key = `${supported}|${version ?? ''}`;
    if (key === sdSupported) return;
    sdSupported = key;
    for (const radio of picker.querySelectorAll('input[name="command-choice"]')) if (COMMANDS[radio.value]?.group === 'storage') radio.disabled = !supported;
    storageNote.hidden = supported;
    storageNote.textContent = supported ? '' : `Needs firmware ${SD_COMMANDS_FIRMWARE} or newer. This device reports ${version && version !== 'unknown' ? version : 'no firmware version yet'}.`;
    if (!supported && COMMANDS[select.value]?.group === 'storage') {
      select.value = 'CAL_SHOW';
      const first = picker.querySelector('input[value="CAL_SHOW"]'); if (first) first.checked = true;
      update();
    }
  }
  update();

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const d = current(); if (!d) return;
    const type = select.value, c = COMMANDS[type];
    if (c.group === 'storage' && !supportsSdCommands(d.state?.firmwareVersion)) { notice(`SD card commands need firmware ${SD_COMMANDS_FIRMWARE} or newer.`, 'error'); return; }
    if (type === 'CAL_START' && !$('cal-confirm').checked) {
      $('cal-confirm-label').classList.add('invalid'); $('cal-confirm-error').textContent = 'Tick this box to confirm the reference conditions first.'; $('cal-confirm').focus(); return;
    }
    const dialogs = {
      RESTART: { title: `Restart ${d.label}?`, body: ['The monitor reboots. Readings and uploads stop for a short time, then the gas sensor warms up again: gas warnings are paused for about 10 minutes.', 'Any other command still in progress is interrupted and not repeated.'], confirmLabel: 'Restart device', tone: 'danger' },
      NET_RECONNECT: { title: `Reconnect ${d.label} to Wi-Fi?`, body: ['The monitor drops its Wi-Fi link and joins again. Uploads stop until the link is back; readings taken meanwhile wait in the device’s small upload queue.', 'If Wi-Fi cannot be re-joined, the device stays offline until it can.'], confirmLabel: 'Reconnect Wi-Fi', tone: 'danger' },
      SD_EJECT: { title: `Eject the SD card in ${d.label}?`, body: ['The device writes everything still in RAM to the card, then unmounts it. It is then safe to remove the card.', 'SD backup stays paused until you send “Mount card” (or the device restarts). Readings taken meanwhile are uploaded as usual but are not copied to the card.'], confirmLabel: 'Eject card', tone: 'danger' },
      CAL_START: { title: 'Start calibration?', body: ['The monitor measures a new clean-air baseline: about 10 minutes for the sensor to settle, then 5 minutes of measuring every 2 seconds. Gas warnings are paused for the whole time.', 'Keep the sensor in the known clean reference air, away from exhaust, smoke, alcohol and cleaners. The temperature/humidity sensor must be working.', 'If it succeeds, the new baseline replaces the stored calibration and the automatic warning threshold changes. If it fails or is cancelled, the previous calibration is kept.'], confirmLabel: 'Start calibration' },
    };
    if (dialogs[type] && !await confirmDialog(dialogs[type])) return;
    submit.disabled = true;
    try {
      const args = type === 'CAL_START' ? { referenceConditionsConfirmed: $('cal-confirm').checked } : {};
      await send(`/api/devices/${d.deviceId}/commands`, 'POST', { type, args, ttlSec: 60 });
      notice(`${c.name} queued.`, 'success');
      if (type === 'CAL_START') $('cal-confirm').checked = false;
      await reload();
    } catch (err) { notice(err.message, 'error'); }
    finally { submit.disabled = false; }
  });
  $('cal-confirm').addEventListener('change', () => { $('cal-confirm-label').classList.remove('invalid'); $('cal-confirm-error').textContent = ''; });

  // ---- Logs: black box, white mono; filter is a class on the box ----
  const filterButtons = [...document.querySelectorAll('#log-filter button')];
  for (const button of filterButtons) button.addEventListener('click', () => {
    filter = button.dataset.filter;
    for (const b of filterButtons) { b.classList.toggle('selected', b === button); b.setAttribute('aria-pressed', String(b === button)); }
    logs.classList.toggle('only-problems', filter === 'problems');
    logsEmpty(); logs.scrollTop = logs.scrollHeight;
  });
  function logsEmpty() {
    const lines = logs.querySelectorAll('.log-line'), visible = filter === 'all' ? lines.length : logs.querySelectorAll('.log-line.warn, .log-line.error').length;
    let note = logs.querySelector('.log-empty');
    if (visible) { note?.remove(); return; }
    note ??= el('div', 'log-empty');
    note.textContent = lines.length ? 'No warnings or errors in the last 24 hours.' : 'No log lines in the last 24 hours.';
    logs.prepend(note);
  }
  function appendLogs(list) {
    const stick = logs.scrollHeight - logs.scrollTop - logs.clientHeight < 32 || !logs.querySelector('.log-line');
    const fragment = document.createDocumentFragment();
    for (const x of list) {
      const level = String(x.level ?? 'info').toLowerCase(), line = el('div', `log-line ${level}`), when = x.sampled_at ?? x.received_at;
      line.append(el('span', 'log-time', formatDateTime(when)), el('span', 'log-level', level.toUpperCase().padEnd(5)), el('span', 'log-message', x.message));
      if (!x.sampled_at) line.title = 'Device clock unknown: time the server received it';
      line.dataset.length = String(line.textContent.length + 1);
      fragment.append(line);
    }
    logs.append(fragment);
    // Same cap as before: keep about the newest 30,000 characters.
    let total = 0; const lines = [...logs.querySelectorAll('.log-line')];
    for (const line of lines) total += Number(line.dataset.length);
    for (const line of lines) { if (total <= LOG_CAP) break; total -= Number(line.dataset.length); line.remove(); }
    if (stick) logs.scrollTop = logs.scrollHeight;
  }

  // ---- Command history ----
  // The backend marks overdue queued commands expired only during maintenance; show them as expired already.
  const effective = c => c.status === 'queued' && Date.parse(c.expires_at) < now() ? 'expired' : c.status;
  function renderCommands(list) {
    const signature = JSON.stringify(list.map(c => [c.id, effective(c), c.updated_at, c.result?.message]));
    if (signature === commandSignature) return;
    commandSignature = signature;
    if (!list.length) { commandsList.replaceChildren(emptyState('No commands sent yet', 'Commands you send to this device, and its replies, appear here.')); return; }
    commandsList.replaceChildren(...list.map(c => {
      const item = el('li', 'command-item'), head = el('div', 'command-item-head'), name = el('span', 'command-item-name');
      const status = effective(c), [label, tone, tip] = STATUS[status] ?? [status, 'muted', `Status reported: ${status}`];
      name.append(el('strong', '', COMMANDS[c.type]?.name ?? c.type), el('code', 'command-token', c.type));
      const time = el('span', 'command-item-time small');
      setRelativeTime(time, c.created_at, rel => `Sent ${rel}`);
      time.title = `Sent ${formatDateTime(c.created_at)}${c.updated_at && c.updated_at !== c.created_at ? `\nLast update ${formatDateTime(c.updated_at)}` : ''}`;
      head.append(name, badge(label, tone, tip), time);
      item.append(head);
      if (c.result?.message) item.append(el('pre', 'command-result', c.result.message));
      return item;
    }));
  }

  return {
    render(l) {
      if (l.logs?.length) appendLogs(l.logs);
      logsEmpty();
      renderCommands(l.commands ?? []);
    },
    // Called from render() on every snapshot: offline hint, and the empty-log note after a device switch.
    sync(d) {
      const c = connection(d), hint = $('command-offline');
      hint.hidden = !(c.never || d?.stale);
      syncStorage(d);
      hint.textContent = c.never ? 'This device has never connected. A command waits 60 seconds and then expires.' : 'Device is offline. The command waits 60 seconds and then expires.';
      const id = d?.deviceId ?? '';
      if (logs.dataset.device !== id) { logs.dataset.device = id; commandSignature = ''; commandsList.replaceChildren(); }
      if (!logs.querySelector('.log-line')) logsEmpty();
    },
  };
}

// ---------------------------------------------------------------------------------------------
const LIMITS = { manualThresholdMv: [10, 2399], warningConsecutiveSamples: [1, 10], samplingIntervalSec: [2, 60] };
const intIn = (raw, [min, max]) => { const s = String(raw).trim(); if (!/^\d+$/.test(s)) return null; const n = Number(s); return n >= min && n <= max ? n : null; };

export function createSettingsTab({ send, current, connection, reload }) {
  const form = $('settings-form'), mode = $('threshold-mode'), manual = $('manual-threshold'), consecutive = $('consecutive'), interval = $('sample-interval');
  const save = $('settings-save'), discard = $('settings-discard'), dirtyBadge = $('settings-dirty');
  let saved = null, statusSignature = '';

  function read() {
    const m = mode.value, mv = intIn(manual.value, LIMITS.manualThresholdMv);
    return {
      value: { mqThresholdMode: m, manualThresholdMv: mv, warningConsecutiveSamples: intIn(consecutive.value, LIMITS.warningConsecutiveSamples), samplingIntervalSec: intIn(interval.value, LIMITS.samplingIntervalSec) },
      errors: {
        manual: m === 'manual' && mv === null ? (manual.value.trim() ? 'Enter a whole number from 10 to 2399 mV.' : 'Manual mode needs a threshold.') : '',
        consecutive: intIn(consecutive.value, LIMITS.warningConsecutiveSamples) === null ? 'Enter a whole number from 1 to 10.' : '',
        interval: intIn(interval.value, LIMITS.samplingIntervalSec) === null ? 'Enter a whole number of seconds from 2 to 60.' : '',
      },
    };
  }
  const same = (a, b) => a && b && a.mqThresholdMode === b.mqThresholdMode && a.warningConsecutiveSamples === b.warningConsecutiveSamples && a.samplingIntervalSec === b.samplingIntervalSec
    && (a.mqThresholdMode === 'automatic' || a.manualThresholdMv === b.manualThresholdMv);

  function setError(input, text, show) {
    const field = input.closest('.field');
    field.classList.toggle('invalid', Boolean(text) && show);
    field.querySelector('.field-error').textContent = show ? text : '';
    input.setAttribute('aria-invalid', String(Boolean(text) && show));
  }

  function update({ showAll = false } = {}) {
    const { value, errors } = read(), d = current(), isManual = mode.value === 'manual';
    for (const radio of form.querySelectorAll('input[name="threshold-choice"]')) {
      radio.checked = radio.value === mode.value;
      radio.closest('.choice-card').classList.toggle('selected', radio.checked);
    }
    $('manual-field').hidden = !isManual; manual.disabled = !isManual; manual.required = isManual;
    setError(manual, errors.manual, showAll || manual.dataset.touched === '1');
    setError(consecutive, errors.consecutive, true);
    setError(interval, errors.interval, true);
    // Manual threshold relative to the current calibration baseline.
    const c = d?.state?.calibrated === true ? d.state.calibration : null, helper = $('manual-relative');
    if (isManual && value.manualThresholdMv !== null && c?.baselineMv > 0) {
      const ratio = value.manualThresholdMv / c.baselineMv;
      helper.textContent = `= ${formatNumber(ratio, { digits: 2, minDigits: 2 })}× baseline (${formatNumber(c.baselineMv, { digits: 1 })} mV).`
        + (ratio <= 1 ? ' This is at or below the baseline, so the device would warn in clean air.' : '')
        + (Number.isFinite(c.thresholdMv) ? ` Automatic would use ${formatNumber(c.thresholdMv, { digits: 1 })} mV.` : '');
    } else helper.textContent = isManual && !c ? 'No calibration reported yet, so this cannot be compared with a baseline.' : '';
    helper.hidden = !helper.textContent;
    // Live warning-time sentence.
    const n = value.warningConsecutiveSamples, s = value.samplingIntervalSec;
    $('confirmation-time').textContent = n && s
      ? `A warning needs ${n} ${n === 1 ? 'reading' : 'readings in a row'} above the threshold: about ${formatNumber(n * s, { digits: 0 })} seconds.`
      : 'Enter valid values for both timing fields to see how long a warning takes.';
    const valid = !Object.values(errors).some(Boolean), dirty = saved !== null && !same(value, saved);
    save.disabled = !dirty || !valid; discard.disabled = !dirty; dirtyBadge.hidden = !dirty;
    return { value, valid, dirty };
  }

  for (const radio of form.querySelectorAll('input[name="threshold-choice"]')) radio.addEventListener('change', () => {
    mode.value = radio.value; update();
    if (radio.value === 'manual' && !manual.value) manual.focus();
  });
  manual.addEventListener('blur', () => { manual.dataset.touched = '1'; update(); });
  form.addEventListener('input', () => update());
  discard.addEventListener('click', () => { const d = current(); if (d) { api.fill(d); notice('Changes discarded.', 'info'); } });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const d = current(); if (!d) return;
    const { value, valid, dirty } = update({ showAll: true });
    if (!valid) { form.querySelector('.field.invalid input')?.focus(); return; }
    if (!dirty) return;
    save.disabled = true;
    try {
      // Keep a valid manual value in automatic mode so it is remembered for later; otherwise null.
      const settings = { mqThresholdMode: value.mqThresholdMode, manualThresholdMv: value.manualThresholdMv, warningConsecutiveSamples: value.warningConsecutiveSamples, samplingIntervalSec: value.samplingIntervalSec };
      const result = await send(`/api/devices/${d.deviceId}/config`, 'PUT', { expectedRevision: d.desiredConfig.revision, settings });
      saved = { ...result.settings ?? settings };
      notice(connection(d).never || d.stale ? 'Settings saved. The device applies them when it reconnects.' : 'Settings saved. The device applies them on its next check-in.', 'success');
      update();
      await reload();
    } catch (err) { notice(err.message, 'error'); update(); }
  });

  const api = {
    fill(d) {
      const c = d.desiredConfig.settings;
      mode.value = c.mqThresholdMode; manual.value = c.manualThresholdMv ?? ''; consecutive.value = c.warningConsecutiveSamples; interval.value = c.samplingIntervalSec;
      delete manual.dataset.touched;
      saved = { ...c };
      update();
    },
    status(d) {
      const desired = d.desiredConfig.revision, applied = d.state?.appliedConfigRevision, status = d.state?.configStatus, c = connection(d);
      const [tone, title, text] = !d.state
        ? ['muted', 'Not confirmed yet', 'This device has never connected. It applies these settings on its first check-in.']
        : status === 'failed'
          ? ['danger', 'The device could not apply these settings', d.state.configError || 'No reason was reported.']
          : applied === desired
            ? ['ok', 'Active on the device', d.stale ? 'Last confirmed before the device went offline.' : 'The device reported that it is using these settings.']
            : ['info', 'Saved — waiting for the device to apply', d.stale ? 'The device is offline; it will apply them when it reconnects.' : 'This usually takes a few seconds.'];
      const revisions = `Saved revision ${desired} · device reports revision ${applied ?? 'none'}`;
      const signature = [tone, title, text, revisions].join('|');
      if (signature === statusSignature) { if (saved) update(); return; }
      statusSignature = signature;
      const box = $('config-status'), body = el('div', 'sync-body');
      box.className = `sync-status ${tone}`;
      body.append(el('p', 'sync-title', title), el('p', 'sync-text', text), el('p', 'sync-meta', revisions));
      box.replaceChildren(el('span', 'sync-icon', tone === 'ok' ? '✓' : tone === 'danger' ? '!' : tone === 'info' ? '…' : '–'), body);
      box.firstChild.setAttribute('aria-hidden', 'true');
      if (saved) update(); // calibration helper may have new data
    },
  };
  return api;
}
