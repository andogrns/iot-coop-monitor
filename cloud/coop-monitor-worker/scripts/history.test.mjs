import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {history,blockKey} from '../src/storage.js';

const sample=(seq,uptimeMs)=>[seq,uptimeMs,null,720,800,1,920,28,60,28,1000,'OK',1,1];
function fixture(){
 const db=new DatabaseSync(':memory:');
 db.exec('CREATE TABLE reading_windows(device_id TEXT,block_id TEXT,boot_id TEXT,anchor_ms INTEGER,data_json TEXT,PRIMARY KEY(device_id,block_id)) WITHOUT ROWID');
 const env={DB:{prepare(sql){return{bind(...values){return{async all(){return{results:db.prepare(sql).all(...values)}}}}}}}};
 const add=(boot,anchor,tuples,device='test-device',uptime=tuples[0]?.[1]??0)=>db.prepare('INSERT INTO reading_windows VALUES (?,?,?,?,?)').run(device,blockKey(anchor,uptime,boot),boot,anchor,JSON.stringify(tuples));
 const query=params=>history(env,new URL('https://example.test/api/history?'+new URLSearchParams({deviceId:'test-device',mode:'latest',...params})));
 return{db,add,query};
}
test('returns exactly the newest 100 readings even when the device has been offline for hours',async()=>{
 const {db,add,query}=fixture(),anchor=Date.now()-3*3600000;
 try{
  for(let minute=0;minute<5;minute++)add('boot',anchor,Array.from({length:30},(_,n)=>sample(minute*30+n+1,minute*60000+n*2000)));
  for(let minute=0;minute<200;minute++)add('empty',Date.now()-minute*60000,[]);
  add('other',Date.now()-1000,[sample(999,0)],'other-device');
  const result=await query({});
  assert.deepEqual(result.readings.map(r=>r.seq),Array.from({length:100},(_,n)=>150-n));
  assert.equal(result.mode,'latest');assert.equal(result.nextCursor,null);
 }finally{db.close();}
});
test('handles sparse readings without assuming 100 samples fit in a few minute blocks',async()=>{
 const {db,add,query}=fixture(),anchor=Date.now()-3*86400000;
 try{
  for(let n=0;n<120;n++)add('boot',anchor,[sample(n+1,n*20*60000)]);
  assert.deepEqual((await query({})).readings.map(r=>r.seq),Array.from({length:100},(_,n)=>120-n));
 }finally{db.close();}
});
test('orders overlapping boot windows by reading time and includes a late sample in an earlier block',async()=>{
 const {db,add,query}=fixture(),anchor=Date.now()-2*3600000;
 try{
  for(let n=0;n<105;n++)add('boot-'+n,anchor+n*1000,[sample(n,n===0?59000:0)]);
  const expected=Array.from({length:105},(_,n)=>({seq:n,time:n===0?59000:n*1000})).sort((a,b)=>b.time-a.time||b.seq-a.seq).slice(0,100).map(r=>r.seq);
  const actual=(await query({})).readings;
  assert.equal(actual.length,100);assert.ok(actual.some(r=>r.seq===0));
  assert.deepEqual(actual.map(r=>r.seq),expected);
 }finally{db.close();}
});
test('returns fewer or no readings when appropriate, respects retention and validates count',async()=>{
 const {db,add,query}=fixture();
 try{
  assert.deepEqual((await query({})).readings,[]);
  add('old',Date.now()-31*86400000,[sample(999,0)]);
  add('future',Date.now()+120000,[sample(998,0)]);
  add('boot',Date.now()-60000,Array.from({length:7},(_,n)=>sample(n+1,n*2000)));
  assert.equal((await query({})).readings.length,7);
  assert.equal((await query({limit:3})).readings.length,3);
  await assert.rejects(query({limit:101}),e=>e.status===400);
 }finally{db.close();}
});
test('custom date ranges retain ascending block pagination',async()=>{
 const {db,add,query}=fixture(),anchor=Date.now()-600000;
 try{
  add('boot',anchor,[sample(1,2000)]);add('boot',anchor,[sample(2,62000)]);
  const range={mode:'range',from:new Date(anchor).toISOString(),to:new Date(anchor+120000).toISOString(),limit:1};
  const first=await query(range);assert.equal(first.readings[0].seq,1);assert.ok(first.nextCursor);
  const second=await query({...range,cursor:first.nextCursor});assert.equal(second.readings[0].seq,2);assert.equal(second.nextCursor,null);
 }finally{db.close();}
});
test('descending selected ranges start with newest samples and page toward older data without duplicates',async()=>{
 const {db,add,query}=fixture(),anchor=Date.now()-3600000;
 try{
  for(let minute=0;minute<4;minute++)add('boot',anchor,[sample(minute*2+1,minute*60000+2000),sample(minute*2+2,minute*60000+4000)]);
  const range={mode:'range',order:'desc',from:new Date(anchor).toISOString(),to:new Date(anchor+240000).toISOString(),limit:2};
  const first=await query(range);assert.deepEqual(first.readings.map(r=>r.seq),[8,7,6,5]);assert.ok(first.nextCursor);
  const second=await query({...range,cursor:first.nextCursor});assert.deepEqual(second.readings.map(r=>r.seq),[4,3,2,1]);assert.equal(second.nextCursor,null);
  assert.equal(new Set([...first.readings,...second.readings].map(r=>r.seq)).size,8);
  await assert.rejects(query({...range,order:'invalid'}),e=>e.status===400);
 }finally{db.close();}
});

