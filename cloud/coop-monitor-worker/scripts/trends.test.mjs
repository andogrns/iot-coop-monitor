import {test} from 'node:test';
import assert from 'node:assert/strict';
import {TREND_HOURS,TrendData,mergeReadings,segmentsFor,reduceSegment} from '../public/trends.js';
const to=Date.parse('2026-10-12T12:00:00Z');
const sample=(seq,time=to-10000,mqMv=842,bootId='boot')=>({deviceId:'coop',bootId,seq,estimatedAt:new Date(time).toISOString(),sampledAt:null,mqMv});
test('each approved range requests its entire interval and follows history pagination',async()=>{
 for(const hours of TREND_HOURS){const calls=[];const model=new TrendData(async path=>{const q=new URL('https://test'+path).searchParams;calls.push(q);return q.has('cursor')?{readings:[sample(2,to-5000)],nextCursor:null}:{readings:[sample(1)],nextCursor:'page-two'};});
 const result=await model.load('coop',hours,to);assert.equal(calls.length,2);assert.equal(Date.parse(calls[0].get('to'))-Date.parse(calls[0].get('from')),hours*3600000);assert.equal(calls[1].get('cursor'),'page-two');assert.equal(calls[0].get('limit'),'60');assert.deepEqual(result.readings.map(r=>r.seq),[1,2]);}
});
test('incremental refresh overlaps two minutes, deduplicates and prunes expired samples',async()=>{
 const queries=[];let round=0;const model=new TrendData(async path=>{queries.push(new URL('https://test'+path).searchParams);return {readings:round++?[sample(2),sample(3,to+10000)]:[sample(1,to-3600000),sample(2)],nextCursor:null};});
 await model.load('coop',1,to);const result=await model.load('coop',1,to+60000);
 assert.equal(Date.parse(queries[1].get('from')),to-120000);assert.deepEqual(result.readings.map(r=>r.seq),[2,3]);
});
test('switching range or device loads the complete new range; force refresh bypasses overlap',async()=>{
 const calls=[];const model=new TrendData(async path=>{calls.push(new URL('https://test'+path).searchParams);return{readings:[],nextCursor:null};});
 await model.load('coop',1,to);await model.load('coop',24,to);await model.load('other',24,to);await model.load('other',24,to+60000,true);
 assert.equal(Date.parse(calls[1].get('from')),to-86400000);assert.equal(calls[2].get('deviceId'),'other');assert.equal(Date.parse(calls[3].get('from')),to+60000-86400000);
});
test('an old response cannot replace data after rapid range changes or cancellation',async()=>{
 let resolve;const model=new TrendData(async path=>new URL('https://test'+path).searchParams.get('deviceId')==='old'?new Promise(r=>resolve=r):{readings:[sample(2)],nextCursor:null});
 const old=model.load('old',1,to);const current=await model.load('coop',24,to);resolve({readings:[sample(1)],nextCursor:null});assert.equal(await old,null);assert.equal(model.cache,current);
 let resolve2;model.api=()=>new Promise(r=>resolve2=r);const cancelled=model.load('coop',24,to+1000);model.cancel(true);resolve2({readings:[],nextCursor:null});assert.equal(await cancelled,null);assert.equal(model.cache,null);
});
test('failed or repeated-cursor pages never silently publish a partial graph',async()=>{
 let count=0;const model=new TrendData(async()=>{if(count++)throw Error('network');return{readings:[sample(1)],nextCursor:'next'};});await assert.rejects(model.load('coop',1,to),/network/);assert.equal(model.cache,null);
 model.api=async()=>({readings:[sample(1)],nextCursor:'repeat'});await assert.rejects(model.load('coop',1,to),/too large/);assert.equal(model.cache,null);
 await assert.rejects(model.load('coop',2,to),/Choose/);
});
test('null sensor readings, time gaps and reboot boundaries break the line; zero remains valid',()=>{
 const rows=[sample(1,to-50000,0),sample(2,to-45000,null),sample(3,to-40000,2),sample(4,to-5000,3),sample(5,to,4,'new-boot')];
 assert.deepEqual(segmentsFor(rows,'mqMv',15000).map(s=>s.map(r=>r.seq)),[[1],[3],[4],[5]]);
});
test('display reduction preserves isolated extrema and segment endpoints',()=>{
 const rows=Array.from({length:10000},(_,i)=>sample(i,to-100000+i*5,i===3333?1800:i===7777?100:800));const reduced=reduceSegment(rows,'mqMv',100);
 assert.ok(reduced.length<=400);assert.equal(reduced[0].seq,0);assert.equal(reduced.at(-1).seq,9999);assert.ok(reduced.some(r=>r.seq===3333));assert.ok(reduced.some(r=>r.seq===7777));assert.equal(rows.length,10000);
});
test('time filtering uses server-anchored time and preserves boot-specific identities',()=>{
 const a=sample(1),b=sample(1,to-5000,900,'other');a.sampledAt='2020-01-01T00:00:00Z';assert.equal(mergeReadings([a],[a,b],to-20000,to).length,2);
});
