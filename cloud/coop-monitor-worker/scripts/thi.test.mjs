import { test } from 'node:test';
import assert from 'node:assert/strict';
import { THI_BANDS, bandRange, bandTimes, readingThi, thi, thiBand } from '../public/thi.js';
import { METRICS, TrendData, fitThiEdges, formatDuration, metricValue, sharePct } from '../public/trends.js';

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
// Reference values from the NRC (1971) form used in the Week 1 notebook: THI = F - (0.55 - 0.0055 RH)(F - 58).
test('THI follows the notebook formula (NRC 1971, °F scale)', () => {
  close(thi(25, 60), 77 - (0.55 - 0.33) * 19);          // 72.82
  close(thi(30, 70), 86 - (0.55 - 0.385) * 28);         // 81.38
  close(thi(14.4444444444, 50), 58);                    // T_F = 58: THI equals the temperature in °F
  close(thi(28, 100), 82.4);                            // saturated air: THI equals the temperature in °F
  assert.equal(thi(null, 60), null); assert.equal(thi(25, undefined), null); assert.equal(thi(NaN, 60), null);
  close(readingThi({ ahtTemperatureC: 25, humidityPct: 60, bmpTemperatureC: 40 }), thi(25, 60)); // AHT20 temperature, as in the notebook
  assert.equal(readingThi({ ahtTemperatureC: null, humidityPct: 60, bmpTemperatureC: 25 }), null);
  assert.equal(readingThi(null), null);
});
test('bands: Comfort < 70, Alert 70–75, Danger from 75 (cautious start, as in the notebook), Emergency from 81', () => {
  const at = v => thiBand(v)?.key ?? null;
  assert.deepEqual([69.99, 70, 74.99, 75, 80.99, 81, 95, -5].map(at), ['comfort', 'alert', 'alert', 'danger', 'danger', 'emergency', 'emergency', 'comfort']);
  assert.equal(at(null), null); assert.equal(at(NaN), null);
  assert.deepEqual(THI_BANDS.map(bandRange), ['< 70', '70–75', '75–81', '≥ 81']);
});
test('time in each band: steps to the next reading, not across gaps or restarts; counts when no time is measurable', () => {
  const t0 = Date.parse('2026-10-20T03:00:00Z');
  const row = (s, value, bootId = 'a') => ({ t: t0 + s * 1000, value, bootId });
  const rows = [row(0, 72), row(5, 72), row(10, 76), row(15, 76), row(20, 76), row(200, 82), row(205, 69, 'b'), row(210, 69, 'b'), row(215, null, 'b'), row(220, 69, 'b')];
  const r = bandTimes(rows, x => x.t, x => x.value, 15000);
  assert.equal(r.by, 'time');
  assert.deepEqual(r.values, { comfort: 10000, alert: 10000, danger: 10000, emergency: 0 });
  assert.equal(r.total, 30000); assert.equal(r.readings, 9);
  const single = bandTimes([row(0, 76)], x => x.t, x => x.value, 15000);
  assert.deepEqual(single, { by: 'count', total: 1, values: { comfort: 0, alert: 0, danger: 1, emergency: 0 }, readings: 1 });
  assert.equal(bandTimes([row(0, null)], x => x.t, x => x.value, 15000).readings, 0);
});
test('chart range takes in nearby band edges only', () => {
  assert.deepEqual(fitThiEdges(72, 74), { lo: 70, hi: 75 });
  assert.deepEqual(fitThiEdges(76, 79), { lo: 75, hi: 81 });
  assert.deepEqual(fitThiEdges(60, 62), { lo: 60, hi: 62 });
  assert.deepEqual(fitThiEdges(73.5, 78.4), { lo: 73.5, hi: 81 }); // 70 is 3.5 below: left out
});
test('durations and shares read naturally', () => {
  assert.equal(formatDuration(0), '0 min'); assert.equal(formatDuration(20000), '< 1 min'); assert.equal(formatDuration(35 * 60000), '35 min');
  assert.equal(formatDuration(3 * 3600000), '3 h'); assert.equal(formatDuration(9 * 3600000 + 40 * 60000), '9 h 40 min');
  assert.equal(sharePct(0, 100), '0%'); assert.equal(sharePct(0.2, 100), '< 1%'); assert.equal(sharePct(99.9, 100), '> 99%'); assert.equal(sharePct(100, 100), '100%'); assert.equal(sharePct(40, 100), '40%'); assert.equal(sharePct(1, 0), '0%');
});
test('THI is a derived metric: tiles and trend readings carry it, the stored reading is not changed', async () => {
  const m = METRICS.find(x => x.key === 'thi');
  assert.ok(m && m.derive);
  const reading = { deviceId: 'coop', bootId: 'b', seq: 1, estimatedAt: '2026-10-20T03:00:00Z', sampledAt: null, ahtTemperatureC: 25, humidityPct: 60, mqMv: 700 };
  close(metricValue(m, reading), thi(25, 60)); assert.equal(metricValue(m, null), undefined);
  assert.equal(metricValue(METRICS[0], reading), 700);
  const to = Date.parse('2026-10-20T03:00:10Z');
  const model = new TrendData(async () => ({ readings: [reading, { ...reading, seq: 2, ahtTemperatureC: null }], nextCursor: null }));
  const result = await model.load('coop', 1, to);
  close(result.readings[0].thi, thi(25, 60)); assert.equal(result.readings[1].thi, null);
  assert.equal('thi' in reading, false);
});