test('entry pages honor all dropdown sizes and split minute blocks without gaps or duplicates',async()=>{
 const {db,add,query}=fixture(),anchor=Math.floor((Date.now()-3600000)/60000)*60000;
 try{
  for(let minute=0;minute<40;minute++)add('boot',anchor,Array.from({length:30},(_,n)=>sample(minute*30+n+1,minute*60000+n*2000)));
  for(const order of ['desc','asc'])for(const pageSize of [50,100,250,500,1000]){
   let cursor=null,seqs=[];
   do{const page=await query({pageSize,order,...(cursor?{cursor}:{})});assert.equal(page.order,order);assert.equal(page.readings.length,Math.min(pageSize,1200-seqs.length));seqs.push(...page.readings.map(r=>r.seq));cursor=page.nextCursor;}while(cursor);
   assert.deepEqual(seqs,Array.from({length:1200},(_,n)=>order==='asc'?n+1:1200-n));
  }
 }finally{db.close();}
});

test('oldest-first pages include boot-window overlap and deterministic equal-time ties across boundaries',async()=>{
 const {db,add,query}=fixture(),anchor=Date.now()-3600000;
 try{
  const expected=[];
  for(let n=0;n<150;n++){
   const boot='boot-'+String(n).padStart(3,'0'),offset=n===0?59000:0;
   add(boot,anchor+n*1000,[sample(n+1,offset)]);expected.push({seq:n+1,time:n*1000+offset,boot});
  }
  expected.sort((a,b)=>a.time-b.time||(a.boot<b.boot?-1:a.boot>b.boot?1:0));
  let cursor=null,actual=[];do{const p=await query({pageSize:50,order:'asc',...(cursor?{cursor}:{})});actual.push(...p.readings.map(r=>r.seq));cursor=p.nextCursor;}while(cursor);
  assert.deepEqual(actual,expected.map(r=>r.seq));
  const range={mode:'range',order:'asc',pageSize:50,from:new Date(anchor).toISOString(),to:new Date(anchor+59000).toISOString()};
  const first=await query(range),next=await query({...range,cursor:first.nextCursor});
  assert.deepEqual([...first.readings,...next.readings].map(r=>r.seq),expected.filter(r=>r.time<=59000).map(r=>r.seq));assert.equal(next.nextCursor,null);
 }finally{db.close();}
});

test('entry cursors bind ordering while supporting descending cursors issued before the dropdown',async()=>{
 const {db,add,query}=fixture(),anchor=Date.now()-3600000;
 try{
  for(let n=0;n<75;n++)add('boot',anchor,[sample(n+1,n*60000)]);
  await assert.rejects(query({pageSize:50,order:'invalid'}),e=>e.code==='invalid_order');
  const asc=await query({pageSize:50,order:'asc'}),desc=await query({pageSize:50,order:'desc'});
  await assert.rejects(query({pageSize:50,order:'desc',cursor:asc.nextCursor}),e=>e.code==='invalid_cursor');
  await assert.rejects(query({pageSize:50,order:'asc',cursor:desc.nextCursor}),e=>e.code==='invalid_cursor');
  const legacy=btoa(JSON.stringify(JSON.parse(atob(desc.nextCursor)).slice(0,6)));
  assert.deepEqual((await query({pageSize:50,cursor:legacy})).readings,(await query({pageSize:50,cursor:desc.nextCursor})).readings);
  await assert.rejects(query({pageSize:50,order:'asc',cursor:legacy}),e=>e.code==='invalid_cursor');
 }finally{db.close();}
});

