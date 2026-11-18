import { createHistoryExport } from './history-export.js?v=bbaff202f06f';
import { METRICS, createTrends } from './trends.js?v=8ebf1b0bab53';
import { createManualArchives } from './manual-archive.js?v=42f0aa27fd9a';
import { createArchiveLibrary } from './archive-library.js?v=ac6e99daf55f';
import { createHistorySelection } from './history-selection.js?v=08b600a0173d';
import { describeStatus, formatBytes, formatDateTime, formatNumber, hasStatus } from './format.js?v=0242141ec619';
import { formatDate, formatTime } from './format.js?v=0242141ec619';
import { badge, banner, clearRelativeTime, confirmDialog, el, emptyState, notice, setClock, setRelativeTime } from './ui.js?v=c84da061d886';
import { createConsoleTab, createSettingsTab } from './console.js?v=589f5fe5d83c';
import { createAlertsTab } from './alerts.js?v=4e5e1dd39dd2';

// ===== Shared state, API and helpers =====
const $ = id => document.getElementById(id);
let snapshot, active = 'overview', historyCursor = null, logCursor = null, selected = '', formDevice = '', allReadings = [], historyRequest = 0;
let serverOffset = 0, refreshPending = false, tabOpened = false;
let historyLatest = true, historyRange = null;
const TABS = ['overview', 'history', 'console', 'settings', 'archives'];
const serverNow = () => Date.now() + serverOffset;
setClock(serverNow);
const trends = createTrends({
  api, current, now: serverNow,
  isVisible: () => active === 'overview' && !$('dashboard').hidden && !document.hidden,
  onData: () => { const d = current(); if (d) renderTiles(d); },
});
const pageHeadings = {
  overview: ['Overview', 'How your coop is doing right now.'],
  history: ['History', 'Browse past readings and download them as CSV.'],
  console: ['Device console', 'Send commands to the monitor and read its messages.'],
  settings: ['Settings', 'Warning, sampling and alert settings.'],
  archives: ['Archives', 'Download older readings and keep finished experiments together.'],
};

async function api(path, options = {}) {
  const r = await fetch(path, { ...options, headers: { 'content-type': 'application/json', ...options.headers } });
  const v = await r.json();
  if (!r.ok) { if (r.status === 401) showLogin(); throw Error(v.message ?? v.error); }
  return v;
}
const send = (path, method, value) => api(path, { method, body: JSON.stringify(value) });
function current() { return snapshot?.devices.find(d => d.deviceId === selected); }
function format(v, unit = '') { return v === null || v === undefined ? '—' : `${Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}${unit}`; }
function date(v) { return v ? formatDateTime(v) : 'UTC unknown'; }
function localInput(d) { return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }
$('from').value = localInput(new Date(Date.now() - 3600000)); $('to').value = localInput(new Date());
const manualArchives = createManualArchives({ api, send, deviceId: () => selected, reload: () => loadArchives(true), refresh, notice });
const historySelection = createHistorySelection({ api, deviceId: () => selected });
const historyExport = createHistoryExport({ api, deviceId: () => selected });
const archiveLibrary = createArchiveLibrary({ api, deviceId: () => selected, continueArchive: job => manualArchives.continueArchive(job), onUnauthorized: showLogin });

// ===== Page shell: sign-in, tabs, device status, banners =====
function setShell(signedIn) {
  $('loading').hidden = true;
  $('login').hidden = signedIn;
  for (const id of ['dashboard', 'logout', 'navigation', 'device-area']) $(id).hidden = !signedIn;
}
function showLogin() {
  setShell(false); tabOpened = false;
  trends.stop(true); historySelection.reset(); historyExport.reset(); archiveLibrary.reset();
  $('banners').replaceChildren(); bannerSignature = '';
  $('owner-key').focus();
}
function showDashboard() { setShell(true); }

