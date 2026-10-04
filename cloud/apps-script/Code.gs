/* Coop Monitor ingestion API v1/v2. No endpoint serves stored measurements.
 * Script Properties: SPREADSHEET_ID and DEVICE_TOKEN (64 random hex digits).
 * Deploy as the owner, accessible to Anyone; the spreadsheet remains private.
 */
const HEADERS = [
  'Record ID', 'Received at (Jakarta)', 'Sampled at (Jakarta)', 'Time quality',
  'Device ID', 'Boot ID', 'Record reason', 'Sample number', 'Uptime (s)',
  'MQ raw ADC', 'MQ ADC (mV)', 'MQ output (V)', 'MQ baseline ratio',
  'AHT temperature (C)', 'Humidity (%RH)', 'BMP temperature (C)',
  'Pressure (hPa)', 'Status', 'Discarded pending records (total)'
];
const QUICK_HEADERS = HEADERS.concat([
  'Session ID', 'Elapsed test time (s)', 'Planned duration (min)', 'Session outcome',
  'Calibration baseline (mV)', 'Calibration threshold (mV)', 'Calibration SD (mV)',
  'Calibration samples', 'Calibration temperature (C)', 'Calibration humidity (%RH)'
]);
const FLAGS = ['Warming up', 'Calibration missing', 'Calibration stabilizing',
  'Calibration collecting', 'AHT sensor error', 'BMP sensor error',
  'OLED error', 'MQ ADC high', 'Gas warning'];

