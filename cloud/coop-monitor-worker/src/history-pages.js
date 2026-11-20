import { ApiError, id, integer, unpackSample } from './protocol.js';

const iso = ms => new Date(ms).toISOString();
const time = "w.anchor_ms+json_extract(s.value,'$[1]')";
const seq = "json_extract(s.value,'$[0]')";
const rowsOf = async statement => (await statement.all()).results;

// Above the most readings a 31-day range can hold at the 2-second minimum sampling interval.
export const MAX_HISTORY_OFFSET = 2000000;

// Opens page N (offset = entries to skip) without sorting every skipped entry.
// A reading always lies within [block start, block start + 60 s), because blocks are keyed
// by the boot anchor plus whole uptime minutes: the rule the page query's 60-second overlap
// already relies on. Block sizes alone (no per-entry JSON) pick a pivot block with at most
// `offset` entries before it in page order. The entries beyond the pivot time are then
// counted exactly: whole blocks that lie inside the range by their size, and only the
// blocks at the range edge and next to the pivot entry by entry. The page query finally
// skips the short remainder with OFFSET.
// Returns { bound, skipped }: exactly `skipped` matching entries lie beyond `bound`
// (desc: time > bound; asc: time < bound), or null when the offset ends inside the first block.
async function seek(env, { deviceId, from, to, descending, offset, lower, upper }) {
  const direction = descending ? 'DESC' : 'ASC';
  // Each nonempty block holds at least one entry, so the pivot is among the first offset+1 of them.
  const [pivot] = await rowsOf(env.DB.prepare(`SELECT block_id FROM (
      SELECT block_id,SUM(n) OVER (ORDER BY block_id ${direction}) AS running FROM (
        SELECT block_id,json_array_length(data_json) AS n FROM reading_windows
        WHERE device_id=? AND block_id>=? AND block_id<? AND data_json<>'[]' ORDER BY block_id ${direction} LIMIT ?)
    ) WHERE running<=? ORDER BY block_id ${descending ? 'ASC' : 'DESC'} LIMIT 1`).bind(deviceId, lower, upper, offset + 1, offset));
  if (!pivot) return null;
  const start = Date.parse(pivot.block_id.slice(0, 24));
  if (!Number.isFinite(start)) return null;
  // desc: entries newer than start + 60 s can only be in blocks after the pivot;
  // asc: entries older than start can only be in blocks before it.
  const bound = descending ? start + 60000 : start;
  // Whole blocks: every entry is beyond the bound and inside [from, to].
  // Edge blocks (next to the bound or to the range end) are counted entry by entry.
  const [whole, edge, after, before] = descending
    ? [[iso(bound + 1), iso(to - 59999)], [iso(start), iso(bound + 1), iso(to - 59999), upper], Math.max(from, bound + 1), to]
    : [[iso(from), iso(bound - 59999)], [lower, iso(from), iso(bound - 59999), iso(bound)], from, Math.min(to, bound - 1)];
  const [{ n }] = await rowsOf(env.DB.prepare(`SELECT
      (SELECT COALESCE(SUM(json_array_length(data_json)),0) FROM reading_windows WHERE device_id=? AND block_id>=? AND block_id<?)
    + (SELECT COUNT(*) FROM reading_windows w,json_each(w.data_json) s WHERE w.device_id=?
        AND ((w.block_id>=? AND w.block_id<?) OR (w.block_id>=? AND w.block_id<?)) AND ${time} BETWEEN ? AND ?) AS n`)
    .bind(deviceId, ...whole, deviceId, ...edge, after, before));
  return n <= offset ? { bound, skipped: n } : null;
}