const tabFromHash = () => { const name = location.hash.slice(1); return TABS.includes(name) ? name : 'overview'; };
function applyTab(name) {
  active = name;
  document.querySelectorAll('.tab').forEach(s => s.hidden = s.id !== active);
  document.querySelectorAll('[data-tab]').forEach(link => {
    if (link.dataset.tab === active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
  });
  $('page-title').textContent = pageHeadings[active][0];
  $('page-description').textContent = pageHeadings[active][1];
  document.title = active === 'overview' ? 'Coop Monitor' : `${pageHeadings[active][0]} · Coop Monitor`;
}
async function openTab(name) {
  applyTab(name); tabOpened = true;
  if (active === 'overview') { render(); trends.draw(); } else trends.stop();
  try {
    if (active === 'settings') alertsTab.load().catch(e => notice(e.message, 'error')); // global, not per device
    if (!current()) return;
    if (active === 'history') { historySelection.countSelection(); await loadHistory(true, true); }
    if (active === 'settings') fillSettings(current());
    if (active === 'console') await loadConsole();
    if (active === 'archives') { await loadArchives(true); await manualArchives.countSelection(); }
  } catch (e) { notice(e.message, 'error'); }
}
window.addEventListener('hashchange', () => {
  const name = tabFromHash();
  if ($('dashboard').hidden) applyTab(name); else if (name !== active || !tabOpened) openTab(name);
});

function renderDevicePicker() {
  const devices = snapshot?.devices ?? [], single = devices.length <= 1;
  $('device').hidden = single; $('device-name').hidden = !single;
  $('device-name').textContent = devices[0]?.label ?? 'No device';
}

function connection(d) {
  if (!d) return { text: 'No device', tone: 'muted' };
  if (!d.state && !d.latestReading) return { text: 'Never connected', tone: 'muted', never: true };
  if (d.stale) return { text: 'Offline', tone: 'warn' };
  return { text: 'Connected', tone: 'ok' };
}
const latestStatus = d => d?.latestReading?.status ?? d?.state?.status ?? null;
const readingAt = r => r ? (r.sampledAt ?? r.estimatedAt) : null;

function renderDeviceStatus(d) {
  const c = connection(d), conn = $('connection-badge'), cond = $('condition-badge'), last = $('last-reading');
  conn.className = `badge dot ${c.tone}`; conn.textContent = c.text;
  conn.title = d?.state?.receivedAt ? `Last contact ${formatDateTime(d.state.receivedAt)}` : '';
  const raw = latestStatus(d);
  if (!d || c.never || !raw) cond.hidden = true;
  else {
    const s = describeStatus(raw);
    cond.hidden = false;
    cond.className = `badge ${d.stale ? 'muted' : s.tone}`;
    cond.textContent = d.stale ? `Last known: ${s.label}` : s.label;
    cond.title = `${s.detail}\nFirmware status: ${raw}`;
  }
  const seen = d?.state?.receivedAt ?? readingAt(d?.latestReading);
  if (!d || c.never || !seen) { clearRelativeTime(last); last.textContent = !d ? '' : c.never ? 'Waiting for its first upload' : 'No readings yet'; }
  else if (d.stale) setRelativeTime(last, seen, rel => `Last seen ${rel}`);
  else setRelativeTime(last, readingAt(d.latestReading) ?? seen, rel => `Last reading ${rel}`);
}

let bannerSignature = '';
function renderBanners(d) {
  const list = [];
  if (d) {
    const r = d.latestReading, cap = snapshot?.capacity;
    if (hasStatus(latestStatus(d), 'GAS_WARNING')) {
      const mv = formatNumber(r?.mqMv, { digits: 1, unit: 'mV' }), threshold = formatNumber(r?.mqThresholdMv, { digits: 1, unit: 'mV' });
      if (!d.stale) list.push({ tone: 'danger', title: `Gas warning — ${d.label}`,
        text: `Gas response is ${mv}, above the warning threshold of ${threshold}. This is a relative MQ-135 sensor response, not an ammonia ppm value.` });
      else list.push({ tone: 'warn', title: `${d.label} is offline — its last reading was a gas warning`,
        text: `At ${formatDateTime(readingAt(r))} gas response was ${mv}, above the ${threshold} threshold. The current condition is unknown until the device reconnects.` });
    }
    if (d.writesPaused) list.push({ tone: 'warn', title: 'Uploads are paused',
      text: `New readings from ${d.label} are not being recorded in the cloud.`, actionLabel: 'Resume uploads', onAction: () => setUploadsPaused(false) });
    else if (cap?.paused) list.push({ tone: 'warn', title: 'Uploads are paused because storage is nearly full',
      text: `New readings are not being recorded in the cloud${cap.reasons?.length ? ` (${cap.reasons.join(', ')})` : ''}. Archive older readings to free space.` });
  }
  // Rebuild only when the content changes, so alerts are not re-announced every poll.
  const signature = JSON.stringify(list.map(({ onAction, ...b }) => b));
  if (signature === bannerSignature) return;
  bannerSignature = signature;
  $('banners').replaceChildren(...list.map(banner));
}

async function setUploadsPaused(paused) {
  const d = current(); if (!d) return;
  if (paused && !await confirmDialog({
    title: 'Pause uploads?',
    body: [`${d.label} will keep measuring, but new readings are not recorded in the cloud while uploads are paused.`, 'History may have a gap for this period. You can resume at any time.'],
    confirmLabel: 'Pause uploads', tone: 'danger',
  })) return;
  try {
    await send(`/api/devices/${d.deviceId}/uploads`, 'PUT', { paused });
    notice(paused ? 'Uploads paused.' : 'Uploads resumed.', 'success');
    await refresh();
  } catch (e) { notice(e.message, 'error'); }
}

// ===== Overview tab =====
const WARNING_GUARDS = ['WARMUP', 'CAL_STABILIZING', 'CAL_COLLECTING', 'CAL_MISSING', 'AHT_ERROR', 'BMP_ERROR', 'MQ_ADC_HIGH'];
function renderTiles(d) {
  const r = d.latestReading, raw = latestStatus(d), status = describeStatus(raw), root = $('readings');
  if (!root.children.length) for (const m of METRICS) {
    const charted = trends.selectedMetric() === m.key;
    const tile = el('button', 'metric-tile' + (charted ? ' selected' : ''));
    tile.type = 'button'; tile.dataset.metric = m.key; tile.setAttribute('aria-pressed', String(charted));
    tile.title = `Show ${m.label.toLowerCase()} on the chart`;
    const top = el('span', 'metric-top'); top.append(el('span', 'metric-label', m.label));
    if (m.key === 'mqMv') top.append(el('span', 'badge'));
    tile.append(top, el('span', 'metric-value'));
    if (m.key === 'mqMv') { const gauge = el('span', 'gauge'); gauge.append(el('span', 'gauge-fill'), el('span', 'gauge-mark')); tile.append(gauge); }
    tile.append(el('span', 'metric-note'));
    tile.addEventListener('click', () => trends.selectMetric(m.key));
    root.append(tile);
  }
  for (const m of METRICS) {
    const tile = root.querySelector(`[data-metric="${m.key}"]`), v = r?.[m.key], note = tile.querySelector('.metric-note');
    tile.querySelector('.metric-value').replaceChildren(document.createTextNode(Number.isFinite(v) ? formatNumber(v, { digits: m.precision, minDigits: m.precision, grouping: false }) : '—'), el('small', '', ` ${m.unit}`));
    note.classList.toggle('flag', r ? !Number.isFinite(v) : false);
    if (m.key === 'mqMv') {
      const b = tile.querySelector('.badge'), gauge = tile.querySelector('.gauge'), threshold = r?.mqThresholdMv;
      // Firmware suppresses gas warnings during warm-up, calibration and sensor faults (coop_monitor.ino).
      const [gasLabel, gasTone] = hasStatus(raw, 'GAS_WARNING') ? ['Gas warning', 'danger']
        : status.items.some(i => WARNING_GUARDS.includes(i.token)) ? ['Warnings paused', status.tone]
        : status.tone === 'ok' ? ['Normal', 'ok'] : [status.label, status.tone];
      b.className = `badge ${d.stale ? 'muted' : gasTone}`; b.textContent = r ? gasLabel : ''; b.title = raw ? `${status.detail}\nFirmware status: ${raw}` : '';
      tile.classList.toggle('danger', !d.stale && hasStatus(raw, 'GAS_WARNING'));
      gauge.hidden = !(Number.isFinite(v) && Number.isFinite(threshold) && threshold > 0);
      if (!gauge.hidden) {
        const scale = threshold * 1.25, level = Math.min(100, Math.max(0, v / scale * 100));
        gauge.className = `gauge ${v >= threshold ? 'danger' : v >= threshold * 0.9 ? 'warn' : 'ok'}`;
        gauge.style.setProperty('--level', `${level.toFixed(1)}%`);
        gauge.title = `${formatNumber(v / threshold * 100, { digits: 0 })}% of the warning threshold`;
      }
      note.textContent = !r ? 'No readings yet'
        : !Number.isFinite(v) ? 'Gas sensor value missing'
        : Number.isFinite(threshold) ? `${formatNumber(r.mqRatio, { digits: 2, minDigits: 2 })}× baseline · warning at ${formatNumber(threshold, { digits: 1, grouping: false })} mV`
        : 'No warning threshold yet (not calibrated)';
    } else {
      const range = trends.stats(m.key);
      note.textContent = !r ? 'No readings yet'
        : !Number.isFinite(v) ? 'Sensor not responding'
        : range ? `${range.hours} h range ${formatNumber(range.min, { digits: m.precision, minDigits: m.precision, grouping: false })}–${formatNumber(range.max, { digits: m.precision, minDigits: m.precision, grouping: false })} ${m.unit}`
        : m.description;
    }
  }
}

function renderOverviewState(d) {
  const c = connection(d), empty = $('overview-empty'), show = !d || c.never;
  empty.hidden = !show; $('overview-content').hidden = show;
  if (!show) return;
  empty.replaceChildren(!d
    ? emptyState('No monitor registered yet', 'Once a device is registered and provisioned, its readings appear here.')
    : emptyState(`No readings from ${d.label} yet`, 'This device has never connected. Power it on and make sure it can reach Wi-Fi; readings appear here within a few seconds of its first upload.'));
}

function renderCalibration(d) {
  const s = d.state, c = s?.calibration, r = d.latestReading, valid = s?.calibrated === true && c;
  const matching = valid && r && r.bootId === s.bootId && r.calibrationRevision === c.revision && r.configRevision === s.appliedConfigRevision;
  const relative = v => valid && c.baselineMv > 0 && Number.isFinite(v) ? `${format(v, ' mV')} (${format(v / c.baselineMv, '× baseline')})` : format(v, ' mV');
  const fields = valid ? [
    ['Baseline', format(c.baselineMv, ' mV')],
    ['Automatic warning threshold', relative(c.thresholdMv)],
    ['Threshold used for the latest reading', matching ? relative(r.mqThresholdMv) : 'Waiting for a matching reading'],
    ['Baseline variation (SD)', format(c.sdMv, ' mV')],
    ['Calibration samples', format(c.samples)],
    ['Reference temperature', format(c.temperatureC, ' °C')],
    ['Reference humidity', format(c.humidityPct, ' %')],
    ['Calibration revision', String(c.revision)],
  ] : [];
  const status = !s ? 'No device report yet.' : !valid ? 'No valid calibration reported.' : `Calibration available · Last reported ${date(s.receivedAt)}${d.stale ? ' · Device offline; showing last reported values.' : ''}`;
  const add = (target, list) => { for (const [label, value] of list) { const item = el('div'); item.append(el('dt', '', label), el('dd', '', value)); target.append(item); } };
  for (const panel of document.querySelectorAll('[data-calibration-panel]')) {
    const compact = panel.closest('#overview') !== null;
    panel.querySelector('[data-calibration-status]').textContent = !compact ? status
      : !s ? 'No report from the device yet.'
      : !valid ? 'Not calibrated. Gas warnings stay off until calibration is run from the Console.'
      : `Calibrated${d.stale ? ' · last reported values (device offline)' : ''}`;
    const values = panel.querySelector('[data-calibration-values]'); values.replaceChildren();
    add(values, compact && valid ? [fields[0], ['Warning threshold now', fields[2][1]], ['Reference conditions', `${format(c.temperatureC, ' °C')} / ${format(c.humidityPct, ' %')}`], fields[4]] : fields);
    if (compact) { const extra = panel.querySelector('[data-calibration-extra]'); extra.replaceChildren(); add(extra, valid ? [['Last reported', formatDateTime(s?.receivedAt)], ...fields] : []); }
  }
}

const RESET_TEXT = { power_on: 'Power-on (power cut or cable)', brownout: 'Brownout (supply dipped)', panic: 'Firmware crash', task_watchdog: 'Watchdog (firmware stuck)', interrupt_watchdog: 'Watchdog (firmware stuck)', watchdog: 'Watchdog', software: 'Software restart', external: 'Reset pin / button', usb: 'USB reset', deep_sleep: 'Wake from sleep', unknown: 'Unknown' };
function renderHealth(d) {
  const h = d.state?.health, items = [];
  const add = (label, value, bad = false, flag = label, key = false) => items.push({ label, value, bad, flag, key });
  const sensor = s => !s ? 'not reported' : `${s.ok === false ? 'Error' : 'OK'} · ${s.recovered ?? 0} retried · ${s.failed ?? 0} failed`;
  if (h) {
    add('Last restart', RESET_TEXT[h.resetReason] ?? h.resetReason ?? 'not reported', ['panic', 'brownout', 'task_watchdog', 'interrupt_watchdog', 'watchdog'].includes(h.resetReason), 'restarted after a fault', true);
    if (Number.isFinite(h.rssiDbm)) add('Wi-Fi signal', `${h.rssiDbm} dBm (${h.rssiDbm >= -60 ? 'good' : h.rssiDbm >= -72 ? 'fair' : 'weak'})`, h.rssiDbm < -72, 'weak Wi-Fi', true);
    add('Reconnects / upload failures', `${h.wifiReconnects ?? '–'} / ${h.uploadFailures ?? '–'} since restart`);
    if (Number.isFinite(h.queuePending)) add('Upload queue', `${h.queuePending} waiting`, h.queuePending > 100, 'upload backlog');
    if (Number.isFinite(h.minFreeHeap)) add('Lowest free memory', `${Math.round(h.minFreeHeap / 1024)} KiB since restart`, h.minFreeHeap < 10000, 'low memory');
    if (Number.isFinite(h.largestFreeBlock)) add('Largest free block', `${Math.round(h.largestFreeBlock / 1024)} KiB (uploads need ~40)`, h.largestFreeBlock < 45000, 'memory too fragmented for uploads');
    add('AHT20 (temperature, humidity)', sensor(h.aht), h.aht?.ok === false, 'AHT20 sensor error');
    add('BMP280 (pressure)', sensor(h.bmp), h.bmp?.ok === false, 'BMP280 sensor error');
    const sd = h.sd;
    if (sd) add('SD backup', sd.state === 'ok' ? `OK · ${format((sd.fileBytes ?? 0) / 1024, ' KiB')} this boot · ${sd.flushes ?? 0} writes${sd.flushFailures || sd.verifyFailures ? ` · ${(sd.flushFailures ?? 0) + (sd.verifyFailures ?? 0)} errors` : ''}` : sd.state === 'disabled' ? 'Disabled' : sd.state === 'absent' ? 'No card' : 'Error', sd.state === 'error' || sd.state === 'absent' || (sd.flushFailures ?? 0) + (sd.verifyFailures ?? 0) > 0, 'SD backup problem');
  }
  const flagged = items.filter(i => i.bad), main = [...flagged, ...items.filter(i => !i.bad && i.key)], rest = items.filter(i => !main.includes(i));
  const fill = (target, list) => { target.replaceChildren(); for (const i of list) { const item = el('div'), dd = el('dd', i.bad ? 'flag' : '', i.value); item.append(el('dt', '', i.label), dd); target.append(item); } };
  fill($('health-values'), main); fill($('health-extra'), rest); $('health-more').hidden = !rest.length;
  const verdict = $('health-verdict'); verdict.replaceChildren();
  if (h) verdict.append(badge(flagged.length ? 'Needs attention' : 'Healthy', flagged.length ? 'warn' : 'ok'), document.createTextNode(flagged.length ? flagged.map(i => i.flag).join(', ') : 'No problems reported'));
  $('health-status').textContent = !h ? 'No health report yet. Firmware with diagnostics sends it.' : d.stale ? 'Last reported values (device offline).' : '';
  $('health-status').hidden = !$('health-status').textContent;
  if (h && d.state?.receivedAt) setRelativeTime($('health-age'), d.state.receivedAt, rel => `Reported ${rel}`); else { clearRelativeTime($('health-age')); $('health-age').textContent = ''; }
  const list = $('boot-list'); list.replaceChildren();
  for (const b of d.recentBoots ?? []) {
    const m = /reset=([a-z_]+)/.exec(b.message ?? ''), memory = /cause=tls_memory/.test(b.message ?? '');
    list.append(el('li', '', `${formatDateTime(b.startedAt)} · ${memory ? 'Automatic restart (upload memory exhausted)' : m ? (RESET_TEXT[m[1]] ?? m[1]) : 'reason not reported'}`));
  }
  if (!list.children.length) list.append(el('li', '', 'No restarts recorded.'));
}

function renderStorage(d) {
  const c = snapshot.capacity;
  const usage = (barId, textId, label, bytes, limit) => {
    const pct = limit > 0 && Number.isFinite(bytes) ? bytes / limit * 100 : null, bar = $(barId);
    const text = pct === null ? 'Usage unavailable' : `${formatBytes(bytes)} of ${formatBytes(limit)} (${formatNumber(pct, { digits: pct < 10 ? 1 : 0 })}%)`;
    $(textId).textContent = text;
    bar.className = `usage-bar ${pct >= 95 ? 'danger' : pct >= 80 ? 'warn' : ''}`;
    bar.style.setProperty('--used', `${Math.min(100, pct ?? 0).toFixed(1)}%`);
    bar.setAttribute('aria-label', `${label}: ${text}`);
  };
  usage('db-usage-bar', 'db-usage-text', 'Database', c.databaseBytes, c.databaseLimitBytes);
  usage('archive-usage-bar', 'archive-usage-text', 'Archive storage', c.archiveBytes, c.archiveLimitBytes);
  const [label, tone] = d.writesPaused ? ['Paused by you', 'warn'] : c.paused ? ['Paused: storage full', 'danger'] : c.warning ? ['Storage warning', 'warn'] : ['Uploading', 'ok'];
  $('upload-state').className = `badge dot ${tone}`; $('upload-state').textContent = label;
  $('capacity').textContent = c.paused ? `Writes are paused automatically: ${c.reasons.join(', ')}.` : c.warning ? 'Storage is above 80%. Consider archiving older readings.' : 'New readings are being saved to the cloud.';
  $('capacity-details').textContent = `Estimated database writes today: ${format(c.estimatedD1Writes)}\nUpload exchanges today: ${format(c.uploadRequests)}\nChecked: ${formatDateTime(c.updatedAt)}`;
  $('pause').textContent = d.writesPaused ? 'Resume uploads' : 'Pause uploads';
  $('pause').className = d.writesPaused ? 'small primary' : 'small';
}

function render() {
  const d = current();
  renderDeviceStatus(d); renderBanners(d); renderOverviewState(d);
  if (!d) { $('readings').replaceChildren(); trends.stop(true); return; }
  renderCalibration(d);
  renderTiles(d);
  renderHealth(d);
  renderStorage(d);
  $('state').textContent = d.state ? JSON.stringify(d.state, null, 2) : 'No device exchange yet. Connect the firmware using the provisioned device credential.';
  renderSettingsStatus(d);
  trends.sync();
}
$('pause').addEventListener('click', () => { const d = current(); if (d) setUploadsPaused(!d.writesPaused); });

// ===== Snapshot polling, sign-in and device selection =====
async function refresh() {
  if (document.hidden || refreshPending) return;
  refreshPending = true;
  try {
    const p = new URLSearchParams();
    if (active === 'console' && selected) { p.set('consoleDeviceId', selected); if (logCursor) p.set('cursor', logCursor); }
    snapshot = await api('/api/snapshot?' + p);
    if (Number.isFinite(Date.parse(snapshot.serverTime))) serverOffset = Date.parse(snapshot.serverTime) - Date.now();
    showDashboard();
    const ids = snapshot.devices.map(d => d.deviceId);
    if (!ids.includes(selected)) selected = ids[0] ?? '';
    if ([...$('device').options].map(o => o.value).join('|') !== ids.join('|')) {
      $('device').replaceChildren(...snapshot.devices.map(d => { const o = el('option', '', d.label); o.value = d.deviceId; return o; }));
    }
    $('device').value = selected;
    renderDevicePicker();
    render();
    if (snapshot.console) renderConsole(snapshot.console);
  } catch (e) {
    if (!$('login').hidden) return; // signed out: the login card is the message
    if ($('dashboard').hidden) $('loading-text').textContent = `Couldn’t reach the monitor service (${e.message}). Retrying…`;
    else notice(e.message, 'error');
  } finally { refreshPending = false; }
}
async function refreshAndOpen() {
  await refresh();
  if (!$('dashboard').hidden && !tabOpened) await openTab(tabFromHash());
}
$('login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const field = $('owner-key').closest('.field'), button = $('login-form').querySelector('button');
  $('login-error').textContent = ''; field.classList.remove('invalid'); button.disabled = true;
  try {
    await send('/auth/login', 'POST', { key: $('owner-key').value });
    $('owner-key').value = ''; notice('');
    await refreshAndOpen();
  } catch (e) {
    $('login-error').textContent = e.message === 'Invalid owner key' ? 'That owner key is not correct. Check it and try again.' : e.message;
    field.classList.add('invalid'); $('owner-key').focus();
  } finally { button.disabled = false; }
});
$('logout').addEventListener('click', async () => { try { await send('/auth/logout', 'POST', {}); showLogin(); } catch (e) { notice(e.message, 'error'); } });
$('device').addEventListener('change', () => {
  selected = $('device').value; formDevice = ''; historyCursor = logCursor = null; allReadings = []; historyRequest++;
  manualArchives.reset(); historySelection.reset(); historyExport.reset(); archiveLibrary.reset();
  $('history-rows').replaceChildren(); $('history-count').textContent = ''; $('more-history').hidden = true; $('logs').textContent = '';
  render();
  if (active === 'history') { historySelection.countSelection(); loadHistory(true, true).catch(e => notice(e.message, 'error')); }
  if (active === 'archives') { loadArchives(true).catch(e => notice(e.message, 'error')); manualArchives.countSelection(); }
});

