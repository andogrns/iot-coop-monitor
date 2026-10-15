import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gunzipSync } from 'node:zlib';
import { maintenance, archiveList } from '../src/archive.js';
import { sha256 } from '../src/auth.js';
import { packSample } from '../src/protocol.js';
import { blockKey } from '../src/storage.js';
import app from '../src/app.js';
import { fixture, deviceId, reading } from './backend-fixture.mjs';

function seed(db) {
  const anchor = Date.now() - 31 * 86400000, key = blockKey(anchor, 10000, 'old-boot');
  db.prepare('INSERT INTO reading_windows(device_id,block_id,boot_id,anchor_ms,data_json,received_at,revision) VALUES (?,?,?,?,?,?,1)')
    .run(deviceId, key, 'old-boot', anchor, JSON.stringify([packSample(reading())]), new Date(anchor).toISOString());
  return key;
}

test('archive verifies bytes and lossless sample mapping before source deletion', async t => {
  const { env, db, objects } = await fixture(t); seed(db);
  const report = await maintenance(env);
  assert.equal(report.archive.status, 'archived');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reading_windows').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM maintenance_leases').get().n, 0);
  const bytes = objects.get(report.archive.key), document = JSON.parse(gunzipSync(bytes));
  assert.equal(await sha256(bytes), report.archive.sha256);
  assert.deepEqual(document.blocks[0].samples, [packSample(reading())]);
  const catalog = await archiveList(env, new URL('https://audit.example/api/archives?deviceId=' + deviceId));
  assert.equal(catalog.archives[0].sample_count, 1);
});

for (const failure of ['put', 'readback', 'checksum', 'manifest']) test(`archive ${failure} failure retains source and hides raw diagnostics`, async t => {
  const { env, db, hooks } = await fixture(t); seed(db);
  const output = []; t.mock.method(console, 'error', (...args) => output.push(args.join(' ')));
  if (failure === 'put') hooks.beforePut = () => { throw Error('private-provider-detail'); };
  if (failure === 'readback') hooks.beforeGet = () => { throw Error('private-provider-detail'); };
  if (failure === 'checksum') hooks.corruptReadback = true;
  if (failure === 'manifest') hooks.beforeQuery = sql => { if (sql.startsWith('INSERT INTO archive_manifests')) throw Error('private-provider-detail'); };
  const report = await maintenance(env);
  assert.equal(report.archive.status, 'failed'); assert.equal(report.error, 'archive_or_pruning_failed');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reading_windows').get().n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM archive_manifests').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM maintenance_leases').get().n, 0);
  assert.ok(!JSON.stringify(report).includes('private-provider-detail'));
  assert.deepEqual(output, ['maintenance_failed']);
});

for (const failure of ['capacity', 'report']) test(`maintenance releases its lease after ${failure} failure`, async t => {
  const { env, db, hooks } = await fixture(t);
  hooks.beforeQuery = (sql, values) => {
    if (sql.startsWith('INSERT INTO system_state') && values[0] === (failure === 'capacity' ? 'capacity' : 'maintenance')) throw Error('fixture failure');
  };
  await assert.rejects(maintenance(env), /fixture failure/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM maintenance_leases').get().n, 0);
});

test('maintenance respects a live lease and never releases another holder', async t => {
  const { env, db } = await fixture(t);
  db.prepare('INSERT INTO maintenance_leases VALUES (?,?,?)').run('maintenance', 'another-holder', Date.now() + 180000);
  assert.deepEqual(await maintenance(env), { status: 'already_running' });
  assert.equal(db.prepare('SELECT holder FROM maintenance_leases').get().holder, 'another-holder');
});

test('archive revision guard retains a source modified during R2 readback', async t => {
  const { env, db, hooks } = await fixture(t); seed(db);
  hooks.beforeGet = () => db.prepare('UPDATE reading_windows SET revision=revision+1').run();
  const report = await maintenance(env);
  assert.equal(report.archive.status, 'archived');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reading_windows').get().n, 1);
});

test('catalog pagination uses device/key index with no temporary sort', async t => {
  const { db } = await fixture(t);
  const plan = db.prepare('EXPLAIN QUERY PLAN SELECT * FROM archive_manifests WHERE device_id=? AND object_key>? ORDER BY object_key LIMIT 101').all(deviceId, '');
  assert.ok(plan.some(row => row.detail.includes('archives_device_key')));
  assert.ok(plan.every(row => !row.detail.includes('TEMP B-TREE')));
});

test('scheduled failure logs only a fixed event marker', async t => {
  const { env } = await fixture(t), output = [];
  t.mock.method(console, 'error', (...args) => output.push(args.join(' ')));
  env.DB.prepare = () => { throw Error('private-provider-detail'); };
  let work; app.scheduled({}, env, { waitUntil(promise) { work = promise; } }); await assert.rejects(work, /Scheduled maintenance failed/);
  assert.deepEqual(output, ['scheduled_maintenance_failed']);
});
