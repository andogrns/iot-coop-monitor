// Deployment acceptance probe. Uses an isolated synthetic device; never touches real readings.
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url)),c=JSON.parse(await readFile(path.join(root,'.credentials.local.json'),'utf8'));
const base=new URL(process.argv[2]??c.workerUrl??'http://127.0.0.1:8787').origin,remote=!base.startsWith('http://127.0.0.1:');
const deviceId='synthetic-'+randomBytes(6).toString('hex'),token=randomBytes(32).toString('hex'),bootId='acceptance-boot';
await mkdir(path.join(root,'.local'),{recursive:true});
const report={base,deviceId,startedAt:new Date().toISOString(),checks:[]};let archiveKey;
async function request(route,method='GET',value,auth=c.ownerKey,extra={}){const r=await fetch(base+route,{method,headers:{'content-type':'application/json',...(auth?{authorization:'Bearer '+auth}:{}),...extra},...(value===undefined?{}:{body:JSON.stringify(value)})});let data;try{data=await r.json();}catch{data=null;}return{status:r.status,data,headers:r.headers};}
function check(name,condition){assert.ok(condition,name);report.checks.push(name);console.log('OK '+name);}
function wrangler(args){try{return execFileSync(process.execPath,[path.join(root,'node_modules/wrangler/bin/wrangler.js'),...args],{cwd:root,encoding:'utf8',env:{...process.env,PATH:path.dirname(process.execPath)+';'+process.env.PATH},stdio:['ignore','pipe','pipe']});}catch(e){throw Error('Wrangler fixture operation failed: '+String(e.stderr??e.message).slice(0,500));}}
async function sql(query){const f=path.join(root,'.local/acceptance.sql');await writeFile(f,query);const raw=wrangler(['d1','execute','coop-monitor-db',remote?'--remote':'--local','--command',query,'--json']);return JSON.parse(raw);}
const state={uptimeMs:10000,firmwareVersion:'synthetic-acceptance',appliedConfigRevision:1,configStatus:'applied',status:'OK',calibrated:true};
const reading={seq:1,uptimeMs:10000,sampledAt:null,mqRaw:720,mqMv:580,mqRatio:1.04,mqThresholdMv:650,ahtTemperatureC:28.2,humidityPct:65.1,bmpTemperatureC:28.4,pressureHpa:1008.6,status:'OK',configRevision:1,calibrationRevision:1};
const payload={protocolVersion:1,deviceId,bootId,state,readings:[reading],logs:[{seq:1,uptimeMs:10000,sampledAt:null,level:'info',message:'password=example token='+token}],commandResults:[]};
const post=p=>request('/api/device/exchange','POST',p,token);
try{
 check('D1 health',(await request('/health', 'GET',undefined,null)).data.status==='ok');
 check('Private data rejects anonymous access',(await request('/api/snapshot','GET',undefined,null)).status===401);
 const login=await request('/auth/login','POST',{key:c.ownerKey},null,{origin:base});
 check('Owner login issues secure HttpOnly session',login.status===200&&/HttpOnly/.test(login.headers.get('set-cookie'))&&/Secure/.test(login.headers.get('set-cookie')));
 const cookie=login.headers.get('set-cookie').split(';')[0];
 check('Owner cookie authorizes reads',(await request('/api/snapshot','GET',undefined,null,{cookie})).status===200);
 check('Cross-origin cookie writes rejected',(await request('/api/maintenance','POST',{},null,{cookie,origin:'https://example.com'})).status===403);
 check('Synthetic device registration',(await request('/api/devices','POST',{deviceId,label:'Synthetic acceptance fixture',token})).status===201);
 check('Maintenance and capacity check',(await request('/api/maintenance','POST',{})).status===200);
 check('Wrong device credential rejected',(await request('/api/device/exchange','POST',payload,randomBytes(32).toString('hex'))).status===401);
 const first=await post(payload);check('Reading and log acknowledged',first.status===200&&first.data.acked.readings.length===1&&first.data.acked.logs.length===1&&!first.data.uploads.paused);
 report.singleExchangeDatabaseUsage=first.data.databaseUsage;
 check('Stable reading IDs can be retried',(await post(payload)).status===200);
 let h=(await request('/api/history?'+new URLSearchParams({deviceId}))).data;
 check('Retry is stored once; unknown UTC preserved',h.readings.length===1&&h.readings[0].sampledAt===null&&h.readings[0].mqMv===580);
 const conflict=structuredClone(payload);conflict.readings[0].mqMv=581;
 check('Conflicting sample values rejected',(await post(conflict)).status===409);
 const invalid=structuredClone(payload);invalid.readings[0].humidityPct=101;
 check('Invalid measurements rejected',(await post(invalid)).status===400);
 const concurrent=await Promise.all([2,3].map(seq=>post({...payload,readings:[{...reading,seq,uptimeMs:6000+seq*1000}],logs:[]})));
 check('Concurrent uploads retain both readings',concurrent.every(r=>r.status===200)&&(await request('/api/history?'+new URLSearchParams({deviceId}))).data.readings.length===3);
 const settings={mqThresholdMode:'manual',manualThresholdMv:700,warningConsecutiveSamples:4,samplingIntervalSec:2};
 check('Desired settings revision created',(await request(`/api/devices/${deviceId}/config`,'PUT',{expectedRevision:1,settings})).data.revision===2);
 check('Stale settings revision rejected',(await request(`/api/devices/${deviceId}/config`,'PUT',{expectedRevision:1,settings})).status===409);
 check('Exchange returns desired revision',(await post({...payload,readings:[],logs:[]})).data.desiredConfig.revision===2);
 check('Calibration requires reference confirmation',(await request(`/api/devices/${deviceId}/commands`,'POST',{type:'CAL_START'})).status===400);
 const command=(await request(`/api/devices/${deviceId}/commands`,'POST',{type:'CAL_SHOW'})).data;
 check('Allowlisted command delivered',(await post({...payload,readings:[],logs:[]})).data.commands.some(x=>x.id===command.id));
 const receipt=await post({...payload,readings:[],logs:[],commandResults:[{id:command.id,status:'completed',message:'Synthetic calibration status'}]});
 check('Command completion acknowledged',receipt.data.acked.commandResults.includes(command.id));
 check('Terminal command does not regress',(await post({...payload,readings:[],logs:[],commandResults:[{id:command.id,status:'running'}]})).data.rejected.commandResults.length===1);
 const expired=(await request(`/api/devices/${deviceId}/commands`,'POST',{type:'HELP'})).data;
 await sql(`UPDATE commands SET expires_at='2000-01-01T00:00:00.000Z' WHERE command_id='${expired.id}' AND device_id='${deviceId}';`);
 check('Expired queued command is not delivered',!(await post({...payload,readings:[],logs:[]})).data.commands.some(x=>x.id===expired.id));
 const log=(await request('/api/logs?'+new URLSearchParams({deviceId}))).data.logs[0];
 check('Uploaded log secrets are redacted',log.message.includes('[redacted]')&&!log.message.includes(token)&&!log.message.includes('example'));
 const consoleView=(await request('/api/snapshot?'+new URLSearchParams({consoleDeviceId:deviceId}))).data.console;
 check('Console refresh combines state, logs and commands',consoleView.logs.length===1&&consoleView.commands.some(x=>x.id===command.id));
 await request(`/api/devices/${deviceId}/uploads`,'PUT',{paused:true});
 const pause=await post({...payload,readings:[{...reading,seq:4}],logs:[]});check('Owner pause does not acknowledge unwritten readings',pause.data.uploads.paused&&pause.data.acked.readings.length===0);
 await request(`/api/devices/${deviceId}/uploads`,'PUT',{paused:false});
 check('Uploads resume',(await post({...payload,readings:[],logs:[]})).data.uploads.paused===false);
 const csv=await fetch(base+'/api/export?'+new URLSearchParams({deviceId}),{headers:{authorization:'Bearer '+c.ownerKey}});
 check('Authenticated CSV export',csv.status===200&&(await csv.text()).includes('estimatedAt'));
 // Seed an explicitly synthetic aged block; exercises actual R2 write/readback and D1 retention.
 const hour=new Date(Date.now()-31*86400000);hour.setUTCMinutes(0,0,0);const time=hour.toISOString(),block=time+'_archive-boot';
 const full=process.argv.includes('--full-archive'),blockCount=full?30:1,sampleCount=full?900:1;
 const inserts=Array.from({length:blockCount},(_,minute)=>{
   const samples=Array.from({length:full?30:1},(_,n)=>{const seq=minute*30+n+1;return [seq,minute*60000+(n+1)*2000,null,720+seq%93,n===0&&minute===0?580:580+seq%19,1.04+(seq%5)/100,650,28.2+(seq%7)/10,65.1+(seq%11)/10,28.4+(seq%7)/10,1008.6+(seq%17)/10,'OK',1,1];});
   return `INSERT INTO reading_windows(device_id,block_id,boot_id,anchor_ms,data_json,state_json,received_at,revision) VALUES ('${deviceId}','${new Date(hour.getTime()+minute*60000).toISOString()}_archive-boot','archive-boot',${hour.getTime()},'${JSON.stringify(samples)}',NULL,'${time}',1);`;
 }).join('\n');
 const fixtureFile=path.join(root,'.local/archive-fixture.sql');await writeFile(fixtureFile,inserts);wrangler(['d1','execute','coop-monitor-db',remote?'--remote':'--local','--file',fixtureFile,'--json']);
 const m=(await request('/api/maintenance','POST',{})).data;
 check(`Old readings archived and readback verified (${sampleCount} samples)`,m.archive?.status==='archived'&&m.archive.sampleCount===sampleCount);archiveKey=m.archive.key;report.archive=m.archive;
 const download=await fetch(base+'/api/archive?'+new URLSearchParams({key:archiveKey}),{headers:{authorization:'Bearer '+c.ownerKey}}),bytes=Buffer.from(await download.arrayBuffer());
 check('Archive checksum and decompression',createHash('sha256').update(bytes).digest('hex')===m.archive.sha256&&JSON.parse(gunzipSync(bytes)).blocks[0].samples[0][4]===580);
 const catalog=(await request('/api/archives?'+new URLSearchParams({deviceId}))).data;
 check('Verified archive is in private catalog',catalog.archives.some(a=>a.object_key===archiveKey));
 const rows=await sql(`SELECT COUNT(*) AS n FROM reading_windows WHERE device_id='${deviceId}' AND boot_id='archive-boot';`);
 check('D1 aged source removed after verified archive',rows[0].results[0].n===0);
 check('Owner signout clears browser cookie',(await request('/auth/logout','POST',{},null,{cookie,origin:base})).headers.get('set-cookie').includes('Max-Age=0'));
 report.status='passed';
}catch(e){report.status='failed';report.failure=e.message;throw e;}finally{
 if(archiveKey)wrangler(['r2','object','delete','coop-monitor-archives/'+archiveKey,remote?'--remote':'--local']);
 await sql(`DELETE FROM devices WHERE device_id='${deviceId}';`);
 await request('/api/maintenance','POST',{});
 report.completedAt=new Date().toISOString();report.cleanedUp=true;
 const f=path.join(root,'.local',remote?'production-acceptance.json':'local-acceptance.json');await writeFile(f,JSON.stringify(report,null,2)+'\n');console.log('Report: '+f);
}
