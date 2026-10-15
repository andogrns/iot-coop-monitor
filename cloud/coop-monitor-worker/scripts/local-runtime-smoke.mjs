// Isolated workerd/Miniflare acceptance: no Wrangler config, credentials, or remote bindings.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { realpathSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { deviceId, deviceToken, ownerToken, payload, reading } from './backend-fixture.mjs';
import { packSample } from '../src/protocol.js';

const require = createRequire(realpathSync(new URL('../node_modules/wrangler/package.json', import.meta.url)));
const { build } = require('esbuild'), { Miniflare, convertV4MiniflareOptions } = require('miniflare');
const bundle = await build({ entryPoints: [fileURLToPath(new URL('../src/index.ts', import.meta.url))], bundle: true, format: 'esm', platform: 'browser', write: false });
const runtime = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: 'local-audit', modules: true, script: bundle.outputFiles[0].text,
  compatibilityDate: '2026-10-08', d1Databases: { DB: 'local-audit-db' }, r2Buckets: { ARCHIVES: 'local-audit-archives' },
  bindings: { ADMIN_TOKEN: ownerToken, SESSION_SECRET: 'synthetic-session-secret', RETENTION_DAYS: '30' },
  outboundService: () => new Response('Outbound network disabled', { status: 502 }) }] }));
