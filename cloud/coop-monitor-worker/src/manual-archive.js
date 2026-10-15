import { sha256 } from './auth.js';
import { SAMPLE_FIELDS, ApiError, id, integer } from './protocol.js';
import { updateCapacity } from './archive.js';

const iso = ms => new Date(ms).toISOString();
const stmt = (db, sql, ...values) => db.prepare(sql).bind(...values);
const uptimeIndex = SAMPLE_FIELDS.indexOf('uptimeMs');
// Use the same server-anchored timeline as History, including both endpoints.
const matching = `w.device_id=? AND w.block_id>=? AND w.block_id<?
  AND w.anchor_ms+json_extract(s.value,'$[${uptimeIndex}]') BETWEEN ? AND ?`;
function range(value) {
  const deviceId = id(value.deviceId, 'deviceId');
  const from = typeof value.from === 'string' ? Date.parse(value.from) : NaN;
  const to = typeof value.to === 'string' ? Date.parse(value.to) : NaN;
  if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to <= from || to - from > 31 * 86400000)
    throw new ApiError(400, 'invalid_range', 'Use a valid range up to 31 days');
  return { deviceId, from, to };
}
const bounds = r => [r.deviceId, iso(Math.max(0, r.from - 60000)), iso(r.to + 1), r.from, r.to];
async function count(db, r) {
  return (await stmt(db, `SELECT COUNT(*) AS count FROM reading_windows w, json_each(w.data_json) s WHERE ${matching}`, ...bounds(r)).first()).count;
}
export async function archiveSelection(env, url) {
  const r = range(Object.fromEntries(url.searchParams));
  return { deviceId: r.deviceId, from: iso(r.from), to: iso(r.to), count: await count(env.DB, r) };
}
export async function startManualArchive(env, value) {
  const r = range(value);
  if (typeof value.label !== 'string' || !value.label.trim() || value.label.trim().length > 80 || /[\u0000-\u001f\u007f]/.test(value.label))
    throw new ApiError(400, 'invalid_label', 'Enter an archive label from 1 to 80 characters');
  const expected = integer(value.expectedCount, 'expectedCount', 1);
  const db = env.DB.withSession('first-primary');
  if (!await stmt(db, 'SELECT device_id FROM devices WHERE device_id=?', r.deviceId).first())
    throw new ApiError(404, 'device_not_found', 'Device is not registered');
  const selectedCount = await count(db, r);
  if (selectedCount !== expected) throw new ApiError(409, 'selection_changed', 'The selected entry count changed. Review the refreshed count and try again.');
  const archiveId = crypto.randomUUID(), now = iso(Date.now());
  await stmt(db, `INSERT INTO manual_archives(archive_id,device_id,label,range_from,range_to,selected_count,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?)`, archiveId, r.deviceId, value.label.trim(), iso(r.from), iso(r.to), selectedCount, now, now).run();
  return await stmt(db, 'SELECT * FROM manual_archives WHERE archive_id=?', archiveId).first();
}
export async function continueManualArchive(env, archiveId) {
  id(archiveId, 'archiveId');
  const db = env.DB.withSession('first-primary'), holder = crypto.randomUUID(), now = Date.now();
  // Serialize with automatic retention and other manual chunks, without pausing ingestion.
  const lease = await stmt(db, `INSERT INTO maintenance_leases(key,holder,expires_ms) VALUES (?,?,?)
    ON CONFLICT(key) DO UPDATE SET holder=excluded.holder,expires_ms=excluded.expires_ms WHERE maintenance_leases.expires_ms<?`,
    'maintenance', holder, now + 180000, now).run();
  if (!lease.meta.changes) throw new ApiError(409, 'archive_busy', 'Archive maintenance is running. Continue this archive in a moment.');
  try {
    const job = await stmt(db, 'SELECT * FROM manual_archives WHERE archive_id=?', archiveId).first();
    if (!job) throw new ApiError(404, 'archive_not_found', 'Manual archive was not found');
    if (job.status === 'complete') return job;
    const r = range({ deviceId: job.device_id, from: job.range_from, to: job.range_to });
    const rows = (await stmt(db, `SELECT w.* FROM reading_windows w WHERE w.device_id=? AND w.block_id>=? AND w.block_id<?
      AND EXISTS (SELECT 1 FROM json_each(w.data_json) s WHERE w.anchor_ms+json_extract(s.value,'$[${uptimeIndex}]') BETWEEN ? AND ?)
      ORDER BY w.block_id LIMIT 30`, ...bounds(r)).all()).results;
    if (!rows.length) {
      await updateCapacity({ ...env, DB: db });
      const completedAt = iso(Date.now());
      await stmt(db, "UPDATE manual_archives SET status='complete',updated_at=? WHERE archive_id=?", completedAt, archiveId).run();
      return { ...job, status: 'complete', updated_at: completedAt };
    }
    const blocks = rows.map(row => {
      const samples = JSON.parse(row.data_json), inside = t => row.anchor_ms + t[uptimeIndex] >= r.from && row.anchor_ms + t[uptimeIndex] <= r.to;
      return { row, retained: samples.filter(t => !inside(t)), block: { blockId: row.block_id, bootId: row.boot_id,
        anchorMs: row.anchor_ms, samples: samples.filter(inside), state: row.state_json ? JSON.parse(row.state_json) : null, receivedAt: row.received_at } };
    });
    for (const entry of blocks) {
      entry.hashes = JSON.parse(entry.row.archived_hashes_json);
      const hashes = await Promise.all(entry.block.samples.map(async tuple => [tuple[0], await sha256(JSON.stringify(tuple))]));
      for (const [seq, hash] of hashes) entry.hashes[seq] = hash;
    }
    const hour = rows[0].block_id.slice(0, 13) + ':00:00.000Z';
    const document = { formatVersion: 1, deviceId: job.device_id, hourStart: hour, sampleFields: SAMPLE_FIELDS,
      manualArchive: { id: archiveId, label: job.label, from: job.range_from, to: job.range_to }, blocks: blocks.map(b => b.block) };
    const original = new TextEncoder().encode(JSON.stringify(document)), originalHash = await sha256(original);
    const compressed = new Uint8Array(await new Response(new Blob([original]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
    const hash = await sha256(compressed), key = `v1/${job.device_id}/manual/${archiveId}/${originalHash}.json.gz`;
    const used = await db.prepare('SELECT COALESCE(SUM(compressed_bytes),0) AS bytes FROM archive_manifests').first();
    if (used.bytes + compressed.byteLength >= Number(env.ARCHIVE_MAX_BYTES ?? 10000000000) * .95)
      throw new ApiError(409, 'archive_capacity_paused', 'Archive storage is near capacity. Remaining entries are still in History.');
    await env.ARCHIVES.put(key, compressed, { httpMetadata: { contentType: 'application/gzip' },
      customMetadata: { sha256: hash, originalSha256: originalHash, formatVersion: '1' } });
    const check = await env.ARCHIVES.get(key);
    if (!check || await sha256(await check.arrayBuffer()) !== hash)
      throw new ApiError(503, 'archive_verification_failed', 'Archive verification failed. Remaining entries are still in History; continue to retry.');
    const sampleCount = blocks.reduce((n, b) => n + b.block.samples.length, 0), timestamp = iso(Date.now());
    try {
      await db.batch([
        // CHECK(revision>0) aborts the entire transaction if ingestion changed a block.
        // Keep state/counters and empty blocks so Overview and exchange bookkeeping survive.
        ...blocks.map(({ row, retained, hashes }) => stmt(db, `UPDATE reading_windows SET data_json=?,archived_hashes_json=?,
          revision=CASE WHEN revision=? THEN revision+1 ELSE 0 END WHERE device_id=? AND block_id=?`,
          JSON.stringify(retained), JSON.stringify(hashes), row.revision, row.device_id, row.block_id)),
        stmt(db, `INSERT INTO archive_manifests(object_key,device_id,hour_start,format_version,sample_count,block_count,
          compressed_bytes,sha256,original_sha256,created_at,verified_at,manual_archive_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          key, job.device_id, hour, 1, sampleCount, blocks.length, compressed.byteLength, hash, originalHash, timestamp, timestamp, archiveId),
        stmt(db, 'UPDATE manual_archives SET archived_count=archived_count+?,updated_at=? WHERE archive_id=?', sampleCount, timestamp, archiveId)
      ]);
    } catch (error) {
      if (String(error).includes('CHECK constraint failed'))
        throw new ApiError(409, 'archive_conflict', 'New readings arrived during archiving. Continue to retry; source entries were retained.');
      throw error;
    }
    return { ...job, archived_count: job.archived_count + sampleCount, updated_at: timestamp };
  } finally {
    await stmt(db, 'DELETE FROM maintenance_leases WHERE key=? AND holder=?', 'maintenance', holder).run();
  }
}
