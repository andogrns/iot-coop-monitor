import { csvCell } from './csv.js';
import { METRICS, createTrends } from './trends.js?v=8053c6274bc5';
import { createManualArchives } from './manual-archive.js?v=503b1e7a2c45';
import { createArchiveLibrary } from './archive-library.js?v=b835f3cbae04';
import { createHistorySelection } from './history-selection.js?v=c869d8bb1be7';
const $=id=>document.getElementById(id);let snapshot,active='overview',historyCursor=null,logCursor=null,selected='',formDevice='',allReadings=[],historyRequest=0;
let serverOffset=0,refreshPending=false;
let historyLatest=true,historyRange=null;
const trends=createTrends({api,current,now:()=>Date.now()+serverOffset,isVisible:()=>active==='overview'&&!$('dashboard').hidden&&!document.hidden});
const pageHeadings={overview:['Environment Readings','Current readings and recent environmental trends.'],history:['Reading history','Recent observations, selected ranges and CSV exports.'],console:['Device console','Allowlisted commands and firmware-reported receipts.'],settings:['Monitoring settings','Desired settings remain pending until the device reports them.'],archives:['Archive library','Preserved observations in private storage.']};
const notice=t=>{$('notice').textContent=t;};
async function api(path,options={}){const r=await fetch(path,{...options,headers:{'content-type':'application/json',...options.headers}});const v=await r.json();if(!r.ok){if(r.status===401)showLogin();throw Error(v.message??v.error);}return v;}
const send=(path,method,value)=>api(path,{method,body:JSON.stringify(value)});
function showLogin(){$('login').hidden=false;$('dashboard').hidden=true;$('logout').hidden=true;$('navigation').hidden=true;trends.stop(true);historySelection.reset();archiveLibrary.reset();}
function showDashboard(){$('login').hidden=true;$('dashboard').hidden=false;$('logout').hidden=false;$('navigation').hidden=false;}
function current(){return snapshot?.devices.find(d=>d.deviceId===selected);}
function format(v,unit=''){return v===null||v===undefined?'—':`${Number(v).toLocaleString(undefined,{maximumFractionDigits:2})}${unit}`;}
function date(v){return v?new Date(v).toLocaleString():'UTC unknown';}
function historyDate(v){if(!v)return 'UTC unknown';const d=new Date(v);return d.toLocaleDateString('en-GB',{day:'2-digit',month:'2-digit',year:'numeric'})+', '+d.toLocaleTimeString();}
function localInput(d){return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);}
$('from').value=localInput(new Date(Date.now()-3600000));$('to').value=localInput(new Date());
$('archive-from').value=$('from').value;$('archive-to').value=$('to').value;
const manualArchives=createManualArchives({api,send,deviceId:()=>selected,reload:()=>loadArchives(true),refresh,notice});
const historySelection=createHistorySelection({api,deviceId:()=>selected});
const archiveLibrary=createArchiveLibrary({api,deviceId:()=>selected,continueArchive:job=>manualArchives.continueArchive(job),onUnauthorized:showLogin});
function renderCalibration(d){
 const s=d.state,c=s?.calibration,r=d.latestReading,valid=s?.calibrated===true&&c;
 const matching=valid&&r&&r.bootId===s.bootId&&r.calibrationRevision===c.revision&&r.configRevision===s.appliedConfigRevision;
 const relative=v=>valid&&c.baselineMv>0&&Number.isFinite(v)?`${format(v,' mV')} (${format(v/c.baselineMv,'× baseline')})`:format(v,' mV');
 const fields=valid?[
  ['Baseline',format(c.baselineMv,' mV')],
  ['Automatic warning threshold',relative(c.thresholdMv)],
  ['Active warning threshold · last sample',matching?relative(r.mqThresholdMv):'Waiting for matching reading'],
  ['Standard deviation',format(c.sdMv,' mV')],
  ['Calibration samples',format(c.samples)],
  ['Reference temperature',format(c.temperatureC,' °C')],
  ['Reference humidity',format(c.humidityPct,' %')],
  ['Calibration revision',String(c.revision)],
 ]:[];
 const status=!s?'No device report yet.':!valid?'No valid calibration reported.':`Calibration available · Last reported ${date(s.receivedAt)}${d.stale?' · Device offline; showing last reported values.':''}`;
 for(const panel of document.querySelectorAll('[data-calibration-panel]')){
  const compact=panel.closest('#overview')!==null;
  panel.querySelector('[data-calibration-status]').textContent=compact&&valid?`Calibration available${d.stale?' · Last reported values':''}`:status;
  const values=panel.querySelector('[data-calibration-values]');values.replaceChildren();
  const shown=compact&&valid?[fields[0],['Active threshold · last sample',fields[2][1]],['Reference conditions',format(c.temperatureC,' °C')+' / '+format(c.humidityPct,' %')],fields[3]]:fields;
  const add=(target,list)=>{for(const [label,value] of list){const item=document.createElement('div'),term=document.createElement('dt'),detail=document.createElement('dd');term.textContent=label;detail.textContent=value;item.append(term,detail);target.append(item);}};
  add(values,shown);
  if(compact){const summary=panel.querySelector('summary');summary.textContent='Calibration details';const explanation=panel.querySelector('.explanation');let extra=explanation.querySelector('dl');if(!extra){extra=document.createElement('dl');extra.className='calibration-values';explanation.append(extra);}extra.replaceChildren();add(extra,[['Last reported',date(s?.receivedAt)],...fields]);}
 }
}
function render(){const d=current();if(!d){$('freshness').textContent='No registered device';$('readings').replaceChildren();trends.stop(true);return;}const r=d.latestReading;
 renderCalibration(d);
 $('freshness').textContent=d.stale?'Offline / waiting for firmware':'Connected · '+(d.state?.status??'Reporting');$('freshness').classList.toggle('offline',d.stale);
 $('page-description').textContent=active==='overview'?`${r?'Last reading '+date(r.sampledAt??r.estimatedAt)+(r.sampledAt?'':' (estimated)'):'No readings yet'} · Last exchange ${date(d.state?.receivedAt)}`:pageHeadings[active][1];
 if(!$('readings').children.length)for(const m of METRICS){const card=document.createElement('button');card.type='button';card.className='metric-tile'+(m.key==='mqMv'?' selected':'');card.dataset.metric=m.key;card.setAttribute('aria-pressed',String(m.key==='mqMv'));const label=document.createElement('span'),value=document.createElement('span'),note=document.createElement('span');label.className='metric-label';label.textContent=m.label;value.className='metric-value';note.className='metric-note';card.append(label,value,note);card.addEventListener('click',()=>trends.selectMetric(m.key));$('readings').append(card);}
 for(const m of METRICS){const card=$('readings').querySelector(`[data-metric="${m.key}"]`),v=card.querySelector('.metric-value'),unit=document.createElement('small');unit.textContent=' '+m.unit;v.replaceChildren(document.createTextNode(Number.isFinite(r?.[m.key])?r[m.key].toLocaleString(undefined,{maximumFractionDigits:m.precision,useGrouping:false}):'—'),unit);card.querySelector('.metric-note').textContent=m.key==='mqMv'?`${format(r?.mqRatio,'× baseline')} · ${r?.status??'No sample'}`:m.description;}
 $('state').textContent=d.state?JSON.stringify(d.state,null,2):'No device exchange yet. Connect the firmware using the provisioned device credential.';
 const c=snapshot.capacity;$('capacity').textContent=`Database: ${format(c.databaseBytes/1e6)} / ${format(c.databaseLimitBytes/1e6)} MB\nArchives: ${format(c.archiveBytes/1e9)} / ${format(c.archiveLimitBytes/1e9)} GB\n${c.paused?'Uploads paused: '+c.reasons.join(', '):c.warning?'Capacity warning':'Capacity available'}`;
 $('capacity-details').textContent=`Estimated writes today: ${format(c.estimatedD1Writes)}\nUpload exchanges today: ${format(c.uploadRequests)}\nChecked: ${date(c.updatedAt)}`;
 const used=c.databaseLimitBytes>0?c.databaseBytes/c.databaseLimitBytes*100:null;$('capacity-percent').textContent=used===null?'Usage unavailable':`${format(used)}% used`;$('capacity-meter').hidden=used===null;$('capacity-meter').value=Math.min(100,used??0);
 $('pause').textContent=d.writesPaused?'Resume uploads':'Pause uploads';
 $('config-status').textContent=`Desired revision ${d.desiredConfig.revision}; applied ${d.state?.appliedConfigRevision??'unknown'} (${d.state?.configStatus??'waiting for firmware'})`;
 if(formDevice!==selected){fillSettings(d);formDevice=selected;}
 trends.sync();
}
function fillSettings(d){const c=d.desiredConfig.settings;$('threshold-mode').value=c.mqThresholdMode;$('manual-threshold').value=c.manualThresholdMv??'';$('consecutive').value=c.warningConsecutiveSamples;$('sample-interval').value=c.samplingIntervalSec;confirmationTime();}
function confirmationTime(){$('confirmation-time').textContent=`Consecutive-sample window: approximately ${Number($('consecutive').value)*Number($('sample-interval').value)} seconds. Warm-up and calibration guards still apply.`;}
async function refresh(){if(document.hidden||refreshPending)return;refreshPending=true;try{const p=new URLSearchParams();if(active==='console'&&selected){p.set('consoleDeviceId',selected);if(logCursor)p.set('cursor',logCursor);}snapshot=await api('/api/snapshot?'+p);if(Number.isFinite(Date.parse(snapshot.serverTime)))serverOffset=Date.parse(snapshot.serverTime)-Date.now();showDashboard();const ids=snapshot.devices.map(d=>d.deviceId);if(!ids.includes(selected))selected=ids[0]??'';if([...$('device').options].map(o=>o.value).join('|')!==ids.join('|')){$('device').replaceChildren(...snapshot.devices.map(d=>{const o=document.createElement('option');o.value=d.deviceId;o.textContent=d.label;return o;}));}$('device').value=selected;render();if(snapshot.console)renderConsole(snapshot.console);}catch(e){notice(e.message);}finally{refreshPending=false;}}
$('login-form').addEventListener('submit',async e=>{e.preventDefault();try{await send('/auth/login','POST',{key:$('owner-key').value});$('owner-key').value='';notice('');await refresh();}catch(e){notice(e.message);}});
$('logout').addEventListener('click',async()=>{try{await send('/auth/logout','POST',{});showLogin();}catch(e){notice(e.message);}});
$('device').addEventListener('change',()=>{selected=$('device').value;formDevice='';historyCursor=logCursor=null;allReadings=[];historyRequest++;manualArchives.reset();historySelection.reset();archiveLibrary.reset();$('history-rows').replaceChildren();$('history-count').textContent='';$('more-history').hidden=true;$('logs').textContent='';render();if(active==='history'){historySelection.countSelection();loadHistory(true,true).catch(e=>notice(e.message));}if(active==='archives'){loadArchives(true).catch(e=>notice(e.message));manualArchives.countSelection();}});
document.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',async()=>{active=b.dataset.tab;document.querySelectorAll('.tab').forEach(s=>s.hidden=s.id!==active);document.querySelectorAll('[data-tab]').forEach(x=>{x.classList.toggle('selected',x===b);x.setAttribute('aria-current',x===b?'page':'false');});$('page-title').textContent=pageHeadings[active][0];$('page-description').textContent=pageHeadings[active][1];if(active==='overview'){render();trends.draw();}else trends.stop();try{if(!current())return;if(active==='history'){historySelection.countSelection();await loadHistory(true,true);}if(active==='settings')fillSettings(current());if(active==='console')await loadConsole();if(active==='archives'){await loadArchives(true);await manualArchives.countSelection();}}catch(e){notice(e.message);}}));
function historyQuery(cursor,newestFirst=false){const p=new URLSearchParams({deviceId:selected,from:new Date($('from').value).toISOString(),to:new Date($('to').value).toISOString(),limit:'30'});if(cursor)p.set('cursor',cursor);if(newestFirst)p.set('order','desc');return p;}
function renderHistory(order){
 const readings=allReadings;
 $('history-rows').replaceChildren();
 for(const [index,r] of readings.entries()){const tr=document.createElement('tr');for(const v of [order==='asc'?index+1:readings.length-index,historyDate(r.sampledAt??r.estimatedAt)+(r.sampledAt?'':' (estimated)'),format(r.mqMv),format(r.mqRatio),format(r.ahtTemperatureC),format(r.humidityPct),format(r.pressureHpa),r.status]){const td=document.createElement('td');td.textContent=v;tr.append(td);}$('history-rows').append(tr);}
}
async function loadHistory(reset,latest=historyLatest,readRange=true){
 const request=++historyRequest,deviceId=selected;
 const pageSize=$('history-page-size').value;
 const order=$('history-order').value,orderLabel=order==='asc'?'oldest first':'newest first';
 if(reset){historyLatest=latest;if(!latest&&readRange)historyRange={from:new Date($('from').value).toISOString(),to:new Date($('to').value).toISOString()};allReadings=[];historyCursor=null;$('history-rows').replaceChildren();$('more-history').hidden=true;}
 $('more-history').disabled=true;
 $('history-count').textContent=latest?`Loading up to ${pageSize} recent readings (${orderLabel})…`:`Loading selected range (${orderLabel})…`;
 try{
  const query=new URLSearchParams({deviceId,pageSize,order,...(historyLatest?{mode:'latest'}:historyRange)});
  if(historyCursor)query.set('cursor',historyCursor);
  const page=await api('/api/history?'+query);
  if(request!==historyRequest||deviceId!==selected)return;
  historyCursor=page.nextCursor;allReadings.push(...page.readings);renderHistory(order);
  $('more-history').hidden=!historyCursor;
  $('history-count').textContent=`${historyLatest?'Recent ':''}${allReadings.length} readings loaded (${orderLabel})${historyCursor?'; more available':''}.`;
 }catch(e){if(request===historyRequest&&deviceId===selected)$('history-count').textContent='History could not be loaded.';throw e;}
 finally{if(request===historyRequest&&deviceId===selected)$('more-history').disabled=false;}
}
$('history-form').addEventListener('submit',async e=>{e.preventDefault();historySelection.countSelection();try{await loadHistory(true,false);}catch(e){notice(e.message);}});$('more-history').addEventListener('click',()=>loadHistory(false).catch(e=>notice(e.message)));
for(const control of ['history-page-size','history-order'])$(control).addEventListener('change',()=>{if(current())loadHistory(true,historyLatest,false).catch(e=>notice(e.message));});
$('export').addEventListener('click',async()=>{const button=$('export');button.disabled=true;try{let cursor=null,rows=[];do{const page=await api('/api/history?'+historyQuery(cursor));rows.push(...page.readings);cursor=page.nextCursor;if(rows.length>50000)throw Error('Select a smaller range (up to 50,000 readings per download).');}while(cursor);const fields=rows.length?Object.keys(rows[0]):['deviceId','bootId','seq','sampledAt','estimatedAt'];const csv=[fields.join(','),...rows.map(r=>fields.map(f=>csvCell(r[f])).join(','))].join('\r\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv'})),a=document.createElement('a');a.href=url;a.download='coop-readings.csv';a.click();URL.revokeObjectURL(url);notice(`Exported ${rows.length} readings.`);}catch(e){notice(e.message);}finally{button.disabled=false;}});
function renderConsole(l){logCursor=l.nextCursor;if(l.logs.length){$('logs').textContent+=l.logs.map(x=>`${date(x.sampled_at??x.received_at)} ${x.level.toUpperCase()} ${x.message}`).join('\n')+'\n';$('logs').textContent=$('logs').textContent.slice(-30000);}$('commands').textContent=l.commands.map(x=>`${x.type} · ${x.status}\n${x.id}\n${x.result?.message??''}`).join('\n\n')||'No commands.';}
async function loadConsole(){await refresh();}
$('command').addEventListener('change',()=>{$('cal-confirm-label').hidden=$('command').value!=='CAL_START';});
$('command-form').addEventListener('submit',async e=>{e.preventDefault();try{const type=$('command').value;if(['RESTART','NET_RECONNECT'].includes(type)&&!confirm(`Queue ${type}? This may interrupt uploads.`))return;const args=type==='CAL_START'?{referenceConditionsConfirmed:$('cal-confirm').checked}:{};const c=await send(`/api/devices/${selected}/commands`,'POST',{type,args,ttlSec:60});notice(`${type} queued (${c.id}).`);await loadConsole();}catch(e){notice(e.message);}});
$('settings-form').addEventListener('input',confirmationTime);
$('settings-form').addEventListener('submit',async e=>{e.preventDefault();try{const value={mqThresholdMode:$('threshold-mode').value,manualThresholdMv:$('manual-threshold').value?Number($('manual-threshold').value):null,warningConsecutiveSamples:Number($('consecutive').value),samplingIntervalSec:Number($('sample-interval').value)};await send(`/api/devices/${selected}/config`,'PUT',{expectedRevision:current().desiredConfig.revision,settings:value});notice('Desired settings saved; waiting for firmware application.');await refresh();}catch(e){notice(e.message);}});
$('pause').addEventListener('click',async()=>{try{await send(`/api/devices/${selected}/uploads`,'PUT',{paused:!current().writesPaused});await refresh();}catch(e){notice(e.message);}});
function loadArchives(reset){return archiveLibrary.load(reset);}
await refresh();setInterval(()=>{if(!$('dashboard').hidden)refresh();},4000);
document.addEventListener('visibilitychange',()=>{if(document.hidden)trends.stop();else if(!$('dashboard').hidden)refresh();});
