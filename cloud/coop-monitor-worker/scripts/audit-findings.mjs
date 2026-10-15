// Local diagnostics for deferred findings; intentionally separate from regression tests.
// Reports current behavior, never connects to a device/account or reads credentials.
import { fixture, payload, reading, deviceId } from './backend-fixture.mjs';
import { exchange, enqueueCommand, capacity } from '../src/storage.js';
import { validateExchange } from '../src/protocol.js';
import { updateCapacity } from '../src/archive.js';

const cleanup = [], output = {};
try {
  const { env, db } = await fixture({ after(fn) { cleanup.push(fn); } });
  const device = () => db.prepare('SELECT * FROM devices WHERE device_id=?').get(deviceId);
  const first = payload(); first.state.uptimeMs = 70000;
  await exchange(env, device(), validateExchange(first));
  const changed = structuredClone(first); changed.readings = [reading(1, 65000)];
  await exchange(env, device(), validateExchange(changed));
  const tuples = db.prepare('SELECT data_json FROM reading_windows').all().flatMap(r => JSON.parse(r.data_json));
  output.crossMinuteSameSequenceStoredCount = tuples.filter(r => r[0] === 1).length;

  for (let n = 0; n < 9; n++) await enqueueCommand(env, deviceId, { type: 'HELP' });
  const queued = await Promise.allSettled([enqueueCommand(env, deviceId, { type: 'HELP' }), enqueueCommand(env, deviceId, { type: 'HELP' })]);
  output.concurrentQueue = { accepted: queued.filter(r => r.status === 'fulfilled').length, active: db.prepare("SELECT COUNT(*) AS n FROM commands WHERE status='queued'").get().n };

  const before = await updateCapacity(env);
  db.prepare('UPDATE devices SET writes_paused=1').run();
  await exchange(env, device(), validateExchange(first));
  const after = await updateCapacity(env);
  output.pausedExchangeAddedToRequestEstimate = after.uploadRequests - before.uploadRequests;
  const c = { databaseBytes: 0, archiveBytes: 0, uploadRequests: 74000, estimatedD1Writes: 0 };
  db.prepare("UPDATE system_state SET value_json=?,updated_at=? WHERE key='capacity'").run(JSON.stringify(c), new Date().toISOString());
  const limited = await capacity(env);
  output.requestBudgetPause = { paused: limited.paused, warning: limited.warning, reasons: limited.reasons };

  db.exec('DROP INDEX archives_device_key');
  const query = 'EXPLAIN QUERY PLAN SELECT * FROM archive_manifests WHERE device_id=? AND object_key>? ORDER BY object_key LIMIT 101';
  output.archivePlanBefore = db.prepare(query).all(deviceId, '').map(r => r.detail);
  db.exec('CREATE INDEX archives_device_key ON archive_manifests(device_id,object_key)');
  output.archivePlanAfter = db.prepare(query).all(deviceId, '').map(r => r.detail);
  console.log(JSON.stringify(output, null, 2));
} finally { for (const close of cleanup.reverse()) close(); }
