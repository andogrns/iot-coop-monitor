// Temperature-Humidity Index (THI), worked out in the browser from the AHT20 temperature and relative humidity.
// Same formula and bands as the Week 1 analysis notebook (Week 1 Readings/Plots/build_nb.py):
//   THI = T_F - (0.55 - 0.0055 * RH) * (T_F - 58),  T_F = 1.8 * T_C + 32   (NRC 1971 form, °F scale)
// Laying-hen bands from Kim et al. (2024), Animals 14(7) 1076, doi:10.3390/ani14071076, citing Zulovich & DeShazer (1990):
// comfort < 70, alert 70-75, danger 76-81, emergency > 81. As in the notebook, 75 is taken as the start of Danger
// (the paper leaves a gap between 75 and 76; the earlier start is the cautious choice).
// THI is a heat-stress index for the birds. It says nothing about gas, and it is not stored or exported.
export const THI_BANDS = [
  { key: 'comfort', label: 'Comfort', min: -Infinity, max: 70, tone: 'ok' },
  { key: 'alert', label: 'Alert', min: 70, max: 75, tone: 'warn' },
  { key: 'danger', label: 'Danger', min: 75, max: 81, tone: 'danger' },
  { key: 'emergency', label: 'Emergency', min: 81, max: Infinity, tone: 'danger' },
];
// Band edges inside the scale (70, 75, 81).
export const THI_EDGES = THI_BANDS.slice(1).map(b => b.min);

export function thi(temperatureC, humidityPct) {
  if (!Number.isFinite(temperatureC) || !Number.isFinite(humidityPct)) return null;
  const f = 1.8 * temperatureC + 32;
  return f - (0.55 - 0.0055 * humidityPct) * (f - 58);
}
// The notebook uses the AHT20 temperature (both values come from the same sensor).
export const readingThi = r => r ? thi(r.ahtTemperatureC, r.humidityPct) : null;
export const thiBand = value => Number.isFinite(value) ? THI_BANDS.find(b => value >= b.min && value < b.max) : null;
// Range text for a band: "< 70", "70–75", "75–81", "≥ 81".
export const bandRange = b => !Number.isFinite(b.min) ? `< ${b.max}` : !Number.isFinite(b.max) ? `≥ ${b.min}` : `${b.min}–${b.max}`;

// Time spent in each band. Each reading counts until the next one of the same boot, unless the step is a gap
// longer than gapMs (then it counts for nothing, as the chart line also breaks there). With no measurable time
// (a single reading, or only gaps) readings are counted instead, so shares stay meaningful.
// rows: sorted by time; timeOf(r) gives a reading's time in ms; valueOf(r) its THI.
export function bandTimes(rows, timeOf, valueOf, gapMs) {
  const times = Object.fromEntries(THI_BANDS.map(b => [b.key, 0])), counts = { ...times };
  let total = 0, readings = 0;
  for (let i = 0; i < rows.length; i++) {
    const band = thiBand(valueOf(rows[i]));
    if (!band) continue;
    counts[band.key]++; readings++;
    const next = rows[i + 1];
    if (!next || next.bootId !== rows[i].bootId) continue;
    const step = timeOf(next) - timeOf(rows[i]);
    if (step > 0 && step <= gapMs) { times[band.key] += step; total += step; }
  }
  return total > 0 ? { by: 'time', total, values: times, readings } : { by: 'count', total: readings, values: counts, readings };
}