let checks = 0;
const check = (name, condition) => { assert.ok(condition, name); checks++; console.log('PASS ' + name); };
async function call(path, method = 'GET', value, token = ownerToken, extra = {}) {
  const response = await runtime.dispatchFetch('https://audit.example' + path, { method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}), ...extra },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
  return { response, value: await response.json() };
}
try {
  const db = await runtime.getD1Database('DB');
  for (const file of ['0001_create_devices.sql', '0002_backend.sql', '0003_archive_catalog_index.sql', '0004_manual_archives.sql']) {
    const sql = readFileSync(new URL('../migrations/' + file, import.meta.url), 'utf8');
    await db.batch(sql.split(';').map(s => s.trim()).filter(Boolean).map(s => db.prepare(s)));
  }
  check('anonymous private route rejected', (await call('/api/snapshot', 'GET', undefined, null)).response.status === 401);
  check('synthetic registration', (await call('/api/devices', 'POST', { deviceId, token: deviceToken })).response.status === 201);
  check('maintenance establishes capacity', (await call('/api/maintenance', 'POST', {})).response.status === 200);
  const post = value => call('/api/device/exchange', 'POST', value, deviceToken);
  check('firmware v1 reading acknowledged', (await post(payload())).value.acked.readings.length === 1);
  check('lost-response retry acknowledged', (await post(payload())).value.acked.readings.length === 1);
  check('retry stored once', (await call('/api/history?deviceId=' + deviceId)).value.readings.length === 1);
  check('conflicting values rejected', (await post(payload({ readings: [{ ...reading(), mqMv: 581 }] }))).response.status === 409);
  const concurrent = await Promise.all([2, 3].map(seq => post(payload({ readings: [reading(seq, seq === 2 ? 9000 : 9500)] }))));
  check('concurrent D1 exchanges succeed', concurrent.every(r => r.response.status === 200));
  check('D1 optimistic rollback preserves concurrent samples', (await call('/api/history?deviceId=' + deviceId)).value.readings.length === 3);
  const command = (await call(`/api/devices/${deviceId}/commands`, 'POST', { type: 'CAL_SHOW' })).value;
  for (const status of ['accepted', 'running', 'completed']) check('command ' + status + ' receipt', (await post(payload({ readings: [], commandResults: [{ id: command.id, status }] }))).value.acked.commandResults.includes(command.id));
  await call(`/api/devices/${deviceId}/uploads`, 'PUT', { paused: true });
  const paused = (await post(payload({ readings: [reading(4)] }))).value;
  check('pause retains unacknowledged readings', paused.uploads.paused && paused.acked.readings.length === 0);
  await call(`/api/devices/${deviceId}/uploads`, 'PUT', { paused: false });
  const login = await call('/auth/login', 'POST', { key: ownerToken }, null, { origin: 'https://audit.example' });
  check('signed owner cookie', login.response.status === 200 && login.response.headers.get('set-cookie').includes('HttpOnly'));
  const cookie = login.response.headers.get('set-cookie').split(';')[0];
  check('cookie read authentication', (await call('/api/snapshot', 'GET', undefined, null, { cookie })).response.status === 200);
  check('cross-origin owner mutation rejected', (await call('/api/maintenance', 'POST', {}, null, { cookie, origin: 'https://foreign.example' })).response.status === 403);
  const anchor = Date.now() - 31 * 86400000, block = new Date(anchor).toISOString() + '_old-boot';
  await db.prepare('INSERT INTO reading_windows(device_id,block_id,boot_id,anchor_ms,data_json,received_at,revision) VALUES (?,?,?,?,?,?,1)').bind(deviceId, block, 'old-boot', anchor, JSON.stringify([packSample(reading())]), new Date(anchor).toISOString()).run();
  const archive = (await call('/api/maintenance', 'POST', {})).value.archive;
  check('workerd gzip and R2 readback', archive.status === 'archived');
  const response = await runtime.dispatchFetch('https://audit.example/api/archive?key=' + encodeURIComponent(archive.key), { headers: { authorization: 'Bearer ' + ownerToken } });
  const bytes = Buffer.from(await response.arrayBuffer()), document = JSON.parse(gunzipSync(bytes));
  check('download checksum matches verified manifest', createHash('sha256').update(bytes).digest('hex') === response.headers.get('x-archive-sha256'));
  check('download preserves complete sample', JSON.stringify(document.blocks[0].samples[0]) === JSON.stringify(packSample(reading())));
  check('archived source removed only after verification', (await db.prepare('SELECT COUNT(*) AS n FROM reading_windows WHERE block_id=?').bind(block).first()).n === 0);
  const manualRange = { deviceId, from: new Date(Date.now() - 3600000).toISOString(), to: new Date(Date.now() + 60000).toISOString() };
  const selection = (await call('/api/archives/selection?' + new URLSearchParams(manualRange))).value;
  check('manual selection counts individual recent samples', selection.count === 3);
  let manual = (await call('/api/archives/manual', 'POST', { ...manualRange, label: 'Runtime range test', expectedCount: selection.count })).value;
  manual = (await call('/api/archives/manual/' + manual.archive_id, 'POST', {})).value;
  check('manual verified chunk moves the exact selected samples', manual.archived_count === 3);
  manual = (await call('/api/archives/manual/' + manual.archive_id, 'POST', {})).value;
  check('manual completion is resumable and idempotent', manual.status === 'complete' && (await call('/api/archives/manual/' + manual.archive_id, 'POST', {})).value.archived_count === 3);
  const catalog = (await call('/api/archives?deviceId=' + deviceId)).value;
  const manualManifest = catalog.archives.find(a => a.manual_archive_id === manual.archive_id);
  check('manual label and range are in the verified catalog', manualManifest.label === 'Runtime range test' && manualManifest.range_from === manualRange.from);
  const folders = (await call('/api/archive-folders?deviceId=' + deviceId)).value.folders;
  const manualFolder = folders.find(f => f.folder_id === 'manual:' + manual.archive_id);
  check('D1 folder groups manual chunks with label/range/archive date', manualFolder.file_count === 1 && manualFolder.sample_count === 3 && manualFolder.range_from === manualRange.from && manualFolder.archived_at === manual.updated_at);
  check('D1 automatic archive has a separate hourly folder', folders.some(f => f.type === 'automatic' && f.file_count === 1));
  const folderFiles = (await call('/api/archive-files?' + new URLSearchParams({ deviceId, folder: manualFolder.folder_id }))).value;
  check('D1 folder file list uses existing verified objects', folderFiles.files[0].object_key === manualManifest.object_key && folderFiles.nextCursor === null);
  check('folder route rejects anonymous access', (await call('/api/archive-folders?deviceId=' + deviceId, 'GET', undefined, null)).response.status === 401);
  check('file route rejects device bearer access', (await call('/api/archive-files?' + new URLSearchParams({ deviceId, folder: manualFolder.folder_id }), 'GET', undefined, deviceToken)).response.status === 401);
  check('folder file read cannot cross devices', (await call('/api/archive-files?' + new URLSearchParams({ deviceId: 'other-device', folder: manualFolder.folder_id }))).response.status === 404);
  const manualDownload = await runtime.dispatchFetch('https://audit.example/api/archive?key=' + encodeURIComponent(manualManifest.object_key), { headers: { authorization: 'Bearer ' + ownerToken } });
  const manualDocument = JSON.parse(gunzipSync(Buffer.from(await manualDownload.arrayBuffer())));
  check('manual download preserves metadata and complete tuples', manualDocument.manualArchive.label === 'Runtime range test' && manualDocument.blocks.flatMap(b => b.samples).length === 3);
  check('manual archiving keeps last device state and exchange counters', (await db.prepare('SELECT state_json,request_count FROM reading_windows WHERE device_id=? AND state_json IS NOT NULL ORDER BY block_id DESC LIMIT 1').bind(deviceId).first()).request_count > 0);
  check('archived firmware retry is still acknowledged', (await post(payload())).value.acked.readings.length === 1);
  check('archived firmware retry does not reinsert sample', (await call('/api/history?deviceId=' + deviceId)).value.readings.length === 0);
  check('archived sample values still reject conflicts', (await post(payload({ readings: [{ ...reading(), mqMv: 581 }] }))).response.status === 409);
  const pageAnchor=Math.floor((Date.now()-50*60000)/60000)*60000;
  for(let minute=0;minute<40;minute++)await db.prepare('INSERT INTO reading_windows(device_id,block_id,boot_id,anchor_ms,data_json,received_at,revision) VALUES (?,?,?,?,?,?,1)')
    .bind(deviceId,new Date(pageAnchor+minute*60000).toISOString()+'_paged-boot','paged-boot',pageAnchor,
      JSON.stringify(Array.from({length:30},(_,n)=>packSample(reading(minute*30+n+1,minute*60000+n*2000)))),new Date(pageAnchor).toISOString()).run();
  for(const pageSize of [50,100,250,500,1000]){
    const first=(await call('/api/history?'+new URLSearchParams({deviceId,mode:'latest',pageSize}))).value;
    check('D1 entry page size '+pageSize,first.readings.length===pageSize&&first.readings[0].seq===1200&&Boolean(first.nextCursor));
  }
  const page1=(await call('/api/history?'+new URLSearchParams({deviceId,mode:'latest',pageSize:1000}))).value;
  const page2=(await call('/api/history?'+new URLSearchParams({deviceId,mode:'latest',pageSize:1000,cursor:page1.nextCursor}))).value;
  check('D1 entry continuation retains all entries exactly once',page2.readings.length===200&&page2.nextCursor===null&&new Set([...page1.readings,...page2.readings].map(r=>r.seq)).size===1200);
  const rangePage=(await call('/api/history?'+new URLSearchParams({deviceId,pageSize:50,from:new Date(pageAnchor).toISOString(),to:new Date(pageAnchor+60000).toISOString()}))).value;
  check('D1 entry range includes the exact final boundary',rangePage.readings.length===31&&rangePage.readings[0].seq===31);
  for(const pageSize of [50,100,250,500,1000]){
    const first=(await call('/api/history?'+new URLSearchParams({deviceId,mode:'latest',pageSize,order:'asc'}))).value;
    check('D1 oldest-first page size '+pageSize,first.readings.length===pageSize&&first.readings[0].seq===1&&first.readings.at(-1).seq===pageSize);
  }
  const oldest1=(await call('/api/history?'+new URLSearchParams({deviceId,mode:'latest',pageSize:1000,order:'asc'}))).value;
  const oldest2=(await call('/api/history?'+new URLSearchParams({deviceId,mode:'latest',pageSize:1000,order:'asc',cursor:oldest1.nextCursor}))).value;
  check('D1 oldest-first continuation has no gaps or duplicates',oldest2.readings.length===200&&oldest2.nextCursor===null&&[...oldest1.readings,...oldest2.readings].every((r,i)=>r.seq===i+1));
  check('D1 order-changing cursor rejected',(await call('/api/history?'+new URLSearchParams({deviceId,mode:'latest',pageSize:1000,order:'desc',cursor:oldest1.nextCursor}))).response.status===400);
  const oldestRange=(await call('/api/history?'+new URLSearchParams({deviceId,pageSize:50,order:'asc',from:new Date(pageAnchor).toISOString(),to:new Date(pageAnchor+60000).toISOString()}))).value;
  check('D1 oldest-first inclusive range',oldestRange.readings.length===31&&oldestRange.readings[0].seq===1&&oldestRange.readings.at(-1).seq===31);
  console.log(`Local runtime acceptance: ${checks} checks passed. No production resources accessed.`);
} finally { await runtime.dispose(); }
