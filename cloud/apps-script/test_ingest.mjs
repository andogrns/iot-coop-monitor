import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const code = fs.readFileSync(new URL('./Code.gs', import.meta.url), 'utf8');
let rows = [], busy = false, throwAfterWrite = false, locked = false;
const token = 'a'.repeat(64);
const sheet = {
  getRange(row, col, length, width) {
    if (typeof row === 'string') return {setNumberFormat() {}};
    return {
      getValues: () => rows.slice(row - 1, row - 1 + length).map(r => r.slice(col - 1, col - 1 + width)),
      createTextFinder(id) { return {matchEntireCell() {return this;}, matchCase() {return this;},
        findNext: () => rows.slice(row - 1, row - 1 + length).find(r => r[col - 1] === id) || null}; },
      setValues(values) {
        values.forEach((value, i) => {rows[row - 1 + i] = value;});
        if (throwAfterWrite) {throwAfterWrite = false; throw Error('reply lost after durable append');}
      }
    };
  },
  getLastRow: () => rows.length,
  getMaxRows: () => 1000,
  insertRowsAfter() {},
  setFrozenRows() {},
  getParent: () => ({setSpreadsheetTimeZone() {}})
};
const context = vm.createContext({console,
  ContentService: {MimeType:{JSON:'json'}, createTextOutput: text => ({text,setMimeType(){return this;}})},
  PropertiesService: {getScriptProperties: () => ({getProperty: key => key === 'DEVICE_TOKEN' ? token : 'sheet-id'})},
  SpreadsheetApp: {openById: () => ({getSheetByName: name => name === 'Readings' ? sheet : null}), flush() {}},
  LockService: {getScriptLock: () => ({tryLock: () => busy ? false : (locked = true),
    hasLock: () => locked,releaseLock: () => {locked = false;}})}
});
vm.runInContext(code, context);
rows = [vm.runInContext('HEADERS.slice()', context)];
const sample = (sequence = 1) => ({
  id:`test-000000000000:${'0'.repeat(32)}:${sequence}`,device_id:'test-000000000000',
  boot_id:'0'.repeat(32),sample:sequence,uptime_s:30,sampled_utc_ms:null,reason:'Periodic',
  mq_raw:1800,mq_adc_mv:1100,mq_output_v:2.2,mq_ratio:null,aht_temp_c:29.45,
  humidity_pct:72.3,bmp_temp_c:null,pressure_hpa:null,status:'Calibration missing',dropped_total:0
});
const call = (records, override = {}) => JSON.parse(context.doPost({postData:{contents:JSON.stringify({
  version:1,token,records,...override})}}).text);
assert.equal(call([sample()]).ok,true);
assert.equal(rows.length,2);
assert.equal(rows[1][2],'');
assert.equal(rows[1][3],'Unknown');
assert.equal(rows[1][12],'NA');
assert.equal(rows[1][13],29.45);
assert.equal(call([sample()]).ok,true); // lost acknowledgement / replay
assert.equal(rows.length,2);
assert.equal(call([sample(2)],{token:'b'.repeat(64)}).error,'UNAUTHORIZED');
assert.equal(call([sample(),sample()]).error,'INVALID_RECORDS');
assert.equal(call(Array.from({length:21},(_,i)=>sample(i+2))).error,'INVALID_RECORDS');
assert.equal(call([{...sample(2),status:'=IMPORTXML("bad")'}]).error,'INVALID_RECORDS');
assert.equal(call([{...sample(2),humidity_pct:101}]).error,'INVALID_RECORDS');
assert.equal(call([{...sample(2),device_id:'=1+1'}]).error,'INVALID_RECORDS');
assert.equal(call([{...sample(2),sampled_utc_ms:1234}]).error,'INVALID_RECORDS');
busy = true; assert.equal(call([sample(2)]).error,'BUSY'); busy = false;
assert.equal(rows.length,2);
throwAfterWrite = true;
assert.equal(call([sample(2)]).error,'SERVER_ERROR');
assert.equal(rows.length,3);
assert.equal(call([sample(2)]).ok,true);
assert.equal(rows.length,3); // committed rows survive server-side exception without duplication
const timed = {...sample(3),sampled_utc_ms:1790895600000,status:'OK'};
assert.equal(call([timed]).ok,true);
assert.equal(rows[3][2].getTime(),timed.sampled_utc_ms);
assert.equal(rows[3][3],'NTP synchronized');
assert.deepEqual(call([sample(2),timed]).acknowledged,[sample(2).id,timed.id]);
assert.equal(rows.length,4);
assert.equal(JSON.parse(context.doPost({postData:{contents:'{broken'}}).text).error,'INVALID_JSON');
assert.equal(JSON.parse(context.doPost({postData:{contents:'x'.repeat(32769)}}).text).error,'INVALID_BODY');
rows[0][0] = 'Changed header';
assert.equal(call([sample(4)]).error,'SERVER_ERROR');
assert.equal(locked,false);
console.log('PASS: ingestion authentication, validation, typed measurements, unknown/NTP times, deduplication, lock contention and lost-response recovery.');
