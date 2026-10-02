/* Coop Monitor ingestion API v1. No endpoint serves stored measurements.
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
function configuredSheet(properties) {
  const id = properties.getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('NOT_CONFIGURED');
  const spreadsheet = SpreadsheetApp.openById(id);
  const sheet = spreadsheet.getSheetByName('Readings');
  if (!sheet) throw new Error('READINGS_TAB_MISSING');
  const actual = sheet.getRange(1, 1, 1, HEADERS.length).getValues()[0];
  if (!HEADERS.every((header, i) => actual[i] === header)) throw new Error('HEADER_MISMATCH');
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
function toRow(r, receivedAt) {
  const optional = value => value === null ? 'NA' : value;
  return [r.id, receivedAt, r.sampled_utc_ms === null ? '' : new Date(r.sampled_utc_ms),
    r.sampled_utc_ms === null ? 'Unknown' : 'NTP synchronized', r.device_id,
    r.boot_id, r.reason, r.sample, r.uptime_s, r.mq_raw, r.mq_adc_mv,
    optional(r.mq_output_v), optional(r.mq_ratio), optional(r.aht_temp_c),
    optional(r.humidity_pct), optional(r.bmp_temp_c), optional(r.pressure_hpa),
    r.status, r.dropped_total];
}
function doGet() { return reply({service: 'coop-monitor-ingest', version: 1}); }
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
    if (request.version !== 1 || !Array.isArray(request.records) ||
        request.records.length < 1 || request.records.length > 20 ||
        !request.records.every(validRecord) ||
        new Set(request.records.map(record => record.id)).size !== request.records.length)
      return reply({ok: false, error: 'INVALID_RECORDS'});
    lock = LockService.getScriptLock();
    if (!lock.tryLock(1000)) return reply({ok: false, error: 'BUSY'});
    const sheet = configuredSheet(properties);
    const lastRow = sheet.getLastRow();
    const ids = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, 1) : null;
    const receivedAt = new Date();
    const newRecords = request.records.filter(record => !ids ||
      !ids.createTextFinder(record.id).matchEntireCell(true).matchCase(true).findNext());
    if (newRecords.length) {
      const needed = lastRow + newRecords.length;
      if (needed > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), needed - sheet.getMaxRows());
      sheet.getRange(lastRow + 1, 1, newRecords.length, HEADERS.length)
        .setValues(newRecords.map(record => toRow(record, receivedAt)));
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
