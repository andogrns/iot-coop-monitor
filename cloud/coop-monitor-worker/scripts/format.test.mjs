import {test} from 'node:test';
import assert from 'node:assert/strict';
import {formatDate,formatDateTime,formatTime,relativeTime,formatNumber,formatBytes,describeStatus,hasStatus,statusTokens,niceTicks} from '../public/format.js';

const local=new Date(2026,10,5,16,24,58); // 5 Nov 2026, local time
test('dates use DD/MM/YYYY followed by the browser-locale time',()=>{
 assert.equal(formatDate(local),'05/11/2026');
 assert.equal(formatDateTime(local),'05/11/2026, '+local.toLocaleTimeString());
 assert.equal(formatDateTime(local.toISOString()),formatDateTime(local.getTime()));
 assert.equal(formatTime(local),local.toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'}));
 for(const missing of [null,undefined,'','not a date'])assert.equal(formatDateTime(missing),'—');
 assert.equal(formatDateTime(null,'UTC unknown'),'UTC unknown');
});
test('relative times step from seconds to days and tolerate small clock skew',()=>{
 const now=Date.parse('2026-11-15T12:00:00Z'),ago=s=>new Date(now-s*1000).toISOString();
 assert.equal(relativeTime(ago(0),now),'just now');
 assert.equal(relativeTime(ago(-3),now),'just now');
 assert.equal(relativeTime(ago(12),now),'12 s ago');
 assert.equal(relativeTime(ago(5*60+20),now),'5 min ago');
 assert.equal(relativeTime(ago(3*3600+59),now),'3 h ago');
 assert.equal(relativeTime(ago(86400*1.5),now),'1 day ago');
 assert.equal(relativeTime(ago(86400*2),now),'2 days ago');
 assert.equal(relativeTime(null,now),'—');
});
test('numbers format with units, fixed decimals and a dash for missing values',()=>{
 assert.equal(formatNumber(null),'—');
 assert.equal(formatNumber(Number.NaN),'—');
 assert.equal(formatNumber(0),'0');
 assert.equal(formatNumber(29.97,{digits:1,minDigits:1}),(30).toLocaleString(undefined,{minimumFractionDigits:1}));
 assert.match(formatNumber(156.8,{digits:1,unit:'mV'}),/ mV$/);
 assert.match(formatNumber(12,{unit:'%'}),/^12%$/);
 assert.equal(formatNumber(1009.65,{digits:1,grouping:false}),(1009.7).toLocaleString(undefined,{useGrouping:false}));
 assert.match(formatBytes(54235136),/^54\.2 MB$|^54,2 MB$/);
 assert.equal(formatBytes(512),'512 B');
});
test('firmware statuses become plain language with the most serious tone first',()=>{
 assert.deepEqual([describeStatus('OK').label,describeStatus('OK').tone],['Normal','ok']);
 const gas=describeStatus('GAS_WARNING');assert.equal(gas.tone,'danger');assert.match(gas.detail,/above the warning threshold/);
 assert.doesNotMatch(JSON.stringify(describeStatus('GAS_WARNING')),/ppm|ammonia/i);
 const combined=describeStatus('WARMUP|AHT_ERROR|BMP_ERROR');
 assert.equal(combined.tone,'warn');assert.equal(combined.items.length,3);assert.match(combined.label,/\+2 more$/);
 assert.deepEqual(statusTokens('WARMUP | AHT_ERROR | BMP_ERROR'),['WARMUP','AHT_ERROR','BMP_ERROR']);
 assert.equal(describeStatus('WARMUP').tone,'info');
 assert.equal(describeStatus('CAL_COLLECTING').tone,'info');
 assert.equal(describeStatus('CAL_MISSING').tone,'warn');
 assert.equal(describeStatus('MQ_ADC_HIGH').tone,'warn');
 assert.equal(describeStatus('ADC_HIGH').items[0].token,'MQ_ADC_HIGH');
 assert.equal(describeStatus('CALIBRATING').tone,'info');
 assert.equal(describeStatus('GAS_WARNING|AHT_ERROR|WARMUP').tone,'danger');
 assert.equal(describeStatus('').label,'No status');assert.equal(describeStatus(null).tone,'muted');
});
test('unknown firmware tokens are shown verbatim, never hidden',()=>{
 const unknown=describeStatus('NEW_FLAG');assert.equal(unknown.label,'NEW_FLAG');assert.equal(unknown.tone,'muted');
 const mixed=describeStatus('OK|NEW_FLAG');assert.equal(mixed.label,'NEW_FLAG');assert.ok(mixed.items.some(i=>i.label==='NEW_FLAG'));
 assert.ok(describeStatus('WARMUP|NEW_FLAG').items.some(i=>i.label==='NEW_FLAG'));
});
test('hasStatus matches whole tokens and aliases',()=>{
 assert.ok(hasStatus('WARMUP|GAS_WARNING','GAS_WARNING'));
 assert.ok(hasStatus('ADC_HIGH','MQ_ADC_HIGH'));
 assert.ok(!hasStatus('OK','GAS_WARNING'));
 assert.ok(!hasStatus(null,'GAS_WARNING'));
});
test('axis ticks are round, cover the range and never repeat when printed',()=>{
 for(const [min,max] of [[579.2,581.4],[133,140],[1009.4,1009.8],[0,1],[24.4,30.5],[-3,2],[5,5]]){
  const t=niceTicks(min,max,5);
  assert.ok(t.min<=Math.min(min,max)&&t.max>=Math.max(min,max),`covers ${min}-${max}`);
  assert.ok(t.ticks.length>=2&&t.ticks.length<=6,`count for ${min}-${max}: ${t.ticks.length}`);
  const labels=t.ticks.map(v=>v.toFixed(t.decimals));
  assert.equal(new Set(labels).size,labels.length,`unique labels for ${min}-${max}: ${labels}`);
 }
 assert.deepEqual(niceTicks(120,180,4).ticks,[120,140,160,180]);
 assert.equal(niceTicks(1009.4,1009.8,5).decimals,1);
});
