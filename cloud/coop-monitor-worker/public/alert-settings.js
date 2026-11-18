// Gas-warning alert settings and message templates, shared by the Worker (src/notify.js, src/gas-alerts.js)
// and the dashboard Settings tab (alerts.js). No DOM and no Worker APIs here.
//
// Settings are global (every device), stored by the Worker in D1 system_state under 'alert_settings'.
// The firmware decides when a GAS_WARNING exists; these settings only decide when and how the server tells people.
// Every message ends with SCOPE_FOOTER: MQ-135 is a relative gas response, never calibrated ammonia ppm.

// Delivery services. Add one here and a sender in src/notify.js to offer it in the dashboard.
export const ALERT_CHANNELS = Object.freeze({ discord: { name: 'Discord' } });
export const CHECK_EVERY_MINUTES = 5; // the Worker's alert cron (src/gas-alerts.js GAS_ALERT_CRON)
export const AFTER_MINUTES = Object.freeze([5, 720]);
export const REMIND_MINUTES = Object.freeze([0, 30, 60, 120, 180, 360, 720]); // 0 = no reminders
export const MENTIONS = Object.freeze(['none', 'here', 'everyone']);
export const TEMPLATE_MAX = 1500;
export const DISCORD_MAX = 2000;
export const SCOPE_FOOTER = '-# MQ-135 relative gas response, not calibrated ammonia ppm.';
export const TEST_HEADER = '🧪 **Test message from the dashboard.** No gas warning is behind it.';

export const DEFAULT_WARNING_TEMPLATE = [
  '⚠️ **Gas warning ongoing for {elapsed}** · {device}',
  'Warning started {since} ({since_relative}).',
  'Latest MQ-135 reading {time}: {gas_mv} at the ADC input ({ratio} baseline), warning threshold {threshold_mv}.',
  'Check ventilation and litter in the coop.',
].join('\n');
export const DEFAULT_ENDED_TEMPLATE = '✅ Gas warning no longer continuous · {device} · latest status `{status}` {time}.';

// [name, description, example]. Examples drive the dashboard help; real values come from messageVariables().
export const TEMPLATE_VARIABLES = Object.freeze([
  ['device', 'Device name', 'Coop 1 (coop-monitor-01)'],
  ['elapsed', 'How long the warning has lasted so far', '1 h 5 min'],
  ['duration', 'Your wait time from this form', '1 hour'],
  ['since', 'When the warning started, in each reader’s own time zone', '18 Nov 2026 14:00'],
  ['since_relative', 'The same, as a relative time', '1 hour ago'],
  ['time', 'Time of the latest reading', '15:05'],
  ['gas_mv', 'Latest MQ-135 value at the ADC input', '812 mV'],
  ['threshold_mv', 'Warning threshold in use', '760 mV'],
  ['ratio', 'Latest value divided by the clean-air baseline', '1.21×'],
  ['temperature', 'Air temperature', '28.4 °C'],
  ['humidity', 'Relative humidity', '70 %'],
  ['status', 'Latest device status (useful in the end message)', 'OK'],
]);
const KNOWN = new Set(TEMPLATE_VARIABLES.map(([name]) => name));

export function defaultAlertSettings(afterMinutes = 60) {
  return { enabled: true, channel: 'discord', discordChannelId: '', afterMinutes, remindEveryMinutes: 0, mention: 'none',
    warningTemplate: DEFAULT_WARNING_TEMPLATE, sendEnded: true, endedTemplate: DEFAULT_ENDED_TEMPLATE };
}

export const unknownVariables = template => [...new Set([...String(template).matchAll(/\{([A-Za-z_]+)\}/g)].map(m => m[1]).filter(n => !KNOWN.has(n)))];

function templateError(value, required) {
  if (typeof value !== 'string') return 'Enter the message text.';
  if (/\u0000/.test(value)) return 'The message contains an invalid character.';
  if (value.length > TEMPLATE_MAX) return `Keep the message to ${TEMPLATE_MAX} characters (now ${value.length}).`;
  if (required && !value.trim()) return 'Enter the message text.';
  const unknown = unknownVariables(value);
  return unknown.length ? `Unknown value ${unknown.map(n => `{${n}}`).join(', ')}. Use one of the values listed.` : '';
}