// ===== History tab =====
// One view at a time: "latest" uses mode=latest; the presets and "custom" load the #from/#to range,
// so the summary count, the table and the CSV export always describe the same range.
const HISTORY_PRESETS = { '1h': 3600000, '24h': 86400000, '7d': 7 * 86400000 };
const HISTORY_FAULTS = ['AHT_ERROR', 'BMP_ERROR', 'MQ_ADC_HIGH'];
const HISTORY_ESTIMATED = 'Estimated time: the monitor’s clock had not been set yet (for example just after a restart), so this time was worked out from how long it had been running. It may be off by a few seconds.';
let historyView = 'latest', historyState = 'idle', historyError = '', historyTotal = null, historyApplied = null, historyOrder = 'desc';
const historyPlural = n => `${n.toLocaleString()} ${n === 1 ? 'reading' : 'readings'}`;
const historyDirty = () => historyView === 'custom' && !!historyApplied && ($('from').value !== historyApplied.from || $('to').value !== historyApplied.to);
function historyRangeProblem(fromValue, toValue) {
  const from = new Date(fromValue), to = new Date(toValue);
  if (!Number.isFinite(+from) || !Number.isFinite(+to)) return 'Enter both a start (From) and an end (To).';
  if (to <= from) return '“To” must be later than “From”.';
  if (to - from > 31 * 86400000) return 'A range can cover at most 31 days.';
  return '';
}
function historyRangeText({ from, to }) {
  const a = new Date(from), b = new Date(to);
  return `${formatDate(a)} ${formatTime(a)} – ${formatDate(a) === formatDate(b) ? '' : `${formatDate(b)} `}${formatTime(b)}`;
}
function fillHistoryPreset(ms) {
  const to = new Date(Math.floor(serverNow() / 60000) * 60000); // whole minutes, as datetime-local shows
  $('from').value = localInput(new Date(to.getTime() - ms)); $('to').value = localInput(to);
}