test('entry range pages preserve exact boundaries and overlapping boot order at equal sample times',async()=>{
 const {db,add,query}=fixture(),anchor=Math.floor((Date.now()-3600000)/60000)*60000;
 try{
  for(let n=0;n<75;n++){
   // Alternating block positions while all readings have the same estimated time.
   add('boot-'+String(n).padStart(3,'0'),anchor+(n%2?59000:0),[sample(n+1,n%2?1000:60000)]);
  }
  add('outside',anchor,[sample(999,59999)]);add('other',anchor,[sample(999,60000)],'other-device');
  const range={mode:'range',pageSize:50,from:new Date(anchor+60000).toISOString(),to:new Date(anchor+60001).toISOString()};
  const first=await query(range),second=await query({...range,cursor:first.nextCursor});
  assert.deepEqual(first.readings.map(r=>r.seq),Array.from({length:50},(_,n)=>75-n));
  assert.deepEqual(second.readings.map(r=>r.seq),Array.from({length:25},(_,n)=>25-n));assert.equal(second.nextCursor,null);
 }finally{db.close();}
});

test('entry pages find sparse data beyond empty blocks and do not serve future or expired readings',async()=>{
 const {db,add,query}=fixture(),anchor=Date.now()-3*86400000;
 try{
  for(let n=0;n<1050;n++)add('boot',anchor,[sample(n+1,n*120000)]);
  for(let n=0;n<1100;n++)add('empty',Date.now()-n*60000,[]);
  add('old',Date.now()-31*86400000,[sample(9999,0)]);add('future',Date.now()+60000,[sample(9998,0)]);
  const first=await query({pageSize:1000}),second=await query({pageSize:1000,cursor:first.nextCursor});
  assert.equal(first.readings.length,1000);assert.equal(second.readings.length,50);
  assert.deepEqual([...first.readings,...second.readings].map(r=>r.seq),Array.from({length:1050},(_,n)=>1050-n));
 }finally{db.close();}
});

test('latest entry pagination freezes the time window and supports changing size at a cursor',async()=>{
 const {db,add,query}=fixture(),anchor=Date.now()-3600000;
 try{
  for(let minute=0;minute<30;minute++)add('boot',anchor,Array.from({length:4},(_,n)=>sample(minute*4+n+1,minute*60000+n*15000)));
  const first=await query({pageSize:50});assert.equal(first.readings.length,50);
  add('arrival',Date.now()-1,[sample(999,0)]);
  const next=await query({pageSize:100,cursor:first.nextCursor});
  assert.equal(next.from,first.from);assert.equal(next.to,first.to);assert.deepEqual(next.readings.map(r=>r.seq),Array.from({length:70},(_,n)=>70-n));
 }finally{db.close();}
});

test('entry pagination validates page size and binds cursors to device and date range',async()=>{
 const {db,add,query}=fixture(),anchor=Date.now()-3600000;
 try{
  for(let n=0;n<60;n++)add('boot',anchor,[sample(n+1,n*60000)]);
  for(const pageSize of [0,49,1001,50.5,'invalid'])await assert.rejects(query({pageSize}),e=>e.status===400);
  const range={mode:'range',pageSize:50,from:new Date(anchor).toISOString(),to:new Date(anchor+3600000).toISOString()};
  const first=await query(range);assert.ok(first.nextCursor);
  for(const cursor of ['bad!',btoa('{}'),btoa(JSON.stringify(['test-device',0,1000,500,'invalid boot',1])), 'x'.repeat(513)])await assert.rejects(query({...range,cursor}),e=>e.code==='invalid_cursor');
  await assert.rejects(query({...range,cursor:first.nextCursor,deviceId:'other-device'}),e=>e.code==='invalid_cursor');
  await assert.rejects(query({...range,cursor:first.nextCursor,to:new Date(anchor+3600001).toISOString()}),e=>e.code==='invalid_cursor');
 }finally{db.close();}
});

