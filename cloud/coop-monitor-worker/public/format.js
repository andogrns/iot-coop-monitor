// Shared, pure formatting helpers for the dashboard (no DOM access, safe to import in node tests).
//
//   formatDate(value)                 -> "15/11/2026"                (DD/MM/YYYY, owner decision)
//   formatDateTime(value, fallback)   -> "15/11/2026, 4:24:58 PM"    (date + browser-locale time)
//   formatTime(value, {seconds})      -> "16:24" / "4:24:58 PM"      (browser-locale time only)
//   relativeTime(value, now)          -> "just now", "12 s ago", "5 min ago", "3 h ago", "2 days ago"
//   formatNumber(value, options)      -> "1,009.6" / "—" for null; options {digits, minDigits, unit, grouping}
//   formatBytes(bytes)                -> "54.2 MB"
//   describeStatus(raw)               -> {label, tone, detail, items, tokens}; tone: danger|warn|info|muted|ok
//   hasStatus(raw, token)             -> true when the raw firmware status contains that token
//   niceTicks(min, max, maxTicks)     -> {min, max, step, ticks, decimals} for readable axis labels
//
// Every value accepted as a time may be an ISO string, epoch milliseconds or a Date.

export const EMPTY = '—';

export function toDate(value) {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

const pad = n => String(n).padStart(2, '0');

export function formatDate(value, fallback = EMPTY) {
  const d = toDate(value);
  return d ? `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}` : fallback;
}

export function formatTime(value, { seconds = false, fallback = EMPTY } = {}) {
  const d = toDate(value);
  if (!d) return fallback;
  return d.toLocaleTimeString(undefined, seconds
    ? { hour: '2-digit', minute: '2-digit', second: '2-digit' }
    : { hour: '2-digit', minute: '2-digit' });
}

// The single date-time format for the whole dashboard: DD/MM/YYYY, then the browser-locale time.
export function formatDateTime(value, fallback = EMPTY) {
  const d = toDate(value);
  return d ? `${formatDate(d)}, ${d.toLocaleTimeString()}` : fallback;
}

export function relativeTime(value, now = Date.now(), fallback = EMPTY) {
  const d = toDate(value), reference = toDate(now);
  if (!d || !reference) return fallback;
  const seconds = Math.floor((reference.getTime() - d.getTime()) / 1000);
  if (seconds < 5) return 'just now'; // includes small clock skew into the future
  if (seconds < 60) return `${seconds} s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}

export function formatNumber(value, { digits = 2, minDigits = 0, unit = '', grouping = true } = {}) {
  if (value === null || value === undefined || value === '' || !Number.isFinite(Number(value))) return EMPTY;
  const text = Number(value).toLocaleString(undefined, {
    maximumFractionDigits: digits, minimumFractionDigits: Math.min(minDigits, digits), useGrouping: grouping,
  });
  return unit ? `${text}${/^[%×]/.test(unit) ? '' : ' '}${unit}` : text;
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return EMPTY;
  const units = ['B', 'kB', 'MB', 'GB', 'TB'];
  let value = bytes, index = 0;
  while (Math.abs(value) >= 1000 && index < units.length - 1) { value /= 1000; index++; }
  return formatNumber(value, { digits: value >= 100 || index === 0 ? 0 : 1, unit: units[index] });
}

// ---- Firmware status ----------------------------------------------------------------------
// Tokens come from firmware/coop_monitor/coop_monitor.ino (addFlag) and dashboard_protocol.h.
// Several tokens may be combined with "|" (firmware) or " | " (readable form).
const TONE_RANK = { danger: 4, warn: 3, info: 2, muted: 1, ok: 0 };

export const STATUS_TOKENS = {
  GAS_WARNING: { label: 'Gas warning', tone: 'danger', detail: 'Gas response is above the warning threshold.' },
  AHT_ERROR: { label: 'Temperature/humidity sensor error', tone: 'warn', detail: 'The AHT20 sensor is not responding, so temperature and humidity are unavailable. Gas warnings are paused until it recovers.' },
  BMP_ERROR: { label: 'Pressure sensor error', tone: 'warn', detail: 'The BMP280 sensor is not responding, so pressure is unavailable. Gas warnings are paused until it recovers.' },
  MQ_ADC_HIGH: { label: 'Gas sensor signal too high', tone: 'warn', detail: 'The gas sensor signal is at the top of its measurable range. Gas warnings are paused; check the sensor wiring and supply.' },
  CAL_MISSING: { label: 'Not calibrated', tone: 'warn', detail: 'The gas sensor has no calibration, so gas warnings are disabled. Run calibration from the Console.' },
  // Only in readings stored before the display code was removed (18 November 2026).
  OLED_ERROR: { label: 'Display error', tone: 'warn', detail: 'The monitor’s small screen is not responding. Readings are not affected.' },
  CAL_STABILIZING: { label: 'Calibrating (settling)', tone: 'info', detail: 'Calibration is waiting for the sensor to settle. Gas warnings are paused.' },
  CAL_COLLECTING: { label: 'Calibrating (measuring)', tone: 'info', detail: 'Calibration is collecting baseline samples. Gas warnings are paused.' },
  WARMUP: { label: 'Warming up', tone: 'info', detail: 'The gas sensor is warming up after a restart (about 10 minutes). Gas warnings are paused.' },
  STARTING: { label: 'Starting up', tone: 'info', detail: 'The monitor is starting and has not taken a reading yet.' },
  UNKNOWN: { label: 'Status unknown', tone: 'muted', detail: 'The monitor has not reported a status yet.' },
  OK: { label: 'Normal', tone: 'ok', detail: 'All sensors are working and gas response is below the warning threshold.' },
};
// Older or alternative spellings map to the canonical token.
const STATUS_ALIASES = {
  ADC_HIGH: 'MQ_ADC_HIGH', CALIBRATION_MISSING: 'CAL_MISSING', NO_CALIBRATION: 'CAL_MISSING', UNCALIBRATED: 'CAL_MISSING',
  CALIBRATING: 'CAL_COLLECTING', WARMING_UP: 'WARMUP',
};

export function statusTokens(raw) {
  if (typeof raw !== 'string') return [];
  return raw.split('|').map(t => t.trim().toUpperCase()).filter(Boolean);
}

export function hasStatus(raw, token) {
  return statusTokens(raw).some(t => (STATUS_ALIASES[t] ?? t) === token);
}

export function describeStatus(raw) {
  const tokens = statusTokens(raw);
  if (!tokens.length) return { label: 'No status', tone: 'muted', detail: 'No status has been reported yet.', items: [], tokens };
  const items = [];
  for (const token of tokens) {
    const canonical = STATUS_ALIASES[token] ?? token, known = STATUS_TOKENS[canonical];
    if (items.some(i => i.token === canonical)) continue;
    // Unknown tokens are shown verbatim so new firmware flags are never hidden.
    items.push(known ? { token: canonical, ...known } : { token: canonical, label: token, tone: 'muted', detail: `Firmware reported “${token}”.` });
  }
  // "OK" alongside other flags adds nothing.
  const relevant = items.length > 1 ? items.filter(i => i.token !== 'OK') : items;
  relevant.sort((a, b) => TONE_RANK[b.tone] - TONE_RANK[a.tone]);
  const top = relevant[0];
  const label = relevant.length > 1 ? `${top.label} +${relevant.length - 1} more` : top.label;
  return { label, tone: top.tone, detail: relevant.map(i => i.detail).join(' '), items: relevant, tokens };
}

// ---- Axis ticks ----------------------------------------------------------------------------
// "Nice" round tick values (1, 2, 5 × 10^n) covering [min, max] with at most maxTicks labels,
// and the number of decimals needed so neighbouring labels never print the same text.
export function niceTicks(min, max, maxTicks = 5) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1, step: 1, ticks: [0, 1], decimals: 0 };
  if (max < min) [min, max] = [max, min];
  if (max === min) { const d = Math.abs(min) * 0.05 || 1; min -= d; max += d; }
  const intervals = Math.max(1, maxTicks - 1), rough = (max - min) / intervals;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map(m => m * power).find(s => s >= rough * 0.999) ?? 10 * power;
  const decimals = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
  const round = v => Number(v.toFixed(decimals + 2));
  const lo = round(Math.floor(min / step + 1e-9) * step), hi = round(Math.ceil(max / step - 1e-9) * step);
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(round(v));
  return { min: lo, max: hi, step, ticks, decimals };
}
