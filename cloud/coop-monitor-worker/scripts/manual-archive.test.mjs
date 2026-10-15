import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gunzipSync } from 'node:zlib';
import { archiveSelection, startManualArchive, continueManualArchive } from '../src/manual-archive.js';
import { archiveList, archiveDownload } from '../src/archive.js';
import { history, blockKey } from '../src/storage.js';
import { packSample } from '../src/protocol.js';
import { sha256, makeSession } from '../src/auth.js';
import app from '../src/app.js';
import { fixture, deviceId, deviceToken, reading, request, payload } from './backend-fixture.mjs';

const anchor = Date.parse('2026-10-10T00:00:00.000Z');
const range = (from = 10000, to = 20000) => ({ deviceId, from: new Date(anchor + from).toISOString(), to: new Date(anchor + to).toISOString() });
function seed(db, samples = [reading(1, 0), reading(2, 10000), reading(3, 20000), reading(4, 30000)], boot = 'manual-boot') {
  const key = blockKey(anchor, samples[0]?.uptimeMs ?? 0, boot);
  db.prepare('INSERT INTO reading_windows(device_id,block_id,boot_id,anchor_ms,data_json,state_json,received_at,revision,request_count,estimated_writes) VALUES (?,?,?,?,?,?,?,1,7,9)')
    .run(deviceId, key, boot, anchor, JSON.stringify(samples.map(packSample)), JSON.stringify({ bootId: boot, receivedAt: new Date(anchor).toISOString(), calibrated: true }), new Date(anchor).toISOString());
  return key;
}
async function start(env, r = range(), label = 'Week 1') {
  const selection = await archiveSelection(env, new URL('https://audit.example/api/archives/selection?' + new URLSearchParams(r)));
  return startManualArchive(env, { ...r, label, expectedCount: selection.count });
}

test('manual count and archive include exact endpoints, preserve outside samples/state and label, and verify download', async t => {
  const { env, db, objects } = await fixture(t); const key = seed(db);
  const r = range();
  assert.equal((await archiveSelection(env, new URL('https://audit.example/?' + new URLSearchParams(r)))).count, 2);
  const before = await history(env, new URL('https://audit.example/?' + new URLSearchParams(r)));
  assert.deepEqual(before.readings.map(s => s.seq), [2, 3]);
  let job = await start(env, r, '  Week 1 <coop>  ');
  assert.equal(job.selected_count, 2); assert.equal(job.label, 'Week 1 <coop>');
  job = await continueManualArchive(env, job.archive_id);
  assert.equal(job.archived_count, 2);
  const row = db.prepare('SELECT * FROM reading_windows WHERE block_id=?').get(key);
  assert.deepEqual(JSON.parse(row.data_json).map(s => s[0]), [1, 4]);
  assert.ok(row.state_json); assert.equal(row.request_count, 7); assert.equal(row.estimated_writes, 9); assert.equal(row.revision, 2);
  const catalog = await archiveList(env, new URL('https://audit.example/?deviceId=' + deviceId)), manifest = catalog.archives[0];
  assert.equal(manifest.label, 'Week 1 <coop>'); assert.equal(catalog.manualArchives[0].archived_count, 2);
  const bytes = objects.get(manifest.object_key), document = JSON.parse(gunzipSync(bytes));
  assert.equal(await sha256(bytes), manifest.sha256); assert.equal(document.manualArchive.label, 'Week 1 <coop>');
  assert.deepEqual(document.blocks[0].samples, [packSample(reading(2, 10000)), packSample(reading(3, 20000))]);
  assert.equal((await archiveDownload(env, manifest.object_key)).headers.get('x-archive-sha256'), manifest.sha256);
  job = await continueManualArchive(env, job.archive_id); assert.equal(job.status, 'complete');
  assert.deepEqual(await continueManualArchive(env, job.archive_id), db.prepare('SELECT * FROM manual_archives').get());
  assert.equal(objects.size, 1); assert.equal(db.prepare('SELECT COUNT(*) AS n FROM maintenance_leases').get().n, 0);
});

test('manual selection handles final-minute boundaries and multiple boots, using estimated rather than device UTC', async t => {
  const { env, db } = await fixture(t);
  seed(db, [{ ...reading(1, 60000), sampledAt: new Date(anchor + 65000).toISOString() }], 'a');
  seed(db, [reading(2, 60000)], 'b');
  seed(db, [], 'empty');
  const job = await start(env, range(59000, 60000)); assert.equal(job.selected_count, 2);
  await continueManualArchive(env, job.archive_id);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM reading_windows WHERE data_json<>'[]'").get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reading_windows').get().n, 3);
});

