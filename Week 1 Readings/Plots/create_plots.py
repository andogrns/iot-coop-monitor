import os, sys
sys.path.insert(0, os.path.join(os.environ['TEMP'], 'coop-plot-deps'))
from pathlib import Path
import pandas as pd
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
from matplotlib.backends.backend_pdf import PdfPages
from zoneinfo import ZoneInfo

root = Path(__file__).resolve().parent.parent
out = Path(__file__).resolve().parent
files = sorted(root.glob('*.csv'))
parts = []
for f in files:
    d = pd.read_csv(f)
    d['source_file'] = f.name
    parts.append(d)
d = pd.concat(parts, ignore_index=True)
d['sampledAt'] = pd.to_datetime(d['sampledAt'], utc=True, errors='coerce')
invalid = int(d['sampledAt'].isna().sum())
d = d.dropna(subset=['sampledAt']).sort_values('sampledAt')
identity = ['deviceId','bootId','seq']
duplicates = int(d.duplicated(identity).sum())
conflicts = int(d[d.duplicated(identity, keep=False)].drop(columns=['source_file']).drop_duplicates().duplicated(identity).sum())
if conflicts: raise ValueError(f'{conflicts} conflicting reading identities: inspect before plotting')
d = d.drop_duplicates(identity).copy()
d['local'] = d['sampledAt'].dt.tz_convert('Asia/Jakarta')
d = d.set_index('local')
cols=['ahtTemperatureC','bmpTemperatureC','humidityPct','pressureHpa','mqMv','mqThresholdMv']
for c in cols: d[c] = pd.to_numeric(d[c], errors='coerce')
# Empty bins remain missing, so the plotted line breaks at gaps.
binned = d[cols].resample('5min').median()
gaps = d['sampledAt'].diff().dt.total_seconds()
large = gaps[gaps > 60]
tz=ZoneInfo('Asia/Jakarta')
plt.rcParams.update({'font.size': 10, 'axes.spines.top':False, 'axes.spines.right':False, 'figure.facecolor':'white', 'axes.titleweight':'bold'})
specs = [
 ('temperature','Temperature', [('ahtTemperatureC','AHT20','#d34c40'),('bmpTemperatureC','BMP280','#e4a33c')], 'Temperature (°C)'),
 ('humidity','Relative humidity', [('humidityPct','AHT20','#168d9b')], 'Relative humidity (%)'),
 ('pressure','Barometric pressure', [('pressureHpa','BMP280','#5278b7')], 'Pressure (hPa)'),
 ('gas_response','MQ-135 relative gas response', [('mqMv','Sensor signal','#7256a4'),('mqThresholdMv','Recorded threshold','#d05a50')], 'Divided ADC input (mV)')]
def draw(ax, spec):
    key,title,series,ylabel=spec
    for col,label,color in series:
        ax.plot(binned.index,binned[col],label=label,color=color,linewidth=1.15,linestyle='--' if col=='mqThresholdMv' else '-')
    ax.set_title(title,loc='left',pad=10); ax.set_ylabel(ylabel); ax.grid(True,color='#dce3e7',linewidth=.7,alpha=.8)
    ax.xaxis.set_major_locator(mdates.AutoDateLocator(minticks=4,maxticks=8,tz=tz))
    ax.xaxis.set_major_formatter(mdates.DateFormatter('%d %b\n%H:%M',tz=tz))
    ax.legend(loc='best',frameon=False,fontsize=9)
    ax.margins(x=0)
period=f"{d.index.min():%d %b %Y %H:%M} – {d.index.max():%d %b %Y %H:%M} WIB"
with PdfPages(out/'week-1-sensor-plots.pdf') as pdf:
    fig,axs=plt.subplots(4,1,figsize=(13,13),sharex=True,layout='constrained')
    fig.get_layout_engine().set(rect=(0, .04, 1, .96))
    for ax,spec in zip(axs,specs): draw(ax,spec)
    fig.suptitle('Coop Monitor | Week 1 sensor readings',fontsize=18,fontweight='bold',x=.06,ha='left')
    fig.text(.06,.005,'Five-minute medians  |  Time: Asia/Jakarta (WIB, UTC+7)  |  MQ-135 is a relative response, not ammonia ppm.',fontsize=9,color='#475569')
    fig.savefig(out/'week-1-overview.png',dpi=180,bbox_inches='tight'); pdf.savefig(fig,bbox_inches='tight'); plt.close(fig)
    for spec in specs:
        fig,ax=plt.subplots(figsize=(13,4.5),layout='constrained'); fig.get_layout_engine().set(rect=(0, .08, 1, .95)); draw(ax,spec)
        ax.set_xlabel('Date and time (WIB, UTC+7)')
        fig.suptitle(period,fontsize=9,color='#475569',x=.99,ha='right')
        fig.text(.05,.01,'Five-minute medians; empty intervals are gaps. MQ-135 is a relative response, not ammonia ppm.',fontsize=8,color='#475569')
        fig.savefig(out/(spec[0]+'.png'),dpi=200,bbox_inches='tight'); pdf.savefig(fig,bbox_inches='tight'); plt.close(fig)
lines=['Week 1 sensor plots','',f'Coverage: {period}',f'Source records: {sum(len(x) for x in parts):,}',f'Unique readings plotted: {len(d):,}',f'Duplicate identities removed: {duplicates:,}',f'Conflicting duplicates: {conflicts:,}',f'Rows with invalid timestamps excluded: {invalid:,}',f'Gaps over 60 seconds: {len(large):,}', '', 'Files:']
for f,p in zip(files,parts): lines.append(f'  {f.name}: {len(p):,} rows')
lines += ['', 'Plots use five-minute medians. Empty five-minute bins break lines; short gaps within bins may not be visible. Values are not interpolated. Individual short spikes may be smoothed.', 'Time is converted from sampledAt UTC to Asia/Jakarta (WIB).', 'MQ-135 values are divided ADC input millivolts; the threshold is the recorded configuration threshold, not a calibrated ammonia concentration. A threshold crossing alone does not establish device warning state.', '', 'Largest gaps over 60 seconds:']
for idx,val in large.nlargest(10).items(): lines.append(f'  ending {idx:%Y-%m-%d %H:%M:%S %Z}: {val/60:.1f} minutes')
if not len(large): lines.append('  None')
(out/'plot-notes.txt').write_text('\n'.join(lines)+'\n',encoding='utf-8')
print('\n'.join(lines))