// Returns { settings, errors } where errors maps field names to a message ('' entries are omitted).
// The dashboard shows errors per field; the Worker rejects the first one. Unknown keys are rejected.
export function checkAlertSettings(value) {
  const errors = {}, v = value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  if (!v) return { settings: null, errors: { settings: 'Alert settings must be an object.' } };
  const fields = Object.keys(defaultAlertSettings());
  const extra = Object.keys(v).filter(k => !fields.includes(k));
  if (extra.length) errors.settings = `Unknown alert setting ${extra[0]}.`;
  if (typeof v.enabled !== 'boolean') errors.enabled = 'Choose whether alerts are on.';
  if (!Object.hasOwn(ALERT_CHANNELS, v.channel)) errors.channel = 'Choose a supported service.';
  const channelId = typeof v.discordChannelId === 'string' ? v.discordChannelId.trim() : null;
  if (channelId === null || (channelId && !/^\d{17,20}$/.test(channelId))) errors.discordChannelId = 'A Discord channel ID is a 17–20 digit number. Leave it empty to use the bot’s default channel.';
  if (!Number.isSafeInteger(v.afterMinutes) || v.afterMinutes < AFTER_MINUTES[0] || v.afterMinutes > AFTER_MINUTES[1]) errors.afterMinutes = `Enter a whole number of minutes from ${AFTER_MINUTES[0]} to ${AFTER_MINUTES[1]}.`;
  if (!REMIND_MINUTES.includes(v.remindEveryMinutes)) errors.remindEveryMinutes = 'Choose a reminder interval from the list.';
  if (!MENTIONS.includes(v.mention)) errors.mention = 'Choose who to mention.';
  if (typeof v.sendEnded !== 'boolean') errors.sendEnded = 'Choose whether to send the end message.';
  const warning = templateError(v.warningTemplate, true), ended = templateError(v.endedTemplate, v.sendEnded === true);
  if (warning) errors.warningTemplate = warning;
  if (ended) errors.endedTemplate = ended;
  if (Object.keys(errors).length) return { settings: null, errors };
  return { settings: { enabled: v.enabled, channel: v.channel, discordChannelId: channelId, afterMinutes: v.afterMinutes, remindEveryMinutes: v.remindEveryMinutes,
    mention: v.mention, warningTemplate: v.warningTemplate, sendEnded: v.sendEnded, endedTemplate: v.endedTemplate }, errors };
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
// Wait time: "45 minutes", "1 hour", "1 h 30 min".
export function durationText(minutes) {
  const m = Math.max(0, Math.round(minutes)), h = Math.floor(m / 60);
  if (m < 60) return plural(m, 'minute');
  return m % 60 ? `${h} h ${m % 60} min` : plural(h, 'hour');
}
// Elapsed time, rounded down to the minute: "52 min", "1 h 5 min", "3 h".
export function elapsedText(ms) {
  const m = Math.max(0, Math.floor(ms / 60000)), h = Math.floor(m / 60);
  if (m < 60) return `${m} min`;
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
}
export const deviceName = device => {
  const id = device.deviceId ?? device.device_id, label = device.label;
  return label && label !== id ? `${label} (${id})` : id;
};
// Discord shows <t:…> tokens in each reader's own time zone; the dashboard preview converts them back.
const stamp = (ms, style) => `<t:${Math.floor(ms / 1000)}:${style}>`;
const fixed = (value, digits, unit) => Number.isFinite(value) ? `${value.toFixed(digits)}${unit}` : 'n/a';

// reading: an unpacked sample with `time` (ms). since: episode start in ms (or null for an unknown start).
export function messageVariables({ device, reading, since = null, sinceIsLowerBound = false, afterMinutes, now }) {
  const r = reading ?? {}, latest = Number.isFinite(r.time) ? r.time : now, start = Number.isFinite(since) ? since : null;
  return {
    device: deviceName(device),
    elapsed: start === null ? 'n/a' : elapsedText(latest - start),
    duration: durationText(afterMinutes),
    since: start === null ? 'n/a' : `${sinceIsLowerBound ? 'before ' : ''}${stamp(start, 'f')}`,
    since_relative: start === null ? 'n/a' : stamp(start, 'R'),
    time: stamp(latest, 't'),
    gas_mv: fixed(r.mqMv, 0, ' mV'),
    threshold_mv: fixed(r.mqThresholdMv, 0, ' mV'),
    ratio: fixed(r.mqRatio, 2, '×'),
    temperature: fixed(r.ahtTemperatureC ?? r.bmpTemperatureC, 1, ' °C'),
    humidity: fixed(r.humidityPct, 0, ' %'),
    status: typeof r.status === 'string' && r.status ? r.status : 'unknown',
  };
}

export const renderTemplate = (template, vars) => String(template).replace(/\{([A-Za-z_]+)\}/g, (match, name) => Object.hasOwn(vars, name) ? vars[name] : match);

// Final message text: optional mention, the rendered template (shortened to fit Discord), the fixed scope footer.
export function buildMessage(template, vars, { mention = 'none', test = false } = {}) {
  const prefix = mention === 'here' ? '@here ' : mention === 'everyone' ? '@everyone ' : '';
  const header = test ? TEST_HEADER + '\n' : '';
  let body = renderTemplate(template, vars).trim();
  const room = DISCORD_MAX - prefix.length - header.length - SCOPE_FOOTER.length - 1;
  if (body.length > room) body = body.slice(0, room - 1) + '…';
  return `${header}${prefix}${body}\n${SCOPE_FOOTER}`;
}