// Entry pagination is opt-in; the block API used by trends and exports stays intact.
// offset (without a cursor) skips that many entries so the dashboard can open any
// numbered page; cursors remain the cheap way to step to the following page.
export async function historyPage(env, url, deviceId) {
  const pageSize = integer(Number(url.searchParams.get('pageSize')), 'pageSize', 50, 1000);
  const order = url.searchParams.get('order') ?? 'desc';
  if (!['asc', 'desc'].includes(order)) throw new ApiError(400, 'invalid_order', 'History order must be asc or desc');
  const offset = url.searchParams.has('offset') ? integer(Number(url.searchParams.get('offset')), 'offset', 0, MAX_HISTORY_OFFSET) : 0;
  if (offset && url.searchParams.has('cursor')) throw new ApiError(400, 'invalid_offset', 'Use either a cursor or an offset, not both');
  const descending = order === 'desc', direction = descending ? 'DESC' : 'ASC';
  const latest = url.searchParams.get('mode') === 'latest';
  let from = Date.parse(url.searchParams.get('from') ?? iso(Date.now() - 3600000));
  let to = Date.parse(url.searchParams.get('to') ?? iso(Date.now()));
  let position = null;
  const cursor = url.searchParams.get('cursor');
  if (cursor) {
    try {
      if (cursor.length > 512) throw Error();
      const v = JSON.parse(atob(cursor));
      if (!Array.isArray(v) || ![6, 7].includes(v.length) || v[0] !== deviceId ||
          !v.slice(1, 4).every(Number.isSafeInteger) || v[1] < 0 || v[2] <= v[1] ||
          v[2] - v[1] > 31 * 86400000 || v[3] < v[1] || v[3] > v[2]) throw Error();
      id(v[4], 'bootId'); integer(v[5], 'seq', 0, 4294967295);
      // Six-field cursors issued before the order control represent DESC.
      if ((v[6] ?? 'desc') !== order) throw Error();
      if (!latest && (from !== v[1] || to !== v[2])) throw Error();
      [from, to] = v.slice(1, 3); position = v.slice(3, 6);
    } catch { throw new ApiError(400, 'invalid_cursor', 'Invalid history page cursor'); }
  } else if (latest) {
    to = Date.now(); from = Math.max(0, to - Number(env.RETENTION_DAYS ?? 30) * 86400000);
  }
  if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to <= from || to - from > 31 * 86400000)
    throw new ApiError(400, 'invalid_range', 'Use a valid range up to 31 days');
  const sought = offset ? await seek(env, { deviceId, from, to, descending, offset,
    lower: iso(Math.max(0, from - 60000)), upper: iso(to + 1) }) : null;
  const skip = offset - (sought?.skipped ?? 0), bound = sought?.bound;
  const lower = iso(Math.max(0, from - 60000, !descending && position ? position[0] - 60000 : 0, !descending && sought ? bound - 60000 : 0));
  const upper = iso((descending ? Math.min(to, position?.[0] ?? to, sought ? bound : to) : to) + 1);
  const filter = `${time} BETWEEN ? AND ?${sought ? ` AND ${time}${descending ? '<=' : '>='}?` : ''}${position ? ` AND (${time},w.boot_id COLLATE BINARY,${seq})${descending ? '<' : '>'}(?,?,?)` : ''}`;
  const values = [from, to, ...(sought ? [bound] : []), ...(position ?? [])];
  // Each candidate contributes at least one matching entry. Read overlapping
  // windows around the final candidate before sorting, so boot offsets cannot
  // hide a newer sample. JSON projection and LIMIT bound returned data to N+1
  // (N = skipped entries + page size; OFFSET then drops the skipped entries).
  const rows = await rowsOf(env.DB.prepare(`WITH candidates AS (
    SELECT w.block_id FROM reading_windows w WHERE w.device_id=? AND w.block_id>=? AND w.block_id<?
    AND EXISTS (SELECT 1 FROM json_each(w.data_json) s WHERE ${filter})
    ORDER BY w.block_id ${direction} LIMIT ?
  ) SELECT w.boot_id,w.anchor_ms,s.value AS tuple,${time} AS estimated_ms
    FROM reading_windows w,json_each(w.data_json) s
    WHERE w.device_id=? AND w.block_id>=? AND w.block_id<?
    AND w.block_id${descending ? '>=' : '<'}strftime('%Y-%m-%dT%H:%M:%fZ',substr((SELECT ${descending ? 'MIN' : 'MAX'}(block_id) FROM candidates),1,24),'${descending ? '-' : '+'}60 seconds')
    AND ${filter} ORDER BY estimated_ms ${direction},w.boot_id COLLATE BINARY ${direction},${seq} ${direction} LIMIT ? OFFSET ?`)
    .bind(deviceId, lower, upper, ...values, skip + pageSize + 1, deviceId, lower, upper, ...values, pageSize + 1, skip));
  const page = rows.slice(0, pageSize), last = page.at(-1);
  const readings = page.map(row => unpackSample(JSON.parse(row.tuple), deviceId, row.boot_id, row.anchor_ms));
  return { readings, nextCursor: rows.length > pageSize
    ? btoa(JSON.stringify([deviceId, from, to, last.estimated_ms, last.boot_id, readings.at(-1).seq, order])) : null,
    pageSize, offset, mode: latest ? 'latest' : 'range', order, from: iso(from), to: iso(to),
    timeline: `Individual readings ordered by server-anchored uptime, ${descending ? 'newest' : 'oldest'} first` };
}
