import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const code = fs.readFileSync(new URL('./Code.gs', import.meta.url), 'utf8');
let rows = [], quickRows = [], busy = false, throwAfterWrite = false, locked = false;
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
const quickSheet = {...sheet,
  getRange(row, col, length, width) {
    if (typeof row === 'string') return {setNumberFormat() {}};
    return {
      getValues: () => quickRows.slice(row - 1, row - 1 + length).map(r => r.slice(col - 1, col - 1 + width)),
      createTextFinder(id) { return {matchEntireCell() {return this;}, matchCase() {return this;},
        findNext: () => quickRows.slice(row - 1, row - 1 + length).find(r => r[col - 1] === id) || null}; },
      setValues(values) {
        values.forEach((value, i) => {quickRows[row - 1 + i] = value;});
        if (throwAfterWrite) {throwAfterWrite = false; throw Error('reply lost');}
      }
    };
  }, getLastRow: () => quickRows.length
};
const context = vm.createContext({console,
  ContentService: {MimeType:{JSON:'json'}, createTextOutput: text => ({text,setMimeType(){return this;}})},
  PropertiesService: {getScriptProperties: () => ({getProperty: key => key === 'DEVICE_TOKEN' ? token : 'sheet-id'})},
  SpreadsheetApp: {openById: () => ({getSheetByName: name => name === 'Readings' ? sheet : name === 'QuickTests' ? quickSheet : null}), flush() {}},
  LockService: {getScriptLock: () => ({tryLock: () => busy ? false : (locked = true),
    hasLock: () => locked,releaseLock: () => {locked = false;}})}
});
vm.runInContext(code, context);
rows = [vm.runInContext('HEADERS.slice()', context)];
quickRows = [vm.runInContext('QUICK_HEADERS.slice()', context)];
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
const session = {id:'1'.repeat(32),duration_min:30,outcome:'Stopped',
  calibration:{baseline_mv:1000,threshold_mv:1150,sd_mv:12,samples:150,temperature_c:29,humidity_pct:65}};
const quickCall = (records, override = {}) => call(records,{version:2,session,...override});
const quickSample = n => ({...sample(n),elapsed_test_s:(n-1)*2,status:'Warming up'});
assert.equal(quickCall([quickSample(1),quickSample(2)]).ok,true);
assert.equal(quickRows.length,3);
assert.equal(quickRows[1].length,29);
assert.equal(quickRows[1][19],session.id);
assert.equal(quickRows[2][20],2);
assert.deepEqual(Array.from(quickRows[1].slice(21)),[30,'Stopped',1000,1150,12,150,29,65]);
assert.equal(quickCall([quickSample(1),quickSample(2)]).ok,true);
assert.equal(quickRows.length,3); // Replay after lost acknowledgement.
assert.equal(quickCall([quickSample(3)],{token:'b'.repeat(64)}).error,'UNAUTHORIZED');
for (const invalid of [{...session,outcome:'Recording'}, {...session,id:'=1+1'},
  {...session,duration_min:20}, {...session,calibration:{...session.calibration,samples:59}},
  {...session,calibration:{...session.calibration,threshold_mv:900}},
  {...session,calibration:{...session.calibration,humidity_pct:101}}])
  assert.equal(quickCall([quickSample(3)],{session:invalid}).error,'INVALID_RECORDS');
for (const elapsed of [-1,1800,null,'2'])
  assert.equal(quickCall([{...quickSample(3),elapsed_test_s:elapsed}]).error,'INVALID_RECORDS');
busy = true; assert.equal(quickCall([quickSample(3)]).error,'BUSY'); busy = false;
throwAfterWrite = true; assert.equal(quickCall([quickSample(3)]).error,'SERVER_ERROR');
assert.equal(quickCall([quickSample(3)]).ok,true); assert.equal(quickRows.length,4);
const before = rows.length;
rows[0][0] = 'Record ID';
assert.equal(call([sample(10)]).ok,true); assert.equal(rows.length,before+1);
assert.equal(quickRows.length,4); // Original cloud API keeps its separate tab.
quickRows[0][0] = 'Broken'; assert.equal(quickCall([quickSample(4)]).error,'SERVER_ERROR');
assert.equal(locked,false);
console.log('PASS: v1/v2 authentication, schema, calibration snapshot, typed measurements, unknown/NTP times, tab isolation, deduplication, locks and lost-response recovery.');