test('large manual range chunks at 30 blocks and resumes without repeating committed samples', async t => {
  const { env, db, objects } = await fixture(t);
  for (let n = 0; n < 65; n++) seed(db, [reading(n + 1, n * 60000)]);
  let job = await start(env, range(0, 65 * 60000));
  for (const total of [30, 60, 65]) { job = await continueManualArchive(env, job.archive_id); assert.equal(job.archived_count, total); }
  job = await continueManualArchive(env, job.archive_id); assert.equal(job.status, 'complete'); assert.equal(objects.size, 3);
  const samples = [...objects.values()].flatMap(bytes => JSON.parse(gunzipSync(bytes)).blocks.flatMap(b => b.samples));
  assert.equal(samples.length, 65); assert.equal(new Set(samples.map(s => s[0])).size, 65);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM reading_windows WHERE data_json<>'[]'").get().n, 0);
});

for (const failure of ['put', 'readback', 'checksum', 'manifest']) test(`manual ${failure} failure retains selected samples and resumable progress`, async t => {
  const { env, db, hooks } = await fixture(t); seed(db); const job = await start(env);
  if (failure === 'put') hooks.beforePut = () => { throw Error('fixture failure'); };
  if (failure === 'readback') hooks.beforeGet = () => { throw Error('fixture failure'); };
  if (failure === 'checksum') hooks.corruptReadback = true;
  if (failure === 'manifest') hooks.beforeQuery = sql => { if (sql.startsWith('INSERT INTO archive_manifests')) throw Error('fixture failure'); };
  await assert.rejects(continueManualArchive(env, job.archive_id));
  assert.equal(JSON.parse(db.prepare('SELECT data_json FROM reading_windows').get().data_json).length, 4);
  assert.equal(db.prepare('SELECT archived_count FROM manual_archives').get().archived_count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM archive_manifests').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM maintenance_leases').get().n, 0);
  delete hooks.beforePut; delete hooks.beforeGet; delete hooks.beforeQuery; hooks.corruptReadback = false;
  assert.equal((await continueManualArchive(env, job.archive_id)).archived_count, 2);
});

test('concurrent ingestion rolls back manual removal/catalog/progress and preserves the new sample', async t => {
  const { env, db, hooks } = await fixture(t); seed(db); const job = await start(env);
  hooks.beforeGet = () => db.prepare('UPDATE reading_windows SET data_json=?,revision=revision+1').run(JSON.stringify([1, 2, 3, 4, 5].map(n => packSample(reading(n, n === 5 ? 15000 : (n - 1) * 10000)))));
  await assert.rejects(continueManualArchive(env, job.archive_id), e => e.code === 'archive_conflict');
  assert.equal(JSON.parse(db.prepare('SELECT data_json FROM reading_windows').get().data_json).length, 5);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM archive_manifests').get().n, 0);
  assert.equal(db.prepare('SELECT archived_count FROM manual_archives').get().archived_count, 0);
  delete hooks.beforeGet;
  assert.equal((await continueManualArchive(env, job.archive_id)).archived_count, 3);
});

test('manual range, label and changed count validation prevents writes; capacity and maintenance leases retain data', async t => {
  const { env, db } = await fixture(t); seed(db);
  for (const label of ['', ' ', 'x'.repeat(81), 'bad\nlabel']) await assert.rejects(start(env, range(), label), e => e.code === 'invalid_label');
  for (const r of [range(20000, 10000), range(0, 32 * 86400000), { ...range(), to: 'invalid' }])
    await assert.rejects(archiveSelection(env, new URL('https://audit.example/?' + new URLSearchParams(r))), e => e.code === 'invalid_range');
  await assert.rejects(startManualArchive(env, { ...range(), label: 'Week 1', expectedCount: 1 }), e => e.code === 'selection_changed');
  const job = await start(env);
  db.prepare('INSERT INTO maintenance_leases VALUES (?,?,?)').run('maintenance', 'other', Date.now() + 180000);
  await assert.rejects(continueManualArchive(env, job.archive_id), e => e.code === 'archive_busy');
  assert.equal(db.prepare('SELECT holder FROM maintenance_leases').get().holder, 'other'); db.exec('DELETE FROM maintenance_leases');
  env.ARCHIVE_MAX_BYTES = '1';
  await assert.rejects(continueManualArchive(env, job.archive_id), e => e.code === 'archive_capacity_paused');
  assert.equal(JSON.parse(db.prepare('SELECT data_json FROM reading_windows').get().data_json).length, 4);
});

