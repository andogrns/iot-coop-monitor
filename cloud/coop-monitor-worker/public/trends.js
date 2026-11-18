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
// Views: one reading at a time, every reading on its own chart side by side, or all on one chart.
export const CHART_VIEWS = ['single', 'split', 'combined'];
// Smallest y-span per metric, so normal sensor noise is not stretched to full chart height.
const MIN_SPAN = { mqMv: 10, ahtTemperatureC: 2, humidityPct: 5, pressureHpa: 2 };
const SUBTITLE = {
  mqMv: 'Relative MQ-135 gas response in mV (not ammonia ppm)',
  ahtTemperatureC: 'Air temperature in °C (AHT20)',
  humidityPct: 'Relative humidity in % (AHT20)',
  pressureHpa: 'Air pressure in hPa (BMP280)',
};
const SHORT = { mqMv: 'Gas', ahtTemperatureC: 'Temp.', humidityPct: 'Humidity', pressureHpa: 'Pressure' };
const VIEW_TEXT = {
  split: ['All readings, side by side', 'Each reading on its own scale, on one shared time axis. Gas response is relative mV, not ammonia ppm.'],
  combined: ['All readings on one chart', 'Each line is scaled to its own range, so shapes and timing can be compared. Gas response is relative mV, not ammonia ppm.'],
};
const VIEW_NOTE = {
  split: 'Each chart has its own scale; the time axis is the same for all four. Point at any chart, or use the slider, to read all four at the same moment.',
  combined: 'Each line runs from its own lowest value (Low) to its highest (High) in this window, listed on its button; very steady readings stay near the middle instead of being stretched. Heights cannot be compared between readings. Point at the chart, or use the slider, for the actual values.',
};
const windowText = hours => hours === 1 ? 'the last hour' : `the last ${hours} hours`;
const timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const PREFS_KEY = 'coop-monitor.trend-view';
function readPrefs() { try { const v = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null'); return v && typeof v === 'object' ? v : {}; } catch { return {}; } }
function writePrefs(value) { try { localStorage.setItem(PREFS_KEY, JSON.stringify(value)); } catch { /* storage blocked: the choice lasts for this page only */ } }

// Data min/max of one metric, plus the plotted lo/hi: at least minSpan wide, centred on the data.
export function valueRange(readings, key, minSpan = 0) {
  let min = Infinity, max = -Infinity;
  for (const r of readings) { const v = r[key]; if (Number.isFinite(v)) { if (v < min) min = v; if (v > max) max = v; } }
  if (!Number.isFinite(min)) return null;
  let lo = min, hi = max;
  if (hi - lo < minSpan) { const mid = (hi + lo) / 2; lo = mid - minSpan / 2; hi = mid + minSpan / 2; }
  return { min, max, lo, hi };
}
// Index of the reading closest in time to t (rows sorted by time); -1 when there are none.
export function nearestIndex(rows, t) {
  if (!rows.length) return -1;
  let lo = 0, hi = rows.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (readingTime(rows[mid]) < t) lo = mid + 1; else hi = mid; }
  if (lo && Math.abs(readingTime(rows[lo - 1]) - t) < Math.abs(readingTime(rows[lo]) - t)) lo--;
  return lo;
}
// Direct labels: sort by y and push neighbours at least `gap` apart, staying inside [top, bottom].
export function spreadLabels(items, gap, top, bottom) {
  const out = items.map(i => ({ ...i })).sort((a, b) => a.y - b.y);
  for (let i = 0; i < out.length; i++) out[i].y = Math.max(out[i].y, top, i ? out[i - 1].y + gap : -Infinity);
  for (let i = out.length - 1; i >= 0; i--) out[i].y = Math.min(out[i].y, bottom, i < out.length - 1 ? out[i + 1].y - gap : Infinity);
  return out;
}

export function createTrends({api,current,now,isVisible,onData=()=>{}}) {
  const $=id=>document.getElementById(id),model=new TrendData(api),prefs=readPrefs();
  let metric=METRICS[0],hours=1,view=null,device='',busy=false,request=0,lastAttempt=0,selectedIndex=-1,valid=[],scales=null,panels=null;
  let mode=CHART_VIEWS.includes(prefs.view)?prefs.view:'single';
  const hiddenSeries=new Set(Array.isArray(prefs.hidden)?prefs.hidden.filter(k=>METRICS.some(m=>m.key===k)):[]);
  if(hiddenSeries.size>=METRICS.length)hiddenSeries.clear();
  const savePrefs=()=>writePrefs({view:mode,hidden:[...hiddenSeries]});
  const ns='http://www.w3.org/2000/svg';
  const el=(tag,attrs={},text)=>{const n=document.createElementNS(ns,tag);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,v);if(text!==undefined)n.textContent=text;return n;};
  const html=(tag,className,text)=>{const n=document.createElement(tag);if(className)n.className=className;if(text!==undefined)n.textContent=text;return n;};
  const fmt=(m,v)=>formatNumber(v,{digits:m.precision,grouping:false});
  const value=v=>fmt(metric,v);
  const shownMetrics=()=>mode==='single'?[metric]:mode==='split'?METRICS:METRICS.filter(m=>!hiddenSeries.has(m.key));
  const tooltip=()=>$('trend-tooltip');
  function hideTooltip(){tooltip().hidden=true;}
  function showTooltip(r){
    if(!scales||scales.kind==='split')return;  // side by side: each chart's caption shows its value
    const tip=tooltip(),status=describeStatus(r.status),badge=html('span',`badge ${status.tone}`,status.label);
    badge.title=r.status??'';
    const time=html('div','tip-time',formatDateTime(readingTime(r))+(r.sampledAt?'':' (estimated)'));
    let py;
    if(scales.kind==='single'){tip.classList.remove('multi');tip.replaceChildren(time,html('div','tip-value',`${value(r[metric.key])} ${metric.unit}`),badge);py=scales.y(r[metric.key]);}
    else {
      const rows=[];py=Infinity;
      for(const line of scales.lines){
        const v=r[line.m.key],row=html('div','tip-row'),swatch=html('span',`series-swatch series series-${line.m.key}`);swatch.setAttribute('aria-hidden','true');
        row.append(swatch,html('span','tip-name',line.m.label),html('span','tip-val',Number.isFinite(v)?`${fmt(line.m,v)} ${line.m.unit}`:'—'));rows.push(row);
        if(Number.isFinite(v))py=Math.min(py,line.y(v));
      }
      tip.classList.add('multi');tip.replaceChildren(time,...rows,badge);
      if(!Number.isFinite(py))py=scales.top+40;
    }
    tip.hidden=false;
    const px=scales.x(readingTime(r)),w=tip.offsetWidth,h=tip.offsetHeight;
    const left=px+14+w>scales.width?Math.max(0,px-14-w):px+14,top=Math.max(0,Math.min(py-h-10,scales.bottom-h));
    tip.style.setProperty('--tx',`${Math.round(left)}px`);tip.style.setProperty('--ty',`${Math.round(top)}px`);
  }
  function detailText(r){
    const values=mode==='single'?`${value(r[metric.key])} ${metric.unit}`
      :shownMetrics().map(m=>`${SHORT[m.key]} ${Number.isFinite(r[m.key])?`${fmt(m,r[m.key])} ${m.unit}`:'—'}`).join(' · ');
    return `${formatDateTime(readingTime(r))} · ${values} · ${describeStatus(r.status).label}${r.sampledAt?'':' · estimated time'}`;
  }
  function marker(svg,x,top,bottom,dots){
    const g=el('g',{'data-selection':''});g.append(el('line',{x1:x,x2:x,y1:top,y2:bottom,class:'chart-guide'}));
    for(const [y,cls] of dots)g.append(el('circle',{cx:x,cy:y,r:5,class:cls}));
    svg.append(g);
  }
  function updateSelection(index,withTooltip=false) {
    selectedIndex=Math.max(0,Math.min(index,valid.length-1));const r=valid[selectedIndex];
    $('trend-chart').querySelectorAll('[data-selection]').forEach(n=>n.remove());
    if(!r||!scales){$('trend-detail').textContent='No reading selected';hideTooltip();return;}
    $('trend-scrub').value=String(selectedIndex);
    $('trend-detail').textContent=detailText(r);
    const t=readingTime(r);
    if(scales.kind==='single')marker($('trend-svg'),scales.x(t),scales.top,scales.bottom,[[scales.y(r[metric.key]),'chart-focus']]);
    else if(scales.kind==='combined')marker($('trend-svg'),scales.x(t),scales.top,scales.bottom,scales.lines.filter(l=>Number.isFinite(r[l.m.key])).map(l=>[l.y(r[l.m.key]),`chart-focus series series-${l.m.key}`]));
    else for(const p of scales.panels){
      const v=r[p.m.key];p.value.textContent=Number.isFinite(v)?`${fmt(p.m,v)} ${p.m.unit}`:'—';
      if(p.y)marker(p.svg,p.x(t),p.top,p.bottom,Number.isFinite(v)?[[p.y(v),`chart-focus series series-${p.m.key}`]]:[]);
    }
    if(withTooltip)showTooltip(r);
  }
  // Latest reported threshold in the window (falls back to the device's latest reading).
  function thresholdFor(readings){
    for(let i=readings.length-1;i>=0;i--)if(Number.isFinite(readings[i].mqThresholdMv))return readings[i].mqThresholdMv;
    const t=current()?.latestReading?.mqThresholdMv;return Number.isFinite(t)?t:null;
  }
  // Include the threshold in the y range when it is reasonably close to the data.
  function fitThreshold(lo,hi,threshold){
    if(threshold===null)return {lo,hi,shown:false};
    const span=hi-lo;
    return threshold<=hi+span*2&&threshold>=lo-span*2?{lo:Math.min(lo,threshold),hi:Math.max(hi,threshold),shown:true}:{lo,hi,shown:false};
  }
  // ---- shared drawing pieces
  function frame(svg){const width=svg.clientWidth,height=svg.clientHeight;if(!width||!height)return null;svg.replaceChildren();svg.setAttribute('viewBox',`0 0 ${width} ${height}`);return {width,height};}
  function yAxis(lo,hi,maxTicks){
    const pad=(hi-lo)*.06,axis=niceTicks(lo-pad,hi+pad,maxTicks),label=v=>formatNumber(v,{digits:axis.decimals,minDigits:axis.decimals,grouping:false});
    return {...axis,label,widest:Math.max(...axis.ticks.map(v=>label(v).length))};
  }
  function grid(svg,ticks,label,y,left,right,width){for(const v of ticks){const pos=y(v);svg.append(el('line',{x1:left,x2:width-right,y1:pos,y2:pos,class:'chart-grid'}));const text=label(v);if(text)svg.append(el('text',{x:left-8,y:pos+4,'text-anchor':'end'},text));}}
  // x axis: round local times, time only (windows are at most 24 h)
  function timeAxis(svg,x,from,to,left,right,width,height){
    const maxLabels=Math.max(2,Math.floor((width-left-right)/84)),span=to-from;
    const step=[5,10,15,30,60,120,180,240,360,720].map(m=>m*60000).find(s=>span/s<=maxLabels)??43200000;
    const offset=new Date(from).getTimezoneOffset()*60000;
    for(let t=Math.ceil((from-offset)/step)*step+offset;t<=to;t+=step){const px=x(t);if(px<left+22||px>width-right-22)continue;svg.append(el('text',{x:px,y:height-6,'text-anchor':'middle'},formatTime(t)));}
  }
  const gapFor=()=>{const interval=current()?.desiredConfig?.settings?.samplingIntervalSec??5;return Math.max(15000,interval*3000);};
  // Gas warning periods (shaded).
  function warnings(svg,readings,x,top,bottom,gapMs){
    let start=null,last=null;
    const flush=()=>{if(start===null)return;const x1=x(start),x2=x(last);svg.append(el('rect',{x:Math.min(x1,x2-1.5),y:top,width:Math.max(3,x2-x1),height:bottom-top,class:'chart-warning'}));start=null;};
    for(const r of readings){const t=readingTime(r),warn=hasStatus(r.status,'GAS_WARNING');if(start!==null&&(!warn||t-last>gapMs))flush();if(warn){if(start===null)start=t;last=t;}}
    flush();
  }
  // Warning threshold (dashed, labelled), or a note when it is outside the plotted range.
  function thresholdLine(svg,threshold,shown,y,left,right,width,max,label='Warning threshold'){
    const text=`${label} ${formatNumber(threshold,{digits:1,grouping:false})} mV`;
    if(shown){const ty=y(threshold);svg.append(el('line',{x1:left,x2:width-right,y1:ty,y2:ty,class:'chart-threshold'}),el('text',{x:left+4,y:ty-6,'text-anchor':'start',class:'chart-threshold-label'},text));}
    else svg.append(el('text',{x:width-right,y:11,'text-anchor':'end',class:'chart-threshold-label'},`${text} (${threshold>max?'above':'below'} this range)`));
  }
  function plotLine(svg,readings,key,x,y,gapMs,width,cls){
    for(const segment of segmentsFor(readings,key,gapMs)){
      const reduced=reduceSegment(segment,key,Math.max(25,Math.floor(width/4)));
      if(reduced.length===1)svg.append(el('circle',{cx:x(readingTime(reduced[0])),cy:y(reduced[0][key]),r:2.5,class:cls.replace('chart-line','chart-dot')}));
      else svg.append(el('polyline',{points:reduced.map(r=>`${x(readingTime(r)).toFixed(2)},${y(r[key]).toFixed(2)}`).join(' '),class:cls}));
    }
  }
  // ---- view: one reading
  function drawSingle(readings,from,to){
    const svg=$('trend-svg'),f=frame(svg);if(!f)return false;
    const {width,height}=f,gas=metric.key==='mqMv';
    svg.setAttribute('aria-label',`${metric.label} in ${metric.unit}, ${windowText(hours)}. Gaps are not connected.`);
    if(!valid.length)return true;
    const range=valueRange(valid,metric.key,MIN_SPAN[metric.key]??1),threshold=gas?thresholdFor(readings):null,fit=fitThreshold(range.lo,range.hi,threshold);
    const axis=yAxis(fit.lo,fit.hi,height<280?4:5);
    const left=Math.max(34,axis.widest*7+14),right=12,top=18,bottom=height-26;
    const x=t=>left+(t-from)/(to-from)*(width-left-right),y=v=>top+(axis.max-v)/(axis.max-axis.min)*(bottom-top);
    scales={kind:'single',x,y,left,right,top,bottom,width,from,to};
    svg.append(el('title',{},`${metric.label}: ${valid.length.toLocaleString()} readings in ${windowText(hours)}`),el('text',{x:4,y:11},metric.unit));
    grid(svg,axis.ticks,axis.label,y,left,right,width);
    timeAxis(svg,x,from,to,left,right,width,height);
    const gapMs=gapFor();
    if(gas){warnings(svg,readings,x,top,bottom,gapMs);if(threshold!==null)thresholdLine(svg,threshold,fit.shown,y,left,right,width,axis.max);}
    plotLine(svg,readings,metric.key,x,y,gapMs,width,'chart-line');
    return true;
  }
  // ---- view: every reading on its own chart, side by side, sharing the time axis
  function ensurePanels(){
    if(panels)return;
    panels=METRICS.map(m=>{
      const fig=html('figure','trend-panel'),cap=html('figcaption','panel-caption'),swatch=html('span',`series-swatch series series-${m.key}`);swatch.setAttribute('aria-hidden','true');
      const value=html('span','panel-value','—');
      cap.append(swatch,html('span','panel-name',m.label),html('span','panel-unit',m.key==='mqMv'?'mV, relative':m.unit),value);
      const svg=el('svg',{class:'trend-svg panel-svg',role:'img'});
      fig.append(cap,svg);$('trend-panels').append(fig);
      return {m,svg,value};
    });
  }
  function drawSplit(readings,from,to){
    const gapMs=gapFor(),threshold=thresholdFor(readings),plans=[];
    for(const p of panels){
      const f=frame(p.svg);if(!f)return false;
      p.svg.setAttribute('aria-label',`${p.m.label} in ${p.m.unit}, ${windowText(hours)}. Gaps are not connected.`);
      const range=valid.length?valueRange(readings,p.m.key,MIN_SPAN[p.m.key]??1):null;
      const fit=!range?null:p.m.key==='mqMv'?fitThreshold(range.lo,range.hi,threshold):{lo:range.lo,hi:range.hi,shown:false};
      plans.push({...p,...f,fit,axis:fit?yAxis(fit.lo,fit.hi,f.height<170?3:4):null});
    }
    // One left margin for every chart, so their time axes line up.
    const left=Math.max(34,...plans.map(p=>p.axis?p.axis.widest*7+14:0)),right=12,top=18,out=[];
    for(const p of plans){
      const bottom=p.height-24,x=t=>left+(t-from)/(to-from)*(p.width-left-right),entry={m:p.m,svg:p.svg,value:p.value,x,y:null,top,bottom};
      out.push(entry);
      if(!p.axis){if(valid.length)p.svg.append(el('text',{x:p.width/2,y:p.height/2,'text-anchor':'middle'},`No ${p.m.label.toLowerCase()} readings in ${windowText(hours)}`));continue;}
      const y=v=>top+(p.axis.max-v)/(p.axis.max-p.axis.min)*(bottom-top);entry.y=y;
      p.svg.append(el('title',{},`${p.m.label} (${p.m.unit}), ${windowText(hours)}`));
      grid(p.svg,p.axis.ticks,p.axis.label,y,left,right,p.width);
      timeAxis(p.svg,x,from,to,left,right,p.width,p.height);
      if(p.m.key==='mqMv'){warnings(p.svg,readings,x,top,bottom,gapMs);if(threshold!==null)thresholdLine(p.svg,threshold,p.fit.shown,y,left,right,p.width,p.axis.max,'Threshold');}
      plotLine(p.svg,readings,p.m.key,x,y,gapMs,p.width,`chart-line series series-${p.m.key}`);
    }
    scales={kind:'split',left,right,from,to,panels:out};
    return true;
  }
  // ---- view: all readings on one chart, each indexed to its own range (one axis, never two scales)
  function renderToggles(readings){
    const root=$('trend-series');
    if(!root.children.length)for(const m of METRICS){
      const b=html('button','series-toggle');b.type='button';b.dataset.series=m.key;
      const key=el('svg',{class:'series-key',width:18,height:8,viewBox:'0 0 18 8','aria-hidden':'true'});key.append(el('line',{x1:2,x2:16,y1:4,y2:4,class:`series-line series series-${m.key}`}));
      b.append(key,html('span','series-name',m.label),html('span','series-range'));root.append(b);
    }
    const shown=shownMetrics().length;
    for(const b of root.children){
      const m=METRICS.find(x=>x.key===b.dataset.series),on=!hiddenSeries.has(m.key),r=valueRange(readings,m.key);
      b.setAttribute('aria-pressed',String(on));b.classList.toggle('off',!on);
      b.querySelector('.series-range').textContent=r?`${fmt(m,r.min)}–${fmt(m,r.max)} ${m.unit}`:'no readings';
      b.title=!on?`Show ${m.label.toLowerCase()} on the chart`:shown>1?`Hide ${m.label.toLowerCase()} from the chart`:'At least one reading stays on the chart';
    }
  }
  function drawCombined(readings,from,to){
    const svg=$('trend-svg'),f=frame(svg);if(!f)return false;
    const {width,height}=f,shown=shownMetrics();
    svg.setAttribute('aria-label',`${shown.map(m=>m.label).join(', ')}, each scaled to its own range, ${windowText(hours)}. Gaps are not connected.`);
    if(!valid.length)return true;
    const labelled=width>=480,left=44,right=labelled?92:12,top=18,bottom=height-26,gapMs=gapFor();
    const x=t=>left+(t-from)/(to-from)*(width-left-right),y=pct=>top+(104-pct)/108*(bottom-top);
    svg.append(el('title',{},`${shown.map(m=>m.label).join(', ')}, each scaled to its own range, ${windowText(hours)}`));
    grid(svg,[0,25,50,75,100],v=>({0:'Low',50:'Mid',100:'High'})[v]??'',y,left,right,width);
    timeAxis(svg,x,from,to,left,right,width,height);
    warnings(svg,readings,x,top,bottom,gapMs);
    const lines=[];
    for(const m of shown){
      const r=valueRange(readings,m.key,MIN_SPAN[m.key]??1);if(!r)continue;
      const ym=v=>y((v-r.lo)/(r.hi-r.lo)*100);
      plotLine(svg,readings,m.key,x,ym,gapMs,width,`chart-line series series-${m.key}`);
      lines.push({m,y:ym});
    }
    // Direct labels at the right edge, beside each line's latest value.
    if(labelled){
      const items=lines.map(l=>{let v=null;for(let i=readings.length-1;i>=0&&v===null;i--)if(Number.isFinite(readings[i][l.m.key]))v=readings[i][l.m.key];return {m:l.m,y:l.y(v)};});
      for(const item of spreadLabels(items,14,top+4,bottom-4)){
        const lx=width-right+8;
        svg.append(el('line',{x1:lx,x2:lx+12,y1:item.y,y2:item.y,class:`series-line series series-${item.m.key}`}),el('text',{x:lx+17,y:item.y+4,class:'chart-direct-label'},SHORT[item.m.key]));
      }
    }
    scales={kind:'combined',x,left,right,top,bottom,width,from,to,lines};
    return true;
  }
  function draw() {
    hideTooltip();
    const split=mode==='split',combined=mode==='combined',gas=metric.key==='mqMv',svg=$('trend-svg');
    $('trend-chart').classList.toggle('is-split',split);
    // SVG elements have no .hidden property: set the attribute itself.
    svg.toggleAttribute('hidden',split);svg.classList.remove('has-focus');$('trend-panels').hidden=!split;$('trend-series').hidden=!combined;
    if(split)ensurePanels();
    if(mode==='single'){$('trend-title').textContent=metric.label+' trend';$('trend-subtitle').textContent=SUBTITLE[metric.key]??`${metric.description} · ${metric.unit}`;}
    else [$('trend-title').textContent,$('trend-subtitle').textContent]=VIEW_TEXT[mode];
    const legend=$('trend-legend');legend.hidden=mode==='single'&&!gas;
    legend.querySelector('[data-legend=line]').hidden=mode!=='single';legend.querySelector('[data-legend=threshold]').hidden=combined;
    $('trend-note').hidden=mode==='single';$('trend-note').textContent=VIEW_NOTE[mode]??'';
    const readings=view?.readings??[],shown=shownMetrics();
    valid=readings.filter(r=>shown.some(m=>Number.isFinite(r[m.key])));
    $('trend-scrub').disabled=!valid.length;$('trend-scrub').max=String(Math.max(0,valid.length-1));
    const to=view?.to??now(),from=view?.from??to-hours*3600000;
    $('trend-window').textContent=`${formatDateTime(from)} – ${formatDateTime(to)} · ${timeZone()}`;
    const empty=$('trend-empty');empty.hidden=valid.length>0;
    empty.textContent=busy?'Loading the trend…':view?`No ${mode==='single'?metric.label.toLowerCase():'sensor'} readings in ${windowText(hours)}.`:'No trend data yet.';
    if(combined)renderToggles(readings);
    scales=null;
    const drawn=mode==='single'?drawSingle(readings,from,to):split?drawSplit(readings,from,to):drawCombined(readings,from,to);
    if(!drawn||!valid.length){scales=null;$('trend-detail').textContent='No reading selected';for(const p of panels??[])p.value.textContent='—';return;}
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
  // Pressed states: the view switch, and the reading tiles (a tile is "selected" only in the single view).
  function syncControls(){
    for(const b of $('trend-views').querySelectorAll('[data-chart-view]')){const yes=b.dataset.chartView===mode;b.classList.toggle('selected',yes);b.setAttribute('aria-pressed',String(yes));}
    for(const b of document.querySelectorAll('#readings [data-metric]')){const yes=mode==='single'&&b.dataset.metric===metric.key;b.classList.toggle('selected',yes);b.setAttribute('aria-pressed',String(yes));}
  }
  function setView(next){if(!CHART_VIEWS.includes(next)||next===mode)return;mode=next;selectedIndex=-1;savePrefs();syncControls();draw();}
  // Choosing a reading tile always shows that reading on its own.
  function selectMetric(key) {metric=METRICS.find(m=>m.key===key)??METRICS[0];mode='single';selectedIndex=-1;savePrefs();syncControls();draw();}
  const selectedMetric=()=>mode==='single'?metric.key:null;
  // Min/max of a metric over the loaded window for the selected device (null when not loaded).
  function stats(key) {
    const d=current();if(!view||!d||view.deviceId!==d.deviceId)return null;
    let lo=Infinity,hi=-Infinity;for(const r of view.readings)if(Number.isFinite(r[key])){lo=Math.min(lo,r[key]);hi=Math.max(hi,r[key]);}
    return Number.isFinite(lo)?{min:lo,max:hi,hours:view.hours}:null;
  }
  function toggleSeries(key){
    if(!METRICS.some(m=>m.key===key))return;
    if(hiddenSeries.has(key))hiddenSeries.delete(key);else if(shownMetrics().length>1)hiddenSeries.add(key);else return;
    savePrefs();draw();
  }
  // Pointing at a series button brings its line forward and fades the others.
  function emphasize(key){
    const svg=$('trend-svg'),on=Boolean(key)&&mode==='combined'&&!hiddenSeries.has(key);
    svg.classList.toggle('has-focus',on);
    svg.querySelectorAll('.chart-line.series').forEach(n=>n.classList.toggle('is-focus',on&&n.classList.contains(`series-${key}`)));
  }
  $('trend-ranges').addEventListener('click',e=>{const b=e.target.closest('[data-hours]');if(!b)return;const next=Number(b.dataset.hours);if(!TREND_HOURS.includes(next))return;hours=next;document.querySelectorAll('[data-hours]').forEach(x=>{const yes=Number(x.dataset.hours)===hours;x.classList.toggle('selected',yes);x.setAttribute('aria-pressed',String(yes));});load();});
  $('trend-views').addEventListener('click',e=>{const b=e.target.closest('[data-chart-view]');if(b)setView(b.dataset.chartView);});
  $('trend-series').addEventListener('click',e=>{const b=e.target.closest('[data-series]');if(b)toggleSeries(b.dataset.series);});
  $('trend-series').addEventListener('pointerover',e=>emphasize(e.target.closest('[data-series]')?.dataset.series));
  $('trend-series').addEventListener('pointerleave',()=>emphasize(null));
  $('trend-series').addEventListener('focusin',e=>emphasize(e.target.closest('[data-series]')?.dataset.series));
  $('trend-series').addEventListener('focusout',()=>emphasize(null));
  $('trend-refresh').addEventListener('click',()=>load(true));
  $('trend-scrub').addEventListener('input',e=>updateSelection(Number(e.target.value),true));
  $('trend-scrub').addEventListener('blur',hideTooltip);
  const pickAt=(svg,e)=>{if(!valid.length||!scales)return;const rect=svg.getBoundingClientRect(),t=scales.from+(e.clientX-rect.left-scales.left)/(rect.width-scales.left-scales.right)*(scales.to-scales.from);updateSelection(nearestIndex(valid,t),true);};
  for(const type of ['pointermove','pointerdown']){
    $('trend-svg').addEventListener(type,e=>pickAt($('trend-svg'),e));
    $('trend-panels').addEventListener(type,e=>{const svg=e.target.closest?.('svg.panel-svg');if(svg)pickAt(svg,e);});
  }
  $('trend-svg').addEventListener('pointerleave',e=>{if(e.pointerType==='mouse')hideTooltip();});
  new ResizeObserver(draw).observe($('trend-chart'));
  syncControls();
  return {sync,stop,selectMetric,selectedMetric,draw,stats};
}