function historyRow(r, number) {
  const tr = el('tr'), status = describeStatus(r.status);
  if (hasStatus(r.status, 'GAS_WARNING')) tr.className = 'is-warning';
  else if (status.items.some(i => HISTORY_FAULTS.includes(i.token))) tr.className = 'is-fault';
  const time = el('td', 'history-time', formatDateTime(r.sampledAt ?? r.estimatedAt));
  if (!r.sampledAt) { const est = el('abbr', 'history-est', 'est.'); est.title = HISTORY_ESTIMATED; time.append(' ', est); }
  const value = (v, digits) => el('td', 'num', formatNumber(v, { digits, minDigits: digits, grouping: false }));
  const statusCell = el('td', 'history-status');
  const title = `${status.detail}\nFirmware status: ${r.status ?? 'none'}`;
  if (status.tone === 'ok') { const ok = el('span', 'history-ok', status.label); ok.title = title; statusCell.append(ok); }
  else statusCell.append(badge(status.label, status.tone, title));
  tr.append(el('td', 'num history-no', number.toLocaleString()), time, value(r.mqMv, 0), value(r.mqRatio, 2),
    value(r.ahtTemperatureC, 1), value(r.humidityPct, 1), value(r.pressureHpa, 1), statusCell);
  return tr;
}
function renderHistory(order = historyOrder) {
  const n = allReadings.length;
  // No. keeps the time-order rule: 1 is the oldest row shown, in either order.
  $('history-rows').replaceChildren(...allReadings.map((r, i) => historyRow(r, order === 'asc' ? i + 1 : n - i)));
}

