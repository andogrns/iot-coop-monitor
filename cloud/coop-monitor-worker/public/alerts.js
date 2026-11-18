// Settings tab: "Gas warning alerts" card (global, every device). Server API: GET/PUT /api/alerts,
// POST /api/alerts/test. Validation and message building are shared with the Worker (alert-settings.js),
// so the preview shows what the server sends.
//
//   createAlertsTab({ api, send, current, now }) -> { load({ force }), sync(device) }
import { ALERT_CHANNELS, CHECK_EVERY_MINUTES, TEMPLATE_MAX, TEMPLATE_VARIABLES, buildMessage, checkAlertSettings, defaultAlertSettings, durationText, messageVariables } from './alert-settings.js?v=56c8946ef927';
import { formatDateTime, formatTime, relativeTime } from './format.js?v=0242141ec619';
import { el, notice } from './ui.js?v=c84da061d886';

const $ = id => document.getElementById(id);
const KIND_TEXT = { warning: 'gas warning', reminder: 'reminder', ended: 'end message', offline: 'offline notice', online: 'back-online notice', test: 'test message' };
const SAMPLE = { mqMv: 812, mqThresholdMv: 760, mqRatio: 1.21, ahtTemperatureC: 28.4, humidityPct: 70, status: 'GAS_WARNING' };
const FIELD_INPUT = { discordChannelId: 'alerts-discord-channel', afterMinutes: 'alerts-after', warningTemplate: 'alerts-template', endedTemplate: 'alerts-ended' };
const TEST_COOLDOWN_MS = 10000;
const SETTING_KEYS = Object.keys(defaultAlertSettings());
const comparable = v => typeof v === 'string' ? v.trim() : v;
const same = (a, b) => Boolean(a && b) && SETTING_KEYS.every(k => comparable(a[k]) === comparable(b[k]));

