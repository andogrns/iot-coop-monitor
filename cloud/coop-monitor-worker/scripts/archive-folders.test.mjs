import assert from 'node:assert/strict';
import { test } from 'node:test';
import { archiveFolders, archiveFiles } from '../src/archive-folders.js';
import app from '../src/app.js';
import { archiveList } from '../src/archive.js';
import { fixture, deviceId, deviceToken, request } from './backend-fixture.mjs';

const time = n => new Date(Date.parse('2026-10-13T00:00:00Z') + n * 1000).toISOString();
function job(db, archiveId, label = 'Home Testing Session', status = 'complete', owner = deviceId) {
  db.prepare('INSERT INTO manual_archives(archive_id,device_id,label,range_from,range_to,selected_count,archived_count,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(archiveId, owner, label, '2026-10-10T03:47:00.000Z', '2026-10-13T04:47:00.000Z', 2206, status === 'complete' ? 2206 : 0, status, time(0), time(500));
}
function part(db, n, archiveId = null, hour = '2026-10-10T03:00:00.000Z', owner = deviceId, count = 120) {
  const key = `v1/${owner}/${archiveId ?? 'auto'}/${String(n).padStart(4, '0')}.json.gz`;
  db.prepare('INSERT INTO archive_manifests(object_key,device_id,hour_start,format_version,sample_count,block_count,compressed_bytes,sha256,original_sha256,created_at,verified_at,manual_archive_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(key, owner, hour, 1, count, 30, 123, 'a'.repeat(64), 'b'.repeat(64), time(n), time(n), archiveId);
  return key;
}
const url = (path, params = {}) => new URL('https://test/' + path + '?' + new URLSearchParams({ deviceId, ...params }));

test('a manual archive is one folder with range/date/totals, distinct from duplicate labels and automatic hourly groups', async t => {
  const { env, db, queries } = await fixture(t);
  job(db, 'home'); for (let n = 1; n <= 19; n++) part(db, n, 'home', '2026-10-10T03:00:00.000Z', deviceId, n === 19 ? 46 : 120);
  job(db, 'duplicate'); part(db, 30, 'duplicate'); job(db, 'running', 'Pending <coop>', 'running');
  part(db, 40); part(db, 41); part(db, 42, null, '2026-10-10T04:00:00.000Z');
  const before = db.prepare('SELECT total_changes() AS n').get().n; queries.length = 0;
  const result = await archiveFolders(env, url('api/archive-folders'));
  assert.equal(result.folders.length, 5); assert.equal(result.nextCursor, null);
  const home = result.folders.find(f => f.folder_id === 'manual:home');
  assert.equal(home.file_count, 19); assert.equal(home.sample_count, 2206); assert.equal(home.label, 'Home Testing Session');
  assert.equal(home.range_from, '2026-10-10T03:47:00.000Z'); assert.equal(home.range_to, '2026-10-13T04:47:00.000Z'); assert.equal(home.archived_at, time(500));
  assert.equal(result.folders.filter(f => f.label === 'Home Testing Session').length, 2);
  assert.equal(result.folders.find(f => f.folder_id === 'manual:running').file_count, 0);
  const auto = result.folders.find(f => f.folder_id === 'auto:2026-10-10T03:00:00.000Z');
  assert.equal(auto.file_count, 2); assert.equal(auto.range_to, '2026-10-10T04:00:00.000Z'); assert.equal(auto.archived_at, time(41));
  assert.equal(db.prepare('SELECT total_changes() AS n').get().n, before); assert.ok(queries.every(q => /^(SELECT|WITH)/i.test(q.trim())));
  const files = await archiveFiles(env, url('api/archive-files', { folder: home.folder_id }));
  assert.equal(files.files.length, 19); assert.deepEqual(files.files.map(f => f.created_at), Array.from({ length: 19 }, (_, i) => time(i + 1)));
  assert.equal((await archiveList(env, url('api/archives'))).archives.length, 23);
});

test('folder pagination covers more than 100 jobs with stable equal-date boundaries and scoped cursors', async t => {
  const { env, db } = await fixture(t);
  for (let n = 0; n < 125; n++) job(db, 'job-' + String(n).padStart(3, '0'));
  const folders = []; let cursor;
  do { const page = await archiveFolders(env, url('api/archive-folders', cursor ? { cursor } : {})); assert.ok(page.folders.length <= 50); folders.push(...page.folders); cursor = page.nextCursor; } while (cursor);
  assert.equal(folders.length, 125); assert.equal(new Set(folders.map(f => f.folder_id)).size, 125);
  const first = await archiveFolders(env, url('api/archive-folders'));
  await assert.rejects(archiveFolders(env, url('api/archive-folders', { deviceId: 'other', cursor: first.nextCursor })), e => e.code === 'invalid_cursor');
  await assert.rejects(archiveFolders(env, url('api/archive-folders', { cursor: 'bad' })), e => e.code === 'invalid_cursor');
});

test('file pagination returns every part once in save order and binds cursors to device and folder', async t => {
  const { env, db } = await fixture(t); job(db, 'large'); job(db, 'other');
  for (let n = 1; n <= 205; n++) part(db, n, 'large'); part(db, 999, 'other');
  const first = await archiveFiles(env, url('api/archive-files', { folder: 'manual:large' })); assert.equal(first.files.length, 100);
  const second = await archiveFiles(env, url('api/archive-files', { folder: 'manual:large', cursor: first.nextCursor }));
  const last = await archiveFiles(env, url('api/archive-files', { folder: 'manual:large', cursor: second.nextCursor }));
  const files = [...first.files, ...second.files, ...last.files]; assert.equal(files.length, 205); assert.equal(last.nextCursor, null);
  assert.equal(new Set(files.map(f => f.object_key)).size, 205); assert.equal(files.at(-1).created_at, time(205));
  for (const params of [{ folder: 'manual:other' }, { folder: 'manual:large', deviceId: 'other' }])
    await assert.rejects(archiveFiles(env, url('api/archive-files', { ...params, cursor: first.nextCursor })), e => e.code === 'invalid_cursor');
  await assert.rejects(archiveFiles(env, url('api/archive-files', { folder: 'manual:missing' })), e => e.status === 404);
  await assert.rejects(archiveFiles(env, url('api/archive-files', { folder: 'auto:invalid' })), e => e.status === 400);
  await assert.rejects(archiveFiles(env, url('api/archive-files', { folder: "manual:x';DELETE" })), e => e.status === 400);
});

test('automatic files remain isolated by hour and new routes retain owner-only, device-scoped reads', async t => {
  const { env, db } = await fixture(t); part(db, 1); part(db, 2); part(db, 3, null, '2026-10-10T04:00:00.000Z');
  const files = await archiveFiles(env, url('api/archive-files', { folder: 'auto:2026-10-10T03:00:00.000Z' })); assert.equal(files.files.length, 2);
  const foldersPath = '/api/archive-folders?' + new URLSearchParams({ deviceId });
  const filesPath = '/api/archive-files?' + new URLSearchParams({ deviceId, folder: 'auto:2026-10-10T03:00:00.000Z' });
  for (const path of [foldersPath, filesPath]) {
    assert.equal((await app.fetch(request(path), env)).status, 200);
    for (const token of [null, deviceToken]) assert.equal((await app.fetch(request(path, { token }), env)).status, 401);
  }
  assert.equal((await archiveFolders(env, url('api/archive-folders', { deviceId: 'other' }))).folders.length, 0);
  await assert.rejects(archiveFiles(env, url('api/archive-files', { deviceId: 'other', folder: 'auto:2026-10-10T03:00:00.000Z' })), e => e.status === 404);
});
