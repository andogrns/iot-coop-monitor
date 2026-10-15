export const TREND_HOURS = [1, 6, 12, 24];
export const METRICS = [
  { key: 'mqMv', label: 'Gas response', unit: 'mV', description: 'Divided ADC input', precision: 0 },
  { key: 'ahtTemperatureC', label: 'Temperature', unit: '°C', description: 'AHT20 sensor', precision: 1 },
  { key: 'humidityPct', label: 'Humidity', unit: '%', description: 'Relative humidity', precision: 1 },
  { key: 'pressureHpa', label: 'Pressure', unit: 'hPa', description: 'BMP280 sensor', precision: 1 },
];
// Use the same server-anchored timeline as the history endpoint's range filter.
export const readingTime = r => Date.parse(r.estimatedAt ?? r.sampledAt);
const readingId = r => `${r.deviceId}/${r.bootId}/${r.seq}`;
export function mergeReadings(previous, incoming, from, to) {
  const unique = new Map();
  for (const r of [...previous, ...incoming]) {
    const time = readingTime(r);
    if (Number.isFinite(time) && time >= from && time <= to) unique.set(readingId(r), r);
  }
  return [...unique.values()].sort((a,b) => readingTime(a)-readingTime(b) || a.bootId.localeCompare(b.bootId) || a.seq-b.seq);
}
export function segmentsFor(readings, key, gapMs) {
  const segments = []; let segment = [], previous;
  for (const r of readings) {
    const valid = Number.isFinite(r[key]);
    if (!valid || (previous && (r.bootId !== previous.bootId || readingTime(r)-readingTime(previous)>gapMs))) {
      if (segment.length) segments.push(segment);
      segment = [];
    }
    if (valid) segment.push(r);
    previous = r;
  }
  if (segment.length) segments.push(segment);
  return segments;
}
// Retain each bucket's endpoints and extrema: short spikes are not averaged away.
export function reduceSegment(rows, key, buckets) {
  if (rows.length <= buckets * 4) return rows;
  const size = Math.ceil(rows.length / buckets), result = [];
  for (let start=0; start<rows.length; start+=size) {
    const end=Math.min(start+size,rows.length); let min=start,max=start;
    for(let i=start+1;i<end;i++){if(rows[i][key]<rows[min][key])min=i;if(rows[i][key]>rows[max][key])max=i;}
    for(const i of [...new Set([start,min,max,end-1])].sort((a,b)=>a-b))result.push(rows[i]);
  }
  return result;
}
export class TrendData {
  constructor(api) { this.api=api; this.cache=null; this.pending=null; this.generation=0; }
  cancel(clear=false) { this.generation++;this.pending?.abort();this.pending=null;if(clear)this.cache=null; }
  async load(deviceId,hours,to=Date.now(),force=false,onProgress=()=>{}) {
    if (!TREND_HOURS.includes(hours)) throw Error('Choose 1h, 6h, 12h or 24h.');
    this.cancel();const generation=this.generation,controller=new AbortController();this.pending=controller;
    const from=to-hours*3600000,old=this.cache;
    const reuse=!force&&old?.deviceId===deviceId&&old.hours===hours&&to>=old.to&&to-old.to<hours*3600000;
    // Overlap two minutes to catch retries/late uploads, without repeatedly loading a whole day.
    const queryFrom=reuse?Math.max(from,old.to-120000):from;
    let cursor=null,incoming=[],pages=0;const cursors=new Set();
    try {
      do {
        const query=new URLSearchParams({deviceId,from:new Date(queryFrom).toISOString(),to:new Date(to).toISOString(),limit:'60'});
        if(cursor)query.set('cursor',cursor);
        const page=await this.api('/api/history?'+query,{signal:controller.signal});
        if(generation!==this.generation)return null;
        incoming.push(...page.readings);cursor=page.nextCursor;pages++;
        if(incoming.length>100000||pages>120||cursor&&cursors.has(cursor))throw Error('Trend range is too large. Choose a shorter range or use History.');
        if(cursor)cursors.add(cursor);
        onProgress(pages);
      } while(cursor);
      if(generation!==this.generation)return null;
      this.cache={deviceId,hours,from,to,readings:mergeReadings(reuse?old.readings:[],incoming,from,to)};
      return this.cache;
    } finally {if(generation===this.generation)this.pending=null;}
  }
}
export function createTrends({api,current,now,isVisible}) {
  const $=id=>document.getElementById(id),model=new TrendData(api);
  let metric=METRICS[0],hours=1,view=null,device='',busy=false,request=0,lastAttempt=0,selectedIndex=-1,valid=[],scales=null;
  const ns='http://www.w3.org/2000/svg';
  const el=(tag,attrs={},text)=>{const n=document.createElementNS(ns,tag);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,v);if(text!==undefined)n.textContent=text;return n;};
  const stamp=t=>new Date(t).toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
  const value=v=>Number(v).toLocaleString(undefined,{maximumFractionDigits:metric.precision});
  function updateSelection(index) {
    selectedIndex=Math.max(0,Math.min(index,valid.length-1));const r=valid[selectedIndex];
    $('trend-svg').querySelector('[data-selection]')?.remove();
    if(!r||!scales){$('trend-detail').textContent='No reading selected';return;}
    $('trend-scrub').value=String(selectedIndex);
    $('trend-detail').textContent=`${new Date(readingTime(r)).toLocaleString()} · ${value(r[metric.key])} ${metric.unit} · ${r.status??'Unknown status'}${r.sampledAt?'':' · Estimated time'}`;
    const g=el('g',{'data-selection':''}),x=scales.x(readingTime(r)),y=scales.y(r[metric.key]);
    g.append(el('line',{x1:x,x2:x,y1:25,y2:scales.bottom,class:'chart-guide'}),el('circle',{cx:x,cy:y,r:4,class:'chart-dot'}));$('trend-svg').append(g);
  }
  function draw() {
    const svg=$('trend-svg'),width=svg.clientWidth,height=svg.clientHeight;if(!width||!height)return;
    svg.replaceChildren();svg.setAttribute('viewBox',`0 0 ${width} ${height}`);
    svg.setAttribute('aria-label',`${metric.label} in ${metric.unit}, last ${hours} hours. Gaps are not connected.`);
    $('trend-title').textContent=metric.label+' trend';$('trend-subtitle').textContent=metric.description+' · '+metric.unit;
    const readings=view?.readings??[];valid=readings.filter(r=>Number.isFinite(r[metric.key]));
    $('trend-scrub').disabled=!valid.length;$('trend-scrub').max=String(Math.max(0,valid.length-1));
    const to=view?.to??now(),from=view?.from??to-hours*3600000;
    $('trend-window').textContent=`${stamp(from)} – ${stamp(to)} · ${Intl.DateTimeFormat().resolvedOptions().timeZone}`;
    const empty=$('trend-empty');empty.hidden=valid.length>0;
    empty.textContent=busy?'Loading trend…':view?`No ${metric.label.toLowerCase()} readings in this ${hours}h window.`:'Trend data is not available.';
    if(!valid.length){scales=null;$('trend-detail').textContent='No reading selected';return;}
    let min=Infinity,max=-Infinity;for(const r of valid){min=Math.min(min,r[metric.key]);max=Math.max(max,r[metric.key]);}
    const pad=Math.max((max-min)*.14,metric.key==='mqMv'?1:.1);min-=pad;max+=pad;
    const left=width<380?54:62,right=14,top=27,bottom=height-34;
    const x=t=>left+(t-from)/(to-from)*(width-left-right),y=v=>top+(max-v)/(max-min)*(bottom-top);
    scales={x,y,left,right,bottom,width,from,to};
    svg.append(el('title',{},`${metric.label}: ${valid.length.toLocaleString()} readings in ${hours} hours`),el('text',{x:4,y:12},metric.unit));
    for(let i=0;i<4;i++){const v=min+(max-min)*i/3,pos=y(v);svg.append(el('line',{x1:left,x2:width-right,y1:pos,y2:pos,class:'chart-grid'}),el('text',{x:left-9,y:pos+4,'text-anchor':'end'},value(v)));}
    const tickCount=width<380?2:width<560?3:4;
    for(let i=0;i<tickCount;i++){const t=from+(to-from)*i/(tickCount-1);svg.append(el('text',{x:x(t),y:height-9,'text-anchor':i===0?'start':i===tickCount-1?'end':'middle'},new Date(t).toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'})));}
    const interval=current()?.desiredConfig?.settings?.samplingIntervalSec??5;
    for(const segment of segmentsFor(readings,metric.key,Math.max(15000,interval*3000))){
      const reduced=reduceSegment(segment,metric.key,Math.max(25,Math.floor(width/4)));
      if(reduced.length===1)svg.append(el('circle',{cx:x(readingTime(reduced[0])),cy:y(reduced[0][metric.key]),r:2.5,class:'chart-dot'}));
      else svg.append(el('polyline',{points:reduced.map(r=>`${x(readingTime(r)).toFixed(2)},${y(r[metric.key]).toFixed(2)}`).join(' '),class:'chart-line'}));
    }
    updateSelection(selectedIndex<0?valid.length-1:selectedIndex);
  }
  async function load(force=false) {
    const d=current();if(!d||!isVisible())return;
    const token=++request;busy=true;lastAttempt=Date.now();$('trend-refresh').disabled=true;
    if(view?.deviceId!==d.deviceId||view?.hours!==hours){view=null;selectedIndex=-1;}
    $('trend-status').classList.remove('error');$('trend-status').textContent=`Loading ${hours}h trend…`;draw();
    try {
      const result=await model.load(d.deviceId,hours,now(),force,pages=>{if(token===request)$('trend-status').textContent=`Loading ${hours}h trend · ${pages} history page${pages===1?'':'s'}…`;});
      if(!result||token!==request)return;
      view=result;selectedIndex=-1;
      $('trend-status').textContent=`${view.readings.length.toLocaleString()} readings · Gaps shown as breaks · Trend updates every minute`;
    } catch(e) {if(token!==request||e.name==='AbortError')return;$('trend-status').classList.add('error');$('trend-status').textContent=`Trend unavailable: ${e.message}${view?' · Showing previously loaded data.':''}`;}
    finally {if(token===request){busy=false;$('trend-refresh').disabled=false;draw();}}
  }
  function stop(clear=false) {request++;model.cancel(clear);if(busy)lastAttempt=0;busy=false;$('trend-refresh').disabled=false;if(clear){view=null;device='';selectedIndex=-1;lastAttempt=0;draw();}}
  function sync() {
    const d=current();if(!d){stop(true);return;}
    if(device!==d.deviceId){stop(true);device=d.deviceId;}
    if(!isVisible())return;
    if(!busy&&Date.now()-lastAttempt>=60000&&(!view||now()-view.to>=60000))load();
  }
  function selectMetric(key) {metric=METRICS.find(m=>m.key===key)??METRICS[0];selectedIndex=-1;document.querySelectorAll('[data-metric]').forEach(b=>{const yes=b.dataset.metric===metric.key;b.classList.toggle('selected',yes);b.setAttribute('aria-pressed',String(yes));});draw();}
  $('trend-ranges').addEventListener('click',e=>{const b=e.target.closest('[data-hours]');if(!b)return;const next=Number(b.dataset.hours);if(!TREND_HOURS.includes(next))return;hours=next;document.querySelectorAll('[data-hours]').forEach(x=>{const yes=Number(x.dataset.hours)===hours;x.classList.toggle('selected',yes);x.setAttribute('aria-pressed',String(yes));});load();});
  $('trend-refresh').addEventListener('click',()=>load(true));
  $('trend-scrub').addEventListener('input',e=>updateSelection(Number(e.target.value)));
  $('trend-svg').addEventListener('pointermove',e=>{if(!valid.length||!scales)return;const rect=$('trend-svg').getBoundingClientRect(),t=scales.from+(e.clientX-rect.left-scales.left)/(scales.width-scales.left-scales.right)*(scales.to-scales.from);let lo=0,hi=valid.length-1;while(lo<hi){const mid=(lo+hi)>>1;if(readingTime(valid[mid])<t)lo=mid+1;else hi=mid;}if(lo&&Math.abs(readingTime(valid[lo-1])-t)<Math.abs(readingTime(valid[lo])-t))lo--;updateSelection(lo);});
  new ResizeObserver(draw).observe($('trend-chart'));
  return {sync,stop,selectMetric,draw};
}
