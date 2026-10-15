export class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
export const DEFAULT_CONFIG = Object.freeze({ mqThresholdMode: 'automatic', manualThresholdMv: null, warningConsecutiveSamples: 3, samplingIntervalSec: 2 });
export const COMMAND_TYPES = ['CAL_SHOW', 'CAL_EXPORT', 'CAL_START', 'CAL_CANCEL', 'NET_STATUS', 'NET_RECONNECT', 'CONFIG_SHOW', 'RESTART', 'HELP'];
export const TERMINAL = new Set(['completed', 'failed', 'expired', 'uncertain']);
export const SAMPLE_FIELDS = ['seq', 'uptimeMs', 'sampledAt', 'mqRaw', 'mqMv', 'mqRatio', 'mqThresholdMv', 'ahtTemperatureC', 'humidityPct', 'bmpTemperatureC', 'pressureHpa', 'status', 'configRevision', 'calibrationRevision'];
const fail = message => { throw new ApiError(400, 'invalid_payload', message); };
export function object(value, name) { if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${name} must be an object`); return value; }
export function id(value, name = 'id') { if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(value)) fail(`${name} must contain 1-64 letters, digits, underscores or hyphens`); return value; }
export function integer(value, name, min = 0, max = Number.MAX_SAFE_INTEGER) { if (!Number.isSafeInteger(value) || value < min || value > max) fail(`${name} must be an integer from ${min} to ${max}`); return value; }
function text(value, name, max) { if (typeof value !== 'string' || value.length > max || /\u0000/.test(value)) fail(`${name} must be text up to ${max} characters`); return value; }
function measure(value, name, min, max) { if (value === null || value === undefined) return null; if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail(`${name} is outside its range; use null for unavailable data`); return value; }
function timestamp(value, name) { if (value === null || value === undefined) return null; if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*Z$/.test(value) || !Number.isFinite(Date.parse(value)) || Date.parse(value) > Date.now() + 300000) fail(`${name} must be UTC ISO text or null`); return new Date(value).toISOString(); }
function list(value, name, max) { if (value === undefined) return []; if (!Array.isArray(value) || value.length > max) fail(`${name} must be an array with at most ${max} entries`); return value; }
export function validateConfig(value) {
  const v = object(value, 'settings');
  if (Object.keys(v).some(k => !Object.hasOwn(DEFAULT_CONFIG, k))) fail('Unknown monitoring setting');
  if (!['automatic', 'manual'].includes(v.mqThresholdMode)) fail('mqThresholdMode must be automatic or manual');
  const threshold = v.manualThresholdMv === null ? null : integer(v.manualThresholdMv, 'manualThresholdMv', 10, 2399);
  if (v.mqThresholdMode === 'manual' && threshold === null) fail('Manual mode requires a threshold');
  return { mqThresholdMode: v.mqThresholdMode, manualThresholdMv: threshold, warningConsecutiveSamples: integer(v.warningConsecutiveSamples, 'warningConsecutiveSamples', 1, 10), samplingIntervalSec: integer(v.samplingIntervalSec, 'samplingIntervalSec', 2, 60) };
}
export function redact(message) {
  return message
    .replace(/\b[a-f0-9]{64}\b/gi, '[redacted]')
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+\/-]+=*/gi, '$1 [redacted]')
    .replace(/((?:password|token|authorization|secret|ssid)["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\r\n,;]+)/gi, '$1[redacted]')
    .slice(0, 512);
}
export function validateExchange(value) {
  const v = object(value, 'exchange');
  if (v.protocolVersion !== 1) fail('protocolVersion must be 1');
  const deviceId = id(v.deviceId, 'deviceId'), bootId = id(v.bootId, 'bootId');
  const s = object(v.state, 'state'), uptimeMs = integer(s.uptimeMs, 'state.uptimeMs');
  const state = {
    uptimeMs, firmwareVersion: text(s.firmwareVersion ?? 'unknown', 'firmwareVersion', 64),
    appliedConfigRevision: integer(s.appliedConfigRevision ?? 0, 'appliedConfigRevision'),
    configStatus: text(s.configStatus ?? 'pending', 'configStatus', 32), configError: redact(text(s.configError ?? '', 'configError', 512)),
    status: text(s.status ?? 'UNKNOWN', 'status', 200), calibrated: s.calibrated === true,
    warmupRemainingSec: integer(s.warmupRemainingSec ?? 0, 'warmupRemainingSec', 0, 86400),
    droppedReadings: integer(s.droppedReadings ?? 0, 'droppedReadings'), droppedLogs: integer(s.droppedLogs ?? 0, 'droppedLogs'),
  };
  if (!['pending', 'applied', 'failed'].includes(state.configStatus)) fail('Invalid configStatus');
  if (s.calibration != null) {
    const c = object(s.calibration, 'calibration');
    state.calibration = { revision: integer(c.revision, 'calibration.revision'), baselineMv: measure(c.baselineMv, 'baselineMv', 0, 3300), thresholdMv: measure(c.thresholdMv, 'thresholdMv', 0, 3300), sdMv: measure(c.sdMv, 'sdMv', 0, 3300), samples: integer(c.samples ?? 0, 'calibration.samples'), temperatureC: measure(c.temperatureC, 'calibration.temperatureC', -50, 150), humidityPct: measure(c.humidityPct, 'calibration.humidityPct', 0, 100) };
  }
  const readings = list(v.readings, 'readings', 30).map(raw => {
    const r = object(raw, 'reading');
    return { seq: integer(r.seq, 'reading.seq', 0, 4294967295), uptimeMs: integer(r.uptimeMs, 'reading.uptimeMs', 0, uptimeMs + 2000), sampledAt: timestamp(r.sampledAt, 'sampledAt'), mqRaw: measure(r.mqRaw, 'mqRaw', 0, 4095), mqMv: measure(r.mqMv, 'mqMv', 0, 3300), mqRatio: measure(r.mqRatio, 'mqRatio', 0, 10000), mqThresholdMv: measure(r.mqThresholdMv, 'mqThresholdMv', 0, 3300), ahtTemperatureC: measure(r.ahtTemperatureC, 'ahtTemperatureC', -50, 150), humidityPct: measure(r.humidityPct, 'humidityPct', 0, 100), bmpTemperatureC: measure(r.bmpTemperatureC, 'bmpTemperatureC', -50, 150), pressureHpa: measure(r.pressureHpa, 'pressureHpa', 100, 1500), status: text(r.status ?? 'UNKNOWN', 'reading.status', 200), configRevision: integer(r.configRevision ?? 0, 'configRevision'), calibrationRevision: integer(r.calibrationRevision ?? 0, 'calibrationRevision') };
  });
  const logs = list(v.logs, 'logs', 6).map(raw => {
    const l = object(raw, 'log');
    if (!['debug', 'info', 'warn', 'error'].includes(l.level)) fail('Invalid log level');
    return { seq: integer(l.seq, 'log.seq', 0, 4294967295), uptimeMs: integer(l.uptimeMs, 'log.uptimeMs', 0, uptimeMs + 2000), sampledAt: timestamp(l.sampledAt, 'log.sampledAt'), level: l.level, message: redact(text(l.message, 'log.message', 512)) };
  });
  const commandResults = list(v.commandResults, 'commandResults', 5).map(raw => {
    const c = object(raw, 'commandResult');
    if (!['accepted', 'running', 'completed', 'failed', 'uncertain'].includes(c.status)) fail('Invalid command result status');
    return { id: id(c.id, 'command id'), status: c.status, message: redact(text(c.message ?? '', 'command result', 512)) };
  });
  return { protocolVersion: 1, deviceId, bootId, state, readings, logs, commandResults };
}
export function validateCommand(value) {
  const v = object(value, 'command');
  if (!COMMAND_TYPES.includes(v.type)) fail('Unsupported command');
  const args = object(v.args ?? {}, 'args');
  if (v.type === 'CAL_START') {
    if (args.referenceConditionsConfirmed !== true || Object.keys(args).some(k => k !== 'referenceConditionsConfirmed')) fail('CAL_START requires referenceConditionsConfirmed=true');
  } else if (Object.keys(args).length) fail('This command takes no arguments');
  return { type: v.type, args, ttlSec: integer(v.ttlSec ?? 60, 'ttlSec', 15, 300) };
}
export function packSample(sample) { return SAMPLE_FIELDS.map(k => sample[k]); }
export function unpackSample(tuple, deviceId, bootId, anchorMs) {
  const result = Object.fromEntries(SAMPLE_FIELDS.map((key, index) => [key, tuple[index]]));
  return { deviceId, bootId, ...result, estimatedAt: new Date(anchorMs + result.uptimeMs).toISOString() };
}
export function mergeSamples(previous, incoming) {
  const map = new Map(previous.map(t => [t[0], t]));
  for (const sample of incoming) {
    const packed = packSample(sample), old = map.get(sample.seq);
    if (old && JSON.stringify(old) !== JSON.stringify(packed)) throw new ApiError(409, 'sample_conflict', 'A sample ID was reused with different values');
    map.set(sample.seq, packed);
  }
  const merged = [...map.values()].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  if (merged.length > 32) fail('More than 32 readings in a minute; sampling must be at least 2 seconds');
  return merged;
}
export function canTransition(oldStatus, newStatus, expiresAt, now = Date.now()) {
  if (oldStatus === newStatus) return true;
  if (TERMINAL.has(oldStatus)) return false;
  if (oldStatus === 'queued' && Date.parse(expiresAt) < now) return false;
  const order = { queued: 0, accepted: 1, running: 2, completed: 3, failed: 3, uncertain: 3 };
  return order[newStatus] >= order[oldStatus];
}