function renderHistoryView() {
  const d = current(), never = connection(d).never, latest = historyView === 'latest', dirty = historyDirty();
  const n = allReadings.length, busy = historyState === 'loading', shown = historyState === 'ready' || historyState === 'more';
  for (const b of $('history-views').querySelectorAll('button')) {
    const on = b.dataset.view === historyView; b.classList.toggle('selected', on); b.setAttribute('aria-pressed', String(on));
  }
  $('history-form').hidden = historyView !== 'custom';
  $('history-selection-count').hidden = !dirty;

  // One summary line: what the table shows.
  let main = '';
  const meta = [], orderText = historyOrder === 'asc' ? 'oldest first' : 'newest first';
  if (d && busy) main = 'Loading readings…';
  else if (d && historyState === 'error') main = 'Readings could not be loaded';
  else if (d && shown) {
    if (latest) main = !n ? 'No readings in the last 30 days'
      : `Showing the ${n.toLocaleString()} ${historyOrder === 'asc' ? 'oldest' : 'most recent'} ${n === 1 ? 'reading' : 'readings'}${historyOrder === 'asc' ? ' of the last 30 days' : ''}`;
    else main = !n && !historyCursor ? 'No readings in this range'
      : !historyCursor ? `Showing all ${historyPlural(n)}`
      : historyTotal !== null ? `Showing ${n.toLocaleString()} of ${historyPlural(historyTotal)}` : `Showing the first ${historyPlural(n)}`;
    if (n) meta.push(orderText);
  }
  if (d && !latest && historyRange && historyState !== 'idle') meta.unshift(historyRangeText(historyRange));
  const strong = el('strong', '', main);
  $('history-count').replaceChildren(...(main ? [strong] : []), ...(main && meta.length ? [el('span', 'history-summary-meta', ` · ${meta.join(' · ')}`)] : []));

  // Export always names exactly what it will download.
  const exp = $('export');
  let label = 'Export as CSV', disabled = !d || never, title = '';
  if (d && !never) {
    if (latest) { label = 'Choose a range to export…'; title = 'Exports cover a time range. This switches to Custom range.'; }
    else if (dirty) { label = 'Apply the new dates to export'; disabled = true; }
    else if (historyTotal === 0 || (shown && !n && !historyCursor)) { label = 'Nothing to export'; disabled = true; }
    else {
      label = historyTotal !== null ? `Export ${historyPlural(historyTotal)} as CSV` : 'Export this range as CSV';
      if (historyRange) title = `Downloads every reading from ${historyRangeText(historyRange)}, oldest first, in CSV files of up to 50,000 readings.`;
    }
  }
  exp.textContent = label; exp.disabled = disabled; exp.title = title;
  if (!dirty && $('export-status').textContent === HISTORY_APPLY_FIRST) $('export-status').textContent = '';

  // Empty, error and never-connected states replace the table.
  let state = null;
  if (!d) state = emptyState('No monitor registered yet', 'Once a device is registered and provisioned, its readings appear here.');
  else if (historyState === 'error') {
    state = !latest && !historyRange ? emptyState('Choose a valid range', `${historyError} Pick new dates in Custom range.`)
      : emptyState('Couldn’t load readings', `${historyError ? `${historyError.replace(/\.$/, '')}. ` : ''}Check your connection, then try again.`);
    if (latest || historyRange) {
      const retry = el('button', 'small history-retry', 'Retry'); retry.type = 'button';
      retry.addEventListener('click', () => loadHistory(true, historyLatest, false).catch(e => notice(e.message, 'error')));
      state.append(retry);
    }
  } else if (shown && !n && !historyCursor) {
    state = never ? emptyState(`No readings from ${d.label} yet`, 'This device has never connected. Its readings appear here a few seconds after its first upload.')
      : latest ? emptyState('No readings in the last 30 days', 'History keeps 30 days of readings. Older readings are saved in Archives.')
      : emptyState('No readings in this range', 'Try a wider range such as Last 7 days. Readings older than 30 days are in Archives.');
    if (!never) { const link = el('a', 'history-archives-link', 'Open Archives'); link.href = '#archives'; state.append(link); }
  }
  $('history-empty').hidden = !state; $('history-empty').replaceChildren(...(state ? [state] : []));
  $('history-count').parentElement.hidden = !d || (never && !n); // nothing to summarise or export yet
  $('history-table').hidden = !!state || !n;

  const more = $('more-history'), page = Number($('history-page-size').value);
  const remaining = !latest && historyTotal !== null ? historyTotal - n : null;
  more.hidden = !historyCursor || !shown || !n;
  more.textContent = historyState === 'more' ? 'Loading…' : `Load ${(remaining > 0 ? Math.min(page, remaining) : page).toLocaleString()} more`;
  $('history-end').textContent = !shown || !n ? ''
    : historyCursor ? (remaining !== null ? `${n.toLocaleString()} of ${historyTotal.toLocaleString()} shown` : `${n.toLocaleString()} shown`)
    : latest ? `All ${historyPlural(n)} from the last 30 days are shown` : `All ${historyPlural(n)} in this range are shown`;
}

