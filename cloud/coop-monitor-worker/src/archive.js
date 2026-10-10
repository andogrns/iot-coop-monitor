import { sha256 } from './auth.js';
import { SAMPLE_FIELDS, ApiError, id } from './protocol.js';
const iso = ms => new Date(ms).toISOString();
const stmt = (db, sql, ...v) => db.prepare(sql).bind(...v);
export async function updateCapacity(env) {
  const day = iso(Date.now()).slice(0, 10), now = iso(Date.now());
  const devices = (await env.DB.prepare('SELECT device_id FROM devices').all()).results;
  const results = await env.DB.batch([
    env.DB.prepare('SELECT 1 AS ok'),
    env.DB.prepare('SELECT COALESCE(SUM(compressed_bytes),0) AS bytes FROM archive_manifests'),
    ...devices.map(d => stmt(env.DB, 'SELECT COALESCE(SUM(request_count),0) AS requests, COALESCE(SUM(estimated_writes),0) AS writes FROM reading_windows WHERE device_id=? AND block_id>=? AND block_id<?', d.device_id, day, day + 'Z'))
  ]);
  const totals = results.slice(2).reduce((a,r)=>({requests:a.requests+r.results[0].requests,writes:a.writes+r.results[0].writes}),{requests:0,writes:0});
  const c = { day, databaseBytes: results[0].meta.size_after, archiveBytes: results[1].results[0].bytes,
    uploadRequests: totals.requests, estimatedD1Writes: totals.writes + 5000,
    scope: 'Application estimates with 5000 daily writes reserved for maintenance and owner actions; check account-wide usage in Cloudflare.' };
  await stmt(env.DB, 'INSERT INTO system_state(key,value_json,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at', 'capacity', JSON.stringify(c), now).run();
  return c;
}
async function archiveOldest(env) {
  const cutoff = iso(Date.now() - Number(env.RETENTION_DAYS ?? 30) * 86400000);
  const devices = (await env.DB.prepare('SELECT device_id FROM devices').all()).results;
  if (!devices.length) return { status: 'caught_up' };
  const candidates = await env.DB.batch(devices.map(d => stmt(env.DB, 'SELECT device_id,block_id FROM reading_windows WHERE device_id=? AND block_id<? ORDER BY block_id LIMIT 1',d.device_id,cutoff)));
  const first = candidates.flatMap(r=>r.results).sort((a,b)=>a.block_id.localeCompare(b.block_id))[0];
  if (!first) return { status: 'caught_up' };
  const hour = first.block_id.slice(0, 13) + ':00:00.000Z', end = iso(Date.parse(hour) + 3600000);
  // Bounded chunks also keep compression and D1 batches within a small Worker CPU budget.
  const rows = (await stmt(env.DB, 'SELECT * FROM reading_windows WHERE device_id=? AND block_id>=? AND block_id<? AND block_id<? ORDER BY block_id LIMIT 30', first.device_id, hour, end, cutoff).all()).results;
  const document = { formatVersion: 1, deviceId: first.device_id, hourStart: hour, sampleFields: SAMPLE_FIELDS,
    blocks: rows.map(r => ({ blockId: r.block_id, bootId: r.boot_id, anchorMs: r.anchor_ms, samples: JSON.parse(r.data_json), state: r.state_json ? JSON.parse(r.state_json) : null, receivedAt: r.received_at })) };
  const original = new TextEncoder().encode(JSON.stringify(document)), originalHash = await sha256(original);
  const compressed = new Uint8Array(await new Response(new Blob([original]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
  const hash = await sha256(compressed), key = `v1/${first.device_id}/${hour.slice(0,10)}/${hour.slice(11,13)}/${originalHash}.json.gz`;
  const used = await env.DB.prepare('SELECT COALESCE(SUM(compressed_bytes),0) AS bytes FROM archive_manifests').first();
  if (used.bytes + compressed.byteLength >= Number(env.ARCHIVE_MAX_BYTES ?? 10000000000) * .95) return { status: 'archive_capacity_paused', retainedInD1: true };
  await env.ARCHIVES.put(key, compressed, { httpMetadata: { contentType: 'application/gzip' }, customMetadata: { sha256: hash, originalSha256: originalHash, formatVersion: '1' } });
  const check = await env.ARCHIVES.get(key);
  if (!check || await sha256(await check.arrayBuffer()) !== hash) throw Error('Archive readback verification failed; D1 source retained');
  const now = iso(Date.now()), sampleCount = document.blocks.reduce((n,b) => n + b.samples.length, 0);
  await env.DB.batch([
    stmt(env.DB, 'INSERT INTO archive_manifests(object_key,device_id,hour_start,format_version,sample_count,block_count,compressed_bytes,sha256,original_sha256,created_at,verified_at) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(object_key) DO NOTHING', key, first.device_id, hour, 1, sampleCount, rows.length, compressed.byteLength, hash, originalHash, now, now),
    ...rows.map(r => stmt(env.DB, 'DELETE FROM reading_windows WHERE device_id=? AND block_id=? AND revision=?', r.device_id, r.block_id, r.revision))
  ]);
  return { status: 'archived', key, sampleCount, blockCount: rows.length, compressedBytes: compressed.byteLength, sha256: hash };
}
export async function maintenance(env) {
  const holder = crypto.randomUUID(), now = Date.now();
  const lease = await stmt(env.DB, 'INSERT INTO maintenance_leases(key,holder,expires_ms) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET holder=excluded.holder,expires_ms=excluded.expires_ms WHERE maintenance_leases.expires_ms<?', 'maintenance', holder, now + 180000, now).run();
  if (!lease.meta.changes) return { status: 'already_running' };
  let archive, error;
  try {
    const cutoff = iso(now - 86400000);
    await env.DB.batch([
      stmt(env.DB, 'DELETE FROM device_logs WHERE (device_id,boot_id,seq) IN (SELECT device_id,boot_id,seq FROM device_logs WHERE received_at<? LIMIT 200)', cutoff),
      stmt(env.DB, "UPDATE commands SET status='expired',updated_at=? WHERE status='queued' AND expires_at<?", iso(now), iso(now)),
      env.DB.prepare('DELETE FROM boot_sessions WHERE (device_id,boot_id) IN (SELECT device_id,boot_id FROM boot_sessions WHERE NOT EXISTS (SELECT 1 FROM reading_windows w WHERE w.device_id=boot_sessions.device_id AND w.boot_id=boot_sessions.boot_id) AND created_at < datetime(\'now\',\'-31 days\') LIMIT 100)')
    ]);
    archive = await archiveOldest(env);
  } catch (e) { error = String(e).slice(0, 250); console.error('maintenance_failed', error); }
  const capacity = await updateCapacity(env);
  const report = { checkedAt: iso(Date.now()), archive: archive ?? { status: 'failed', sourceRetained: true }, ...(error ? { error } : {}), capacity };
  await env.DB.batch([
    stmt(env.DB, 'INSERT INTO system_state(key,value_json,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at', 'maintenance', JSON.stringify(report), report.checkedAt),
    stmt(env.DB, 'DELETE FROM maintenance_leases WHERE key=? AND holder=?', 'maintenance', holder)
  ]);
  return report;
}
export async function archiveList(env, url) {
  const deviceId = id(url.searchParams.get('deviceId') ?? 'coop-monitor-01'), cursor = url.searchParams.get('cursor') ?? '';
  if (cursor.length > 250) throw new ApiError(400, 'invalid_cursor', 'Invalid cursor');
  const rows = (await stmt(env.DB, 'SELECT * FROM archive_manifests WHERE device_id=? AND object_key>? ORDER BY object_key LIMIT 101', deviceId, cursor).all()).results;
  return { archives: rows.slice(0,100), nextCursor: rows.length > 100 ? rows[99].object_key : null };
}
export async function archiveDownload(env, key) {
  const manifest = await stmt(env.DB, 'SELECT * FROM archive_manifests WHERE object_key=?', key).first();
  if (!manifest) throw new ApiError(404, 'archive_not_found', 'Archive is not in the verified catalog');
  const object = await env.ARCHIVES.get(key);
  if (!object) throw new ApiError(503, 'archive_unavailable', 'Archive object is unavailable');
  return new Response(object.body, { headers: { 'content-type': 'application/gzip', 'content-disposition': 'attachment; filename="coop-readings.json.gz"', 'cache-control':'no-store', 'x-archive-sha256': manifest.sha256 } });
}