test('manual endpoints require owner authorization and reject cross-origin cookie writes', async t => {
  const { env, db } = await fixture(t); seed(db);
  for (const path of ['/api/archives/selection?' + new URLSearchParams(range()), '/api/archives/manual']) {
    const response = await app.fetch(request(path, { token: null, ...(path.endsWith('manual') ? { method: 'POST', value: {} } : {}) }), env);
    assert.equal(response.status, 401);
  }
  const preview = await app.fetch(request('/api/archives/selection?' + new URLSearchParams(range())), env);
  assert.equal((await preview.json()).count, 2);
  const created = await app.fetch(request('/api/archives/manual', { method: 'POST', value: { ...range(), label: 'Test', expectedCount: 2 } }), env);
  assert.equal(created.status, 201); const job = await created.json();
  const cookie = 'coop_session=' + await makeSession(env.SESSION_SECRET);
  const foreign = await app.fetch(request('/api/archives/manual/' + job.archive_id, { method: 'POST', value: {}, token: null, headers: { cookie, origin: 'https://foreign.example' } }), env);
  assert.equal(foreign.status, 403);
  const chunk = await app.fetch(request('/api/archives/manual/' + job.archive_id, { method: 'POST', value: {} }), env);
  assert.equal((await chunk.json()).archived_count, 2);
});

test('manual provider failure returns safe actionable owner error and leaves a job resumable', async t => {
  const { env, db, hooks } = await fixture(t); seed(db); const job = await start(env), output = [];
  t.mock.method(console, 'error', (...args) => output.push(args.join(' ')));
  hooks.beforePut = () => { throw Error('private-provider-detail'); };
  const response = await app.fetch(request('/api/archives/manual/' + job.archive_id, { method: 'POST', value: {} }), env);
  assert.equal(response.status, 503); const error = await response.json();
  assert.equal(error.error, 'manual_archive_failed'); assert.match(error.message, /continue to retry/);
  assert.ok(!JSON.stringify(error).includes('private-provider-detail')); assert.deepEqual(output, ['manual_archive_failed']);
  assert.equal(db.prepare('SELECT archived_count FROM manual_archives').get().archived_count, 0);
});

test('firmware lost-response retries stay acknowledged without reinserting manually archived samples; changed values conflict', async t => {
  const { env, db } = await fixture(t);
  const post = value => app.fetch(request('/api/device/exchange', { method: 'POST', token: deviceToken, value }), env);
  assert.equal((await post(payload())).status, 200);
  const row = db.prepare('SELECT * FROM reading_windows').get(), sampleTime = row.anchor_ms + 10000;
  const r = { deviceId, from: new Date(sampleTime - 1).toISOString(), to: new Date(sampleTime + 1).toISOString() };
  const job = await start(env, r); await continueManualArchive(env, job.archive_id);
  const retried = await post(payload()); assert.equal(retried.status, 200);
  assert.deepEqual((await retried.json()).acked.readings, [{ bootId: payload().bootId, seq: 1 }]);
  assert.equal(db.prepare('SELECT data_json FROM reading_windows').get().data_json, '[]');
  const conflict = await post(payload({ readings: [{ ...reading(), mqMv: 581 }] }));
  assert.equal(conflict.status, 409); assert.equal((await conflict.json()).error, 'sample_conflict');
  assert.equal((await post(payload({ readings: [reading(2)] }))).status, 200);
  assert.deepEqual(JSON.parse(db.prepare('SELECT data_json FROM reading_windows').get().data_json).map(t => t[0]), [2]);
  assert.equal(db.prepare('SELECT archived_count FROM manual_archives').get().archived_count, 1);
});

test('archived identities continue to count toward the existing 32-sample minute admission limit', async t => {
  const { env, db } = await fixture(t);
  const post = value => app.fetch(request('/api/device/exchange', { method: 'POST', token: deviceToken, value }), env);
  assert.equal((await post(payload())).status, 200);
  const hashes = Object.fromEntries(Array.from({ length: 32 }, (_, n) => [n + 1, 'a'.repeat(64)]));
  db.prepare("UPDATE reading_windows SET data_json='[]',archived_hashes_json=?").run(JSON.stringify(hashes));
  const response = await post(payload({ readings: [reading(33)] })); assert.equal(response.status, 400);
  assert.match((await response.json()).message, /32 readings/);
  assert.equal(db.prepare('SELECT data_json FROM reading_windows').get().data_json, '[]');
});

test('a capacity-report failure at completion leaves the job resumable with committed samples preserved', async t => {
  const { env, db, hooks } = await fixture(t); seed(db); const job = await start(env);
  await continueManualArchive(env, job.archive_id);
  hooks.beforeQuery = sql => { if (sql.startsWith('INSERT INTO system_state')) throw Error('fixture capacity failure'); };
  await assert.rejects(continueManualArchive(env, job.archive_id));
  assert.equal(db.prepare('SELECT status FROM manual_archives').get().status, 'running');
  assert.equal(db.prepare('SELECT archived_count FROM manual_archives').get().archived_count, 2);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM maintenance_leases').get().n, 0);
  delete hooks.beforeQuery; assert.equal((await continueManualArchive(env, job.archive_id)).status, 'complete');
});