// reset: start a new list; readRange: re-read the range (presets recompute "now"); false keeps the applied range.
// The second parameter is kept for existing callers; the selected view decides latest versus range.
async function loadHistory(reset, _latest, readRange = true) {
  if (reset) {
    if (readRange && HISTORY_PRESETS[historyView]) fillHistoryPreset(HISTORY_PRESETS[historyView]);
    historyLatest = historyView === 'latest';
    allReadings = []; historyCursor = null; $('history-rows').replaceChildren();
    if (historyLatest) { historyApplied = historyRange = null; historyTotal = null; }
    else if (readRange || !historyApplied) {
      const applied = { from: $('from').value, to: $('to').value }, problem = historyRangeProblem(applied.from, applied.to);
      if (problem) { historyRequest++; historyState = 'error'; historyError = problem; historyRange = null; renderHistoryView(); return; }
      if (!historyApplied || applied.from !== historyApplied.from || applied.to !== historyApplied.to) historyTotal = null;
      historyApplied = applied;
      historyRange = { from: new Date(applied.from).toISOString(), to: new Date(applied.to).toISOString() };
    }
    if (!historyLatest && selected) historySelection.countSelection();
  }
  const request = ++historyRequest, deviceId = selected, pageSize = $('history-page-size').value, order = reset ? $('history-order').value : historyOrder;
  if (!deviceId) { historyState = 'idle'; renderHistoryView(); return; }
  if (reset) historyOrder = order;
  historyState = reset ? 'loading' : 'more'; historyError = '';
  $('more-history').disabled = true; renderHistoryView();
  try {
    const query = new URLSearchParams({ deviceId, pageSize, order, ...(historyLatest ? { mode: 'latest' } : historyRange) });
    if (historyCursor) query.set('cursor', historyCursor);
    const page = await api('/api/history?' + query);
    if (request !== historyRequest || deviceId !== selected) return;
    historyCursor = page.nextCursor; allReadings.push(...page.readings); historyState = 'ready'; renderHistory(order);
  } catch (e) {
    if (request === historyRequest && deviceId === selected) { historyState = reset ? 'error' : 'ready'; historyError = e.message; }
    throw e;
  } finally {
    if (request === historyRequest && deviceId === selected) { $('more-history').disabled = false; renderHistoryView(); }
  }
}
function selectHistoryView(view, { focus = false } = {}) {
  historyView = view; $('history-range-error').textContent = '';
  for (const f of $('history-form').querySelectorAll('.field')) f.classList.remove('invalid');
  if (focus) { renderHistoryView(); $('from').focus(); }
  if (current()) loadHistory(true).catch(e => notice(e.message, 'error')); else renderHistoryView();
}
historySelection.onCount((count, range) => {
  if (historyApplied && range.from === historyApplied.from && range.to === historyApplied.to) historyTotal = count;
  renderHistoryView();
});
const HISTORY_APPLY_FIRST = 'Apply the new dates first: the export uses the range shown in the table.';
historyExport.setGuard(() => historyView === 'latest' ? '' : historyDirty() ? HISTORY_APPLY_FIRST : null);
$('history-views').addEventListener('click', e => { const b = e.target.closest('button[data-view]'); if (b) selectHistoryView(b.dataset.view); });
$('export').addEventListener('click', () => { if (historyView === 'latest' && current()) selectHistoryView('custom', { focus: true }); });
for (const id of ['from', 'to']) $(id).addEventListener('input', () => {
  $('history-range-error').textContent = '';
  for (const f of $('history-form').querySelectorAll('.field')) f.classList.remove('invalid');
  renderHistoryView();
});
$('history-form').addEventListener('submit', e => {
  e.preventDefault();
  const problem = historyRangeProblem($('from').value, $('to').value);
  $('history-range-error').textContent = problem;
  for (const f of $('history-form').querySelectorAll('.field')) f.classList.toggle('invalid', !!problem);
  if (!problem && current()) loadHistory(true).catch(e => notice(e.message, 'error')); else renderHistoryView();
});
$('more-history').addEventListener('click', () => loadHistory(false).catch(e => notice(e.message, 'error')));
for (const control of ['history-page-size', 'history-order']) $(control).addEventListener('change', () => { if (current()) loadHistory(true, historyLatest, false).catch(e => notice(e.message, 'error')); });
renderHistoryView();

// ===== Console tab ===== (UI in console.js; logCursor stays here because refresh() sends it)
const consoleTab = createConsoleTab({ send, current, connection, reload: () => loadConsole(), now: serverNow });
function renderConsole(l) { logCursor = l.nextCursor; consoleTab.render(l); }
async function loadConsole() { await refresh(); }

// ===== Settings tab ===== (UI in console.js; the form is refilled only on device change or tab open)
const settingsTab = createSettingsTab({ send, current, connection, reload: () => refresh() });
const alertsTab = createAlertsTab({ api, send, current, now: serverNow });
function renderSettingsStatus(d) {
  settingsTab.status(d); consoleTab.sync(d); alertsTab.sync(d);
  if (formDevice !== selected) { fillSettings(d); formDevice = selected; }
}
function fillSettings(d) { settingsTab.fill(d); }

// ===== Archives tab =====
function loadArchives(reset) { return archiveLibrary.load(reset); }

// ===== Startup =====
applyTab(tabFromHash());
await refreshAndOpen();
setInterval(() => { if ($('login').hidden) refreshAndOpen(); }, 4000);
document.addEventListener('visibilitychange', () => { if (document.hidden) trends.stop(); else if ($('login').hidden) refresh(); });