export function createAlertsTab({ api, send, current, now = Date.now }) {
  const form = $('alerts-form'), enabled = $('alerts-enabled'), channel = $('alerts-channel'), channelId = $('alerts-discord-channel');
  const mention = $('alerts-mention'), after = $('alerts-after'), remind = $('alerts-remind'), template = $('alerts-template');
  const sendEnded = $('alerts-send-ended'), ended = $('alerts-ended'), save = $('alerts-save'), discard = $('alerts-discard'), testButton = $('alerts-test');
  let overview = null, saved = null, revision = 0, loading = null, previewKind = 'warning', lastText = template, previewDevice = null, testing = false;

  for (const [id, c] of Object.entries(ALERT_CHANNELS)) { const o = el('option', '', c.name); o.value = id; channel.append(o); }

  // ---- Variable chips: insert {name} at the cursor of the last focused message box ----
  for (const [name, description, example] of TEMPLATE_VARIABLES) {
    const chip = el('button', 'alerts-chip'); chip.type = 'button';
    chip.title = `${description}, e.g. ${example}`;
    chip.setAttribute('aria-label', `Insert {${name}}: ${description}`);
    chip.append(el('code', '', `{${name}}`));
    chip.addEventListener('click', () => insert(`{${name}}`));
    $('alerts-vars').append(chip);
  }
  for (const box of [template, ended]) box.addEventListener('focus', () => { lastText = box; });
  function insert(text) {
    const box = lastText.closest('[hidden]') ? template : lastText;
    const start = box.selectionStart ?? box.value.length, end = box.selectionEnd ?? start;
    box.setRangeText(text, start, end, 'end');
    box.focus(); update();
  }

  // ---- Reading and checking the form ----
  const whole = raw => /^\d+$/.test(String(raw).trim()) ? Number(raw) : NaN;
  const read = () => ({ enabled: enabled.checked, channel: channel.value, discordChannelId: channelId.value, afterMinutes: whole(after.value),
    remindEveryMinutes: Number(remind.value), mention: mention.value, warningTemplate: template.value, sendEnded: sendEnded.checked, endedTemplate: ended.value });

  function setError(id, text, show) {
    const input = $(id), field = input.closest('.field');
    field.classList.toggle('invalid', Boolean(text) && show);
    field.querySelector('.field-error').textContent = show ? text : '';
    input.setAttribute('aria-invalid', String(Boolean(text) && show));
  }

  function update({ showAll = false } = {}) {
    if (!overview) return { valid: false, dirty: false };
    const value = read(), { settings, errors } = checkAlertSettings(value);
    for (const [key, id] of Object.entries(FIELD_INPUT)) {
      const touched = $(id).dataset.touched === '1' || key.endsWith('Template');
      setError(id, errors[key] ?? '', showAll || touched);
    }
    $('alerts-ended-field').hidden = !sendEnded.checked;
    $('alerts-template-count').textContent = `${template.value.length} / ${TEMPLATE_MAX}`;
    $('alerts-ended-count').textContent = `${ended.value.length} / ${TEMPLATE_MAX}`;
    form.classList.toggle('alerts-off', !enabled.checked);
    timing(value);
    preview(value);
    const valid = Boolean(settings), dirty = saved !== null && !same(value, saved);
    save.disabled = !dirty || !valid; discard.disabled = !dirty; $('alerts-dirty').hidden = !dirty;
    const connected = Boolean(overview.channels.find(c => c.id === value.channel)?.connected);
    testButton.disabled = testing || !valid || !connected;
    testButton.title = !testing && valid && !connected ? 'The service is not connected on the server yet.' : '';
    return { settings, errors, valid, dirty };
  }

  function timing(v) {
    const box = $('alerts-timing');
    if (!v.enabled) { box.textContent = 'Alerts are off. No gas warning message is sent.'; return; }
    if (!Number.isSafeInteger(v.afterMinutes)) { box.textContent = 'Enter a wait time to see when a message goes out.'; return; }
    const parts = [`A message goes out once a device has reported a gas warning for ${durationText(v.afterMinutes)} without a break. The server checks every ${CHECK_EVERY_MINUTES} minutes, so it can arrive up to ${CHECK_EVERY_MINUTES} minutes later.`];
    if (v.remindEveryMinutes) parts.push(`While the warning continues, it is repeated every ${v.remindEveryMinutes === 60 ? 'hour' : durationText(v.remindEveryMinutes)}.`);
    parts.push(v.sendEnded ? 'When the warning stops, the end message follows.' : 'Nothing is sent when the warning stops.');
    parts.push('A normal reading, or more than 10 minutes without readings, starts the count again.');
    box.textContent = parts.join(' ');
  }

  // ---- Preview: the exact message text, with Discord time tokens and **bold** shown as Discord would ----
  const dateOnly = ms => formatDateTime(ms).split(',')[0];
  const STYLE = { t: ms => formatTime(ms), T: ms => formatTime(ms, { seconds: true }), f: formatDateTime, F: formatDateTime, d: dateOnly, D: dateOnly, R: ms => relativeTime(ms, now()) };
  function line(text) {
    if (text.startsWith('-# ')) return el('p', 'pv-sub', text.slice(3));
    const p = el('p'), pattern = /<t:(\d+):([tTdDfFR])>|\*\*([^*]+)\*\*|`([^`]+)`|(@everyone|@here)/g;
    let last = 0;
    for (const m of text.matchAll(pattern)) {
      if (m.index > last) p.append(text.slice(last, m.index));
      if (m[1]) p.append(el('span', 'pv-time', STYLE[m[2]](Number(m[1]) * 1000)));
      else if (m[3]) p.append(el('strong', '', m[3]));
      else if (m[4]) p.append(el('code', '', m[4]));
      else p.append(el('span', 'pv-mention', m[5]));
      last = m.index + m[0].length;
    }
    p.append(last < text.length ? text.slice(last) : text ? '' : ' ');
    return p;
  }
  function preview(v) {
    const d = current(), latest = d?.latestReading, time = Date.parse(latest?.estimatedAt ?? '');
    const real = Boolean(latest && Number.isFinite(time));
    const reading = real ? { ...latest, time } : { ...SAMPLE, time: now() };
    const minutes = Number.isSafeInteger(v.afterMinutes) ? v.afterMinutes : 60;
    const device = d ? { deviceId: d.deviceId, label: d.label } : { deviceId: 'coop-monitor-01', label: 'Coop' };
    const vars = messageVariables({ device, reading, since: reading.time - minutes * 60000, afterMinutes: minutes, now: now() });
    const isEnd = previewKind === 'ended';
    const text = buildMessage(isEnd ? v.endedTemplate : v.warningTemplate, vars, { mention: isEnd ? 'none' : v.mention });
    const box = $('alerts-preview');
    box.replaceChildren(...text.split('\n').map(line));
    box.classList.toggle('muted', isEnd && !v.sendEnded);
    $('alerts-preview-note').textContent = (isEnd && !v.sendEnded ? 'The end message is switched off, so this is not sent. ' : '')
      + (real ? `Values from ${d.label}’s latest reading (${formatDateTime(time)}); a real alert uses the readings at that time.` : 'Example values: no reading is available yet.');
    previewDevice = d?.deviceId ?? null;
  }
  const kindButtons = [...document.querySelectorAll('#alerts-preview-kind button')];
  for (const button of kindButtons) button.addEventListener('click', () => {
    previewKind = button.dataset.kind;
    for (const b of kindButtons) { b.classList.toggle('selected', b === button); b.setAttribute('aria-pressed', String(b === button)); }
    update();
  });

  // ---- Delivery status ----
  function renderDelivery() {
    const box = $('alerts-delivery'), selected = overview.channels.find(c => c.id === channel.value) ?? overview.channels[0];
    const d = overview.delivery ?? {}, sentAt = Date.parse(d.lastSentAt ?? ''), errorAt = Date.parse(d.lastError?.at ?? '');
    const failing = Boolean(d.lastError) && (!Number.isFinite(sentAt) || errorAt > sentAt);
    const [tone, title, text] = !selected?.connected
      ? ['danger', `${selected?.name ?? 'The service'} is not connected on the server`, 'Nothing can be sent until the Worker secret DISCORD_BOT_TOKEN is set. Settings can still be saved.']
      : failing
        ? ['danger', 'The last message could not be sent', `${d.lastError.message} (${KIND_TEXT[d.lastError.kind] ?? 'message'}, ${formatDateTime(errorAt)})`]
        : Number.isFinite(sentAt)
          ? ['ok', 'Messages are being delivered', `Last ${KIND_TEXT[d.lastKind] ?? 'message'} sent ${formatDateTime(sentAt)} (${relativeTime(sentAt, now())}).`]
          : ['muted', 'No message sent yet', 'Use “Send test message” to check that messages arrive.'];
    const body = el('div', 'sync-body');
    body.append(el('p', 'sync-title', title), el('p', 'sync-text', text));
    box.className = `sync-status ${tone}`;
    box.replaceChildren(el('span', 'sync-icon', tone === 'ok' ? '✓' : tone === 'danger' ? '!' : '–'), body);
    box.firstChild.setAttribute('aria-hidden', 'true');
  }
  function channelHelp() {
    $('alerts-discord-help').textContent = (overview.serverChannelId ? 'Empty: the channel set on the server (DISCORD_CHANNEL_ID).' : 'Empty: the bot’s server system channel, or its first text channel.')
      + ' To copy an ID in Discord: User Settings › Advanced › Developer Mode on, then right-click the channel › Copy Channel ID.';
    for (const o of channel.options) { const c = overview.channels.find(x => x.id === o.value); if (c) o.textContent = `${c.name}${c.connected ? '' : ' (not connected)'}`; }
  }

  function fill(s) {
    enabled.checked = s.enabled; channel.value = s.channel; channelId.value = s.discordChannelId; mention.value = s.mention; after.value = s.afterMinutes;
    remind.value = String(s.remindEveryMinutes); template.value = s.warningTemplate; sendEnded.checked = s.sendEnded; ended.value = s.endedTemplate;
    for (const id of Object.values(FIELD_INPUT)) delete $(id).dataset.touched;
    saved = { ...s };
    update();
  }

  // ---- Events ----
  form.addEventListener('input', () => update());
  form.addEventListener('change', () => update());
  for (const input of [channelId, after]) input.addEventListener('blur', () => { input.dataset.touched = '1'; update(); });
  for (const b of document.querySelectorAll('.alerts-presets button')) b.addEventListener('click', () => { after.value = b.dataset.minutes; after.dataset.touched = '1'; update(); });
  $('alerts-defaults').addEventListener('click', () => {
    template.value = overview.defaults.warningTemplate; ended.value = overview.defaults.endedTemplate; update();
    notice('Default texts restored. Save to keep them.', 'info');
  });
  discard.addEventListener('click', () => tab.load({ force: true }).then(() => notice('Changes discarded.', 'info'), () => {}));

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const { settings, valid, dirty } = update({ showAll: true });
    if (!valid) { form.querySelector('.field.invalid input, .field.invalid textarea')?.focus(); return; }
    if (!dirty) return;
    save.disabled = true;
    try {
      const result = await send('/api/alerts', 'PUT', { expectedRevision: revision, settings });
      revision = result.revision;
      fill(result.settings);
      notice(result.settings.enabled ? `Alert settings saved. They apply from the next check (within ${CHECK_EVERY_MINUTES} minutes).` : 'Alert settings saved. Gas warning alerts are off.', 'success');
    } catch (err) { notice(err.message, 'error'); update(); }
  });

  testButton.addEventListener('click', async () => {
    const { settings, valid } = update({ showAll: true });
    if (!valid) return;
    const kind = previewKind === 'ended' ? 'ended' : 'warning';
    testing = true; testButton.disabled = true; testButton.textContent = 'Sending…';
    try {
      const result = await send('/api/alerts/test', 'POST', { kind, deviceId: current()?.deviceId, settings });
      notice(`Test ${kind === 'ended' ? 'end' : 'warning'} message sent to ${ALERT_CHANNELS[result.channel]?.name ?? result.channel}. Check that it arrived.`, 'success');
    } catch (err) { notice(err.message, 'error'); }
    finally {
      testButton.textContent = 'Send test message';
      await tab.load().catch(() => {}); // refresh the delivery status
      setTimeout(() => { testing = false; update(); }, TEST_COOLDOWN_MS);
    }
  });

  const tab = {
    // Unsaved edits are kept unless force is set; the delivery status always refreshes.
    load({ force = false } = {}) {
      loading ??= (async () => {
        try {
          const result = await api('/api/alerts');
          const editing = !force && saved !== null && !same(read(), saved);
          overview = result;
          channelHelp();
          // While editing, keep the revision the form was based on, so a change made elsewhere is reported on save.
          if (editing) update(); else { revision = result.revision; fill(result.settings); }
          renderDelivery();
          $('alerts-loading').hidden = true; form.hidden = false;
        } catch (err) {
          if (!overview) $('alerts-loading').textContent = `Could not load alert settings (${err.message}).`;
          throw err;
        } finally { loading = null; }
      })();
      return loading;
    },
    // Called on every snapshot: the preview follows a device switch.
    sync(d) { if (overview && (d?.deviceId ?? null) !== previewDevice) update(); },
  };
  return tab;
}
