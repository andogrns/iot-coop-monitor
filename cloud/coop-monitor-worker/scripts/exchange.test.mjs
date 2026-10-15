import assert from 'node:assert/strict';
import { test } from 'node:test';
import app from '../src/app.js';
import { history } from '../src/storage.js';
import { DEFAULT_CONFIG } from '../src/protocol.js';
import { fixture, request, deviceToken, deviceId, bootId, reading, payload } from './backend-fixture.mjs';

async function post(env, value = payload()) {
  const response = await app.fetch(request('/api/device/exchange', { method: 'POST', token: deviceToken, value }), env);
  return { status: response.status, value: await response.json() };
}
const stored = env => history(env, new URL('https://audit.example/api/history?deviceId=' + deviceId));

test('firmware v1 exchange, retry and calibration fields retain their wire contract', async t => {
  const { env, db } = await fixture(t);
  for (let n = 0; n < 2; n++) {
    const result = await post(env);
    assert.equal(result.status, 200); assert.equal(result.value.protocolVersion, 1);
    assert.deepEqual(result.value.acked, { readings: [{ bootId, seq: 1 }], logs: [], commandResults: [] });
    assert.deepEqual(result.value.rejected, { readings: [], logs: [], commandResults: [] });
    assert.deepEqual(result.value.desiredConfig, { revision: 1, settings: DEFAULT_CONFIG });
    assert.deepEqual(result.value.uploads, { paused: false, warning: false, reasons: [], retryAfterSec: 2 });
    assert.ok(Array.isArray(result.value.commands));
  }
  const rows = (await stored(env)).readings;
  assert.equal(rows.length, 1); assert.equal(rows[0].sampledAt, null);
  assert.equal(rows[0].calibrationRevision, 1234567890);
  const state = JSON.parse(db.prepare('SELECT state_json FROM reading_windows').get().state_json);
  assert.equal(state.calibration.revision, 1234567890); assert.equal(state.firmwareVersion, 'cloudflare-1.0.1');
  const conflict = await post(env, payload({ readings: [{ ...reading(), mqMv: 581 }] }));
  assert.equal(conflict.status, 409); assert.equal(conflict.value.error, 'sample_conflict');
  assert.equal((await stored(env)).readings[0].mqMv, 580);
});

test('current maximum firmware batch stays accepted and below firmware response bound', async t => {
  const { env } = await fixture(t), value = payload();
  value.state.uptimeMs = 34000;
  value.readings = Array.from({ length: 12 }, (_, i) => reading(i + 1, 10000 + i * 2000));
  value.logs = Array.from({ length: 6 }, (_, i) => ({ seq: i + 1, uptimeMs: 10000, sampledAt: null, level: 'info', message: 'fixture' }));
  const response = await post(env, value);
  assert.equal(response.status, 200); assert.equal(response.value.acked.readings.length, 12);
  assert.equal(response.value.acked.logs.length, 6);
  assert.ok(JSON.stringify(response.value).length < 16384);
});

test('owner pause acknowledges no unwritten data and leaves desired configuration available', async t => {
  const { env, db } = await fixture(t);
  db.prepare('UPDATE devices SET writes_paused=1').run();
  const paused = await post(env);
  assert.equal(paused.status, 200); assert.equal(paused.value.uploads.paused, true);
  assert.equal(paused.value.uploads.retryAfterSec, 60); assert.deepEqual(paused.value.acked.readings, []);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reading_windows').get().n, 0);
  db.prepare('UPDATE devices SET writes_paused=0').run();
  assert.equal((await post(env)).value.acked.readings.length, 1);
});

test('stale capacity pauses uploads without acknowledging data', async t => {
  const { env, db } = await fixture(t);
  db.prepare("UPDATE system_state SET updated_at='2000-01-01T00:00:00.000Z' WHERE key='capacity'").run();
  const response = await post(env);
  assert.equal(response.status, 200); assert.deepEqual(response.value.acked.readings, []);
  assert.ok(response.value.uploads.reasons.includes('capacity_check_pending'));
});

test('desired configuration optimistic revision and applied state remain separate', async t => {
  const { env } = await fixture(t), value = { expectedRevision: 1, settings: { ...DEFAULT_CONFIG, mqThresholdMode: 'manual', manualThresholdMv: 700 } };
  const put = () => app.fetch(request(`/api/devices/${deviceId}/config`, { method: 'PUT', value }), env);
  assert.equal((await put()).status, 200); assert.equal((await put()).status, 409);
  assert.equal((await post(env)).value.desiredConfig.revision, 2);
  const snapshot = await (await app.fetch(request('/api/snapshot'), env)).json();
  assert.equal(snapshot.devices[0].state.appliedConfigRevision, 1);
  assert.equal(snapshot.devices[0].desiredConfig.revision, 2);
});

test('command receipts progress, retry after completion, and cannot regress', async t => {
  const { env } = await fixture(t);
  const response = await app.fetch(request(`/api/devices/${deviceId}/commands`, { method: 'POST', value: { type: 'CAL_SHOW' } }), env);
  assert.equal(response.status, 201); const command = await response.json();
  assert.equal((await post(env)).value.commands[0].id, command.id);
  for (const status of ['accepted', 'running', 'completed', 'completed']) {
    const result = await post(env, payload({ readings: [], commandResults: [{ id: command.id, status, message: 'fixture' }] }));
    assert.deepEqual(result.value.acked.commandResults, [command.id]);
  }
  const regression = await post(env, payload({ readings: [], commandResults: [{ id: command.id, status: 'running' }] }));
  assert.equal(regression.value.rejected.commandResults[0].reason, 'unknown_expired_or_terminal_command');
});

test('logs retain IDs, redact text and paginate using issued cursors', async t => {
  const { env } = await fixture(t), value = payload({ logs: [{ seq: 1, uptimeMs: 10000, sampledAt: null, level: 'info', message: 'Authorization: Bearer secret.fixture.value' }] });
  assert.deepEqual((await post(env, value)).value.acked.logs, [{ bootId, seq: 1 }]);
  assert.deepEqual((await post(env, value)).value.acked.logs, [{ bootId, seq: 1 }]);
  const logs = await (await app.fetch(request('/api/logs?deviceId=' + deviceId), env)).json();
  assert.equal(logs.logs.length, 1); assert.ok(!logs.logs[0].message.includes('secret.fixture.value'));
  const next = await app.fetch(request('/api/logs?deviceId=' + deviceId + '&cursor=' + encodeURIComponent(logs.nextCursor)), env);
  assert.equal(next.status, 200); assert.deepEqual((await next.json()).logs, []);
});

test('optimistic reading conflict rolls back then retries without losing either reading', async t => {
  const { env, db, hooks } = await fixture(t);
  await post(env);
  let once = true;
  hooks.beforeBatch = statements => {
    if (once && statements.some(s => s.sql.includes('INSERT INTO reading_windows'))) {
      once = false;
      const row = db.prepare('SELECT * FROM reading_windows').get(), tuples = JSON.parse(row.data_json);
      const tuple = [...tuples[0]]; tuple[0] = 2; tuple[1] = 9000; tuples.push(tuple);
      db.prepare('UPDATE reading_windows SET data_json=?,revision=revision+1').run(JSON.stringify(tuples));
    }
  };
  assert.equal((await post(env, payload({ readings: [reading(3, 9500)] }))).status, 200);
  assert.deepEqual((await stored(env)).readings.map(r => r.seq).sort(), [1, 2, 3]);
});