// Numbered pages: offset (no cursor) must return exactly the slice that cursor paging reaches.
const walk=async(query,params)=>{let cursor=null,all=[];do{const p=await query({...params,...(cursor?{cursor}:{})});all.push(...p.readings.map(r=>`${r.bootId}:${r.seq}`));cursor=p.nextCursor;}while(cursor);return all;};
test('offset pages equal cursor pages across overlapping boots, partial edge blocks and empty blocks',async()=>{
 const {db,add,query}=fixture(),base=Math.floor((Date.now()-5*3600000)/60000)*60000;
 try{
  // Three boots whose minute blocks overlap (anchors 0 s, 17 s and 41.5 s past the minute), with gaps and empty blocks.
  for(const [boot,shift,minutes,every] of [['boot-a',0,180,5000],['boot-b',17000,150,7000],['boot-c',41500,120,12000]]){
   let seq=0;
   for(let minute=0;minute<minutes;minute++){
    if(boot==='boot-b'&&minute>=40&&minute<55){add(boot,base+shift,[],'test-device',minute*60000);continue;}
    add(boot,base+shift,Array.from({length:Math.floor(60000/every)},(_,n)=>sample(++seq,minute*60000+n*every)));
   }
  }
  add('other',base,[sample(1,0)],'other-device');
  const range={mode:'range',from:new Date(base+29500).toISOString(),to:new Date(base+170*60000+12345).toISOString()};
  for(const order of ['desc','asc'])for(const pageSize of [50,100,250]){
   const all=await walk(query,{...range,order,pageSize:1000});
   assert.ok(all.length>2000);
   const last=Math.ceil(all.length/pageSize);
   for(const page of [1,2,3,Math.floor(last/3),Math.floor(last/2),last-1,last,last+1]){
    const result=await query({...range,order,pageSize,offset:(page-1)*pageSize});
    assert.deepEqual(result.readings.map(r=>`${r.bootId}:${r.seq}`),all.slice((page-1)*pageSize,page*pageSize),`${order} size ${pageSize} page ${page}`);
    assert.equal(result.offset,(page-1)*pageSize);
    assert.equal(result.nextCursor!==null,page*pageSize<all.length);
    if(result.nextCursor){const next=await query({...range,order,pageSize,cursor:result.nextCursor});assert.deepEqual(next.readings.map(r=>`${r.bootId}:${r.seq}`),all.slice(page*pageSize,(page+1)*pageSize));}
   }
  }
 }finally{db.close();}
});
test('offset pages handle equal sample times across boots and every offset near a block boundary',async()=>{
 const {db,add,query}=fixture(),anchor=Math.floor((Date.now()-3600000)/60000)*60000;
 try{
  for(let n=0;n<120;n++)add('boot-'+String(n).padStart(3,'0'),anchor+(n%2?59000:0),[sample(n+1,n%2?1000:60000),sample(n+501,n%2?31000:90000)]);
  const range={mode:'range',from:new Date(anchor).toISOString(),to:new Date(anchor+40*60000).toISOString()};
  for(const order of ['desc','asc']){
   const all=await walk(query,{...range,order,pageSize:1000});
   for(let offset=0;offset<=all.length+1;offset+=7){
    const result=await query({...range,order,pageSize:50,offset});
    assert.deepEqual(result.readings.map(r=>`${r.bootId}:${r.seq}`),all.slice(offset,offset+50),`${order} offset ${offset}`);
   }
  }
 }finally{db.close();}
});
test('offset pages work in latest mode and validate the offset',async()=>{
 const {db,add,query}=fixture(),anchor=Date.now()-3600000;
 try{
  for(let minute=0;minute<50;minute++)add('boot',anchor,Array.from({length:6},(_,n)=>sample(minute*6+n+1,minute*60000+n*10000)));
  const page=await query({pageSize:50,offset:100});
  assert.deepEqual(page.readings.map(r=>r.seq),Array.from({length:50},(_,n)=>200-n));assert.equal(page.mode,'latest');
  const pinned={mode:'range',from:page.from,to:page.to};
  assert.deepEqual((await query({...pinned,pageSize:50,offset:250})).readings.map(r=>r.seq),Array.from({length:50},(_,n)=>50-n));
  assert.deepEqual((await query({...pinned,pageSize:50,offset:0})).readings.map(r=>r.seq),(await query({...pinned,pageSize:50})).readings.map(r=>r.seq));
  for(const offset of [-1,1.5,'x',2000001])await assert.rejects(query({pageSize:50,offset}),e=>e.status===400);
  await assert.rejects(query({pageSize:50,offset:50,cursor:page.nextCursor}),e=>e.code==='invalid_offset');
  assert.equal((await query({pageSize:50,offset:0,cursor:page.nextCursor})).readings.length,50);
 }finally{db.close();}
});
