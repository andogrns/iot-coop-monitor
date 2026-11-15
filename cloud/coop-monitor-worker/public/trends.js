import { describeStatus, formatDateTime, formatNumber, formatTime, hasStatus, niceTicks } from './format.js?v=0242141ec619';
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
// ---- Chart (DOM) -----------------------------------------------------------------------------
// Smallest y-span per metric, so normal sensor noise is not stretched to full chart height.
const MIN_SPAN = { mqMv: 10, ahtTemperatureC: 2, humidityPct: 5, pressureHpa: 2 };
const SUBTITLE = {
  mqMv: 'Relative MQ-135 gas response in mV (not ammonia ppm)',
  ahtTemperatureC: 'Air temperature in °C (AHT20)',
  humidityPct: 'Relative humidity in % (AHT20)',
  pressureHpa: 'Air pressure in hPa (BMP280)',
};
const windowText = hours => hours === 1 ? 'the last hour' : `the last ${hours} hours`;
const timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

export function createTrends({api,current,now,isVisible,onData=()=>{}}) {
  const $=id=>document.getElementById(id),model=new TrendData(api);
  let metric=METRICS[0],hours=1,view=null,device='',busy=false,request=0,lastAttempt=0,selectedIndex=-1,valid=[],scales=null;
  const ns='http://www.w3.org/2000/svg';
  const el=(tag,attrs={},text)=>{const n=document.createElementNS(ns,tag);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,v);if(text!==undefined)n.textContent=text;return n;};
  const html=(tag,className,text)=>{const n=document.createElement(tag);if(className)n.className=className;if(text!==undefined)n.textContent=text;return n;};
  const value=v=>formatNumber(v,{digits:metric.precision,grouping:false});
  const tooltip=()=>$('trend-tooltip');
  function hideTooltip(){tooltip().hidden=true;}
  function showTooltip(r){
    if(!scales)return;
    const tip=tooltip(),status=describeStatus(r.status),badge=html('span',`badge ${status.tone}`,status.label);
    badge.title=r.status??'';
    tip.replaceChildren(html('div','tip-time',formatDateTime(readingTime(r))+(r.sampledAt?'':' (estimated)')),html('div','tip-value',`${value(r[metric.key])} ${metric.unit}`),badge);
    tip.hidden=false;
    const px=scales.x(readingTime(r)),py=scales.y(r[metric.key]),w=tip.offsetWidth,h=tip.offsetHeight;
    const left=px+14+w>scales.width?Math.max(0,px-14-w):px+14,top=Math.max(0,Math.min(py-h-10,scales.bottom-h));
    tip.style.setProperty('--tx',`${Math.round(left)}px`);tip.style.setProperty('--ty',`${Math.round(top)}px`);
  }
  function updateSelection(index,withTooltip=false) {
    selectedIndex=Math.max(0,Math.min(index,valid.length-1));const r=valid[selectedIndex];
    $('trend-svg').querySelector('[data-selection]')?.remove();
    if(!r||!scales){$('trend-detail').textContent='No reading selected';hideTooltip();return;}
    $('trend-scrub').value=String(selectedIndex);
    $('trend-detail').textContent=`${formatDateTime(readingTime(r))} · ${value(r[metric.key])} ${metric.unit} · ${describeStatus(r.status).label}${r.sampledAt?'':' · estimated time'}`;
    const g=el('g',{'data-selection':''}),x=scales.x(readingTime(r)),y=scales.y(r[metric.key]);
    g.append(el('line',{x1:x,x2:x,y1:scales.top,y2:scales.bottom,class:'chart-guide'}),el('circle',{cx:x,cy:y,r:5,class:'chart-focus'}));$('trend-svg').append(g);
    if(withTooltip)showTooltip(r);
  }
  // Latest reported threshold in the window (falls back to the device's latest reading).
  function thresholdFor(readings){
    for(let i=readings.length-1;i>=0;i--)if(Number.isFinite(readings[i].mqThresholdMv))return readings[i].mqThresholdMv;
    const t=current()?.latestReading?.mqThresholdMv;return Number.isFinite(t)?t:null;
  }
  function draw() {
    const svg=$('trend-svg'),width=svg.clientWidth,height=svg.clientHeight;if(!width||!height)return;
    hideTooltip();
    svg.replaceChildren();svg.setAttribute('viewBox',`0 0 ${width} ${height}`);
    const gas=metric.key==='mqMv';
    svg.setAttribute('aria-label',`${metric.label} in ${metric.unit}, ${windowText(hours)}. Gaps are not connected.`);
    $('trend-title').textContent=metric.label+' trend';$('trend-subtitle').textContent=SUBTITLE[metric.key]??`${metric.description} · ${metric.unit}`;
    $('trend-legend').hidden=!gas;
    const readings=view?.readings??[];valid=readings.filter(r=>Number.isFinite(r[metric.key]));
    $('trend-scrub').disabled=!valid.length;$('trend-scrub').max=String(Math.max(0,valid.length-1));
    const to=view?.to??now(),from=view?.from??to-hours*3600000;
    $('trend-window').textContent=`${formatDateTime(from)} – ${formatDateTime(to)} · ${timeZone()}`;
    const empty=$('trend-empty');empty.hidden=valid.length>0;
    empty.textContent=busy?'Loading the trend…':view?`No ${metric.label.toLowerCase()} readings in ${windowText(hours)}.`:'No trend data yet.';
    if(!valid.length){scales=null;$('trend-detail').textContent='No reading selected';return;}
    // ---- y range: data, minimum span, threshold when reasonably close, nice ticks
    let lo=Infinity,hi=-Infinity;for(const r of valid){lo=Math.min(lo,r[metric.key]);hi=Math.max(hi,r[metric.key]);}
    const minSpan=MIN_SPAN[metric.key]??1;
    if(hi-lo<minSpan){const mid=(hi+lo)/2;lo=mid-minSpan/2;hi=mid+minSpan/2;}
    const threshold=gas?thresholdFor(readings):null;let thresholdShown=false;
    if(threshold!==null){const span=hi-lo;if(threshold<=hi+span*2&&threshold>=lo-span*2){lo=Math.min(lo,threshold);hi=Math.max(hi,threshold);thresholdShown=true;}}
    const pad=(hi-lo)*.06,axis=niceTicks(lo-pad,hi+pad,height<280?4:5),min=axis.min,max=axis.max;
    const label=v=>formatNumber(v,{digits:axis.decimals,minDigits:axis.decimals,grouping:false});
    const widest=Math.max(...axis.ticks.map(v=>label(v).length));
    const left=Math.max(34,widest*7+14),right=12,top=18,bottom=height-26;
    const x=t=>left+(t-from)/(to-from)*(width-left-right),y=v=>top+(max-v)/(max-min)*(bottom-top);
    scales={x,y,left,right,top,bottom,width,from,to};
    svg.append(el('title',{},`${metric.label}: ${valid.length.toLocaleString()} readings in ${windowText(hours)}`),el('text',{x:4,y:11},metric.unit));
    for(const v of axis.ticks){const pos=y(v);svg.append(el('line',{x1:left,x2:width-right,y1:pos,y2:pos,class:'chart-grid'}),el('text',{x:left-8,y:pos+4,'text-anchor':'end'},label(v)));}
    // ---- x axis: round local times, time only (windows are at most 24 h)
    const maxLabels=Math.max(2,Math.floor((width-left-right)/84)),span=to-from;
    const step=[5,10,15,30,60,120,180,240,360,720].map(m=>m*60000).find(s=>span/s<=maxLabels)??43200000;
    const offset=new Date(from).getTimezoneOffset()*60000;
    for(let t=Math.ceil((from-offset)/step)*step+offset;t<=to;t+=step){const px=x(t);if(px<left+22||px>width-right-22)continue;svg.append(el('text',{x:px,y:height-6,'text-anchor':'middle'},formatTime(t)));}
    const interval=current()?.desiredConfig?.settings?.samplingIntervalSec??5,gapMs=Math.max(15000,interval*3000);
    // ---- gas warning periods (shaded) and threshold (dashed, labelled)
    if(gas){
      let start=null,last=null;
      const flush=()=>{if(start===null)return;const x1=x(start),x2=x(last);svg.append(el('rect',{x:Math.min(x1,x2-1.5),y:top,width:Math.max(3,x2-x1),height:bottom-top,class:'chart-warning'}));start=null;};
      for(const r of readings){const t=readingTime(r),warn=hasStatus(r.status,'GAS_WARNING');if(start!==null&&(!warn||t-last>gapMs))flush();if(warn){if(start===null)start=t;last=t;}}
      flush();
      if(threshold!==null){
        const text=`Warning threshold ${formatNumber(threshold,{digits:1,grouping:false})} mV`;
        if(thresholdShown){const ty=y(threshold);svg.append(el('line',{x1:left,x2:width-right,y1:ty,y2:ty,class:'chart-threshold'}),el('text',{x:left+4,y:ty-6,'text-anchor':'start',class:'chart-threshold-label'},text));}
        else svg.append(el('text',{x:width-right,y:11,'text-anchor':'end',class:'chart-threshold-label'},`${text} (${threshold>max?'above':'below'} this range)`));
      }
    }
    for(const segment of segmentsFor(readings,metric.key,gapMs)){
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
    $('trend-status').classList.remove('error');$('trend-status').textContent=`Loading ${windowText(hours)}…`;draw();
    try {
      const result=await model.load(d.deviceId,hours,now(),force,pages=>{if(token===request)$('trend-status').textContent=`Loading ${windowText(hours)} · ${pages} page${pages===1?'':'s'} so far…`;});
      if(!result||token!==request)return;
      view=result;selectedIndex=-1;
      $('trend-status').textContent=`${view.readings.length.toLocaleString()} readings in ${windowText(hours)}. Breaks in the line are gaps in the data. Updates every minute.`;
      onData();
    } catch(e) {if(token!==request||e.name==='AbortError')return;$('trend-status').classList.add('error');$('trend-status').textContent=`Couldn’t load the trend: ${e.message}${view?' Showing the data loaded earlier.':''}`;}
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
  // Min/max of a metric over the loaded window for the selected device (null when not loaded).
  function stats(key) {
    const d=current();if(!view||!d||view.deviceId!==d.deviceId)return null;
    let lo=Infinity,hi=-Infinity;for(const r of view.readings)if(Number.isFinite(r[key])){lo=Math.min(lo,r[key]);hi=Math.max(hi,r[key]);}
    return Number.isFinite(lo)?{min:lo,max:hi,hours:view.hours}:null;
  }
  $('trend-ranges').addEventListener('click',e=>{const b=e.target.closest('[data-hours]');if(!b)return;const next=Number(b.dataset.hours);if(!TREND_HOURS.includes(next))return;hours=next;document.querySelectorAll('[data-hours]').forEach(x=>{const yes=Number(x.dataset.hours)===hours;x.classList.toggle('selected',yes);x.setAttribute('aria-pressed',String(yes));});load();});
  $('trend-refresh').addEventListener('click',()=>load(true));
  $('trend-scrub').addEventListener('input',e=>updateSelection(Number(e.target.value),true));
  $('trend-scrub').addEventListener('blur',hideTooltip);
  const pick=e=>{if(!valid.length||!scales)return;const rect=$('trend-svg').getBoundingClientRect(),t=scales.from+(e.clientX-rect.left-scales.left)/(scales.width-scales.left-scales.right)*(scales.to-scales.from);let lo=0,hi=valid.length-1;while(lo<hi){const mid=(lo+hi)>>1;if(readingTime(valid[mid])<t)lo=mid+1;else hi=mid;}if(lo&&Math.abs(readingTime(valid[lo-1])-t)<Math.abs(readingTime(valid[lo])-t))lo--;updateSelection(lo,true);};
  $('trend-svg').addEventListener('pointermove',pick);
  $('trend-svg').addEventListener('pointerdown',pick);
  $('trend-svg').addEventListener('pointerleave',e=>{if(e.pointerType==='mouse')hideTooltip();});
  new ResizeObserver(draw).observe($('trend-chart'));
  return {sync,stop,selectMetric,draw,stats};
}