function reply(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}
function sameToken(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' ||
      !/^[0-9a-fA-F]{64}$/.test(left) || !/^[0-9a-fA-F]{64}$/.test(right)) return false;
  let difference = 0;
  for (let i = 0; i < 64; ++i) difference |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return difference === 0;
}
function integer(value, minimum, maximum) {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}
function numberOrNull(value) {
  return value === null || (typeof value === 'number' && Number.isFinite(value));
}
function validRecord(r) {
  if (!r || typeof r !== 'object' || typeof r.device_id !== 'string' ||
      !/^(coop|test)-[0-9a-f]{12}$/.test(r.device_id) ||
      typeof r.boot_id !== 'string' || !/^[0-9a-f]{32}$/.test(r.boot_id) ||
      typeof r.id !== 'string' || !r.id.startsWith(r.device_id + ':' + r.boot_id + ':') ||
      !/^[1-9][0-9]{0,19}$/.test(r.id.slice(r.device_id.length + r.boot_id.length + 2)) ||
      !integer(r.sample, 0, 4294967295) ||
      typeof r.uptime_s !== 'number' || !Number.isFinite(r.uptime_s) || r.uptime_s < 0 ||
      !(r.sampled_utc_ms === null || integer(r.sampled_utc_ms, 1704067200000, 4102444800000)) ||
      !['Periodic', 'Status change'].includes(r.reason) ||
      !integer(r.mq_raw, 0, 4095) || !integer(r.mq_adc_mv, 0, 5000) ||
      !integer(r.dropped_total, 0, Number.MAX_SAFE_INTEGER)) return false;
  for (const name of ['mq_output_v', 'mq_ratio', 'aht_temp_c', 'humidity_pct',
                      'bmp_temp_c', 'pressure_hpa']) if (!numberOrNull(r[name])) return false;
  if (r.humidity_pct !== null && (r.humidity_pct < 0 || r.humidity_pct > 100)) return false;
  if (typeof r.status !== 'string') return false;
  const flags = r.status.split(' | ');
  return r.status === 'OK' || (flags.length > 0 && new Set(flags).size === flags.length &&
                             flags.every(flag => FLAGS.includes(flag)));
}
function validSession(s) {
  if (!s || typeof s.id !== 'string' || !/^[0-9a-f]{32}$/.test(s.id) ||
      ![15, 30].includes(s.duration_min) ||
      !['Completed', 'Stopped', 'Interrupted', 'Storage error'].includes(s.outcome)) return false;
  const c = s.calibration;
  return !!c && typeof c.baseline_mv === 'number' && Number.isFinite(c.baseline_mv) &&
    c.baseline_mv >= 10 && typeof c.threshold_mv === 'number' && Number.isFinite(c.threshold_mv) &&
    c.threshold_mv > c.baseline_mv && c.threshold_mv < 2400 &&
    typeof c.sd_mv === 'number' && Number.isFinite(c.sd_mv) && c.sd_mv >= 0 &&
    integer(c.samples, 60, 4294967295) && numberOrNull(c.temperature_c) &&
    numberOrNull(c.humidity_pct) && (c.humidity_pct === null || (c.humidity_pct >= 0 && c.humidity_pct <= 100));
}
function configuredSheet(properties, quick = false) {
  const id = properties.getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('NOT_CONFIGURED');
  const spreadsheet = SpreadsheetApp.openById(id);
  const sheet = spreadsheet.getSheetByName(quick ? 'QuickTests' : 'Readings');
  if (!sheet) throw new Error('TAB_MISSING');
  const headers = quick ? QUICK_HEADERS : HEADERS;
  const actual = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  if (!headers.every((header, i) => actual[i] === header)) throw new Error('HEADER_MISMATCH');
  return sheet;
}
function setup() {
  const properties = PropertiesService.getScriptProperties();
  if (!/^[0-9a-f]{64}$/.test(properties.getProperty('DEVICE_TOKEN') || ''))
    throw new Error('Set DEVICE_TOKEN to 64 random lowercase hex digits first.');
  const sheet = configuredSheet(properties);
  sheet.getParent().setSpreadsheetTimeZone('Asia/Jakarta');
  sheet.setFrozenRows(1);
  sheet.getRange('B:C').setNumberFormat('yyyy-mm-dd hh:mm:ss');
  sheet.getRange('I:I').setNumberFormat('0.000');
  sheet.getRange('L:Q').setNumberFormat('0.000');
  sheet.getRange('A:A').setNumberFormat('@');
  sheet.getRange('E:F').setNumberFormat('@');
  console.log('Configured ingestion for the existing private spreadsheet.');
}
function toRow(r, receivedAt, session) {
  const optional = value => value === null ? 'NA' : value;
  const row = [r.id, receivedAt, r.sampled_utc_ms === null ? '' : new Date(r.sampled_utc_ms),
    r.sampled_utc_ms === null ? 'Unknown' : 'NTP synchronized', r.device_id,
    r.boot_id, r.reason, r.sample, r.uptime_s, r.mq_raw, r.mq_adc_mv,
    optional(r.mq_output_v), optional(r.mq_ratio), optional(r.aht_temp_c),
    optional(r.humidity_pct), optional(r.bmp_temp_c), optional(r.pressure_hpa),
    r.status, r.dropped_total];
  if (session) {
    const c = session.calibration;
    row.push(session.id, r.elapsed_test_s, session.duration_min, session.outcome,
      c.baseline_mv, c.threshold_mv, c.sd_mv, c.samples,
      optional(c.temperature_c), optional(c.humidity_pct));
  }
  return row;
}
function doGet() { return reply({service: 'coop-monitor-ingest', version: 2, supported_versions: [1, 2]}); }
function doPost(event) {
  let lock;
  try {
    const content = event && event.postData && event.postData.contents;
    if (typeof content !== 'string' || content.length > 32768)
      return reply({ok: false, error: 'INVALID_BODY'});
    let request;
    try { request = JSON.parse(content); }
    catch (_) { return reply({ok: false, error: 'INVALID_JSON'}); }
    const properties = PropertiesService.getScriptProperties();
    if (!request || !sameToken(request.token, properties.getProperty('DEVICE_TOKEN')))
      return reply({ok: false, error: 'UNAUTHORIZED'});
    const quick = request.version === 2;
    if (![1, 2].includes(request.version) || (quick && !validSession(request.session)) || !Array.isArray(request.records) ||
        request.records.length < 1 || request.records.length > 20 ||
        !request.records.every(r => validRecord(r) && (!quick ||
          (typeof r.elapsed_test_s === 'number' && Number.isFinite(r.elapsed_test_s) &&
           r.elapsed_test_s >= 0 && r.elapsed_test_s < request.session.duration_min * 60))) ||
        new Set(request.records.map(record => record.id)).size !== request.records.length)
      return reply({ok: false, error: 'INVALID_RECORDS'});
    lock = LockService.getScriptLock();
    if (!lock.tryLock(1000)) return reply({ok: false, error: 'BUSY'});
    const sheet = configuredSheet(properties, quick);
    const lastRow = sheet.getLastRow();
    const ids = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, 1) : null;
    const receivedAt = new Date();
    const newRecords = request.records.filter(record => !ids ||
      !ids.createTextFinder(record.id).matchEntireCell(true).matchCase(true).findNext());
    if (newRecords.length) {
      const needed = lastRow + newRecords.length;
      if (needed > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), needed - sheet.getMaxRows());
      sheet.getRange(lastRow + 1, 1, newRecords.length, quick ? QUICK_HEADERS.length : HEADERS.length)
        .setValues(newRecords.map(record => toRow(record, receivedAt, quick ? request.session : null)));
      SpreadsheetApp.flush();
    }
    // The ID column is authoritative. If a response is lost after this write,
    // the next request finds the same IDs and acknowledges without adding rows.
    return reply({ok: true, acknowledged: request.records.map(record => record.id)});
  } catch (_) {
    // Do not leak sheet IDs, tokens, incoming bodies, or exception text.
    return reply({ok: false, error: 'SERVER_ERROR'});
  } finally { if (lock && lock.hasLock()) lock.releaseLock(); }
}
