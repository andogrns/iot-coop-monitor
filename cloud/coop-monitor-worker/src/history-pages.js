import { ApiError, id, integer, unpackSample } from './protocol.js';

const iso = ms => new Date(ms).toISOString();
const time = "w.anchor_ms+json_extract(s.value,'$[1]')";
const seq = "json_extract(s.value,'$[0]')";

// Entry pagination is opt-in; the block API used by trends and exports stays intact.
export async function historyPage(env, url, deviceId) {
  const pageSize = integer(Number(url.searchParams.get('pageSize')), 'pageSize', 50, 1000);
  const order = url.searchParams.get('order') ?? 'desc';
  if (!['asc', 'desc'].includes(order)) throw new ApiError(400, 'invalid_order', 'History order must be asc or desc');
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
  const lower = iso(Math.max(0, from - 60000, !descending && position ? position[0] - 60000 : 0));
  const upper = iso((descending ? Math.min(to, position?.[0] ?? to) : to) + 1);
  const filter = `${time} BETWEEN ? AND ?${position ? ` AND (${time},w.boot_id COLLATE BINARY,${seq})${descending ? '<' : '>'}(?,?,?)` : ''}`;
  const values = [from, to, ...(position ?? [])];
  // Each candidate contributes at least one matching entry. Read overlapping
  // windows around the final candidate before sorting, so boot offsets cannot
  // hide a newer sample. JSON projection and LIMIT bound returned data to N+1.
  const rows = (await env.DB.prepare(`WITH candidates AS (
    SELECT w.block_id FROM reading_windows w WHERE w.device_id=? AND w.block_id>=? AND w.block_id<?
    AND EXISTS (SELECT 1 FROM json_each(w.data_json) s WHERE ${filter})
    ORDER BY w.block_id ${direction} LIMIT ?
  ) SELECT w.boot_id,w.anchor_ms,s.value AS tuple,${time} AS estimated_ms
    FROM reading_windows w,json_each(w.data_json) s
    WHERE w.device_id=? AND w.block_id>=? AND w.block_id<?
    AND w.block_id${descending ? '>=' : '<'}strftime('%Y-%m-%dT%H:%M:%fZ',substr((SELECT ${descending ? 'MIN' : 'MAX'}(block_id) FROM candidates),1,24),'${descending ? '-' : '+'}60 seconds')
    AND ${filter} ORDER BY estimated_ms ${direction},w.boot_id COLLATE BINARY ${direction},${seq} ${direction} LIMIT ?`)
    .bind(deviceId, lower, upper, ...values, pageSize + 1, deviceId, lower, upper, ...values, pageSize + 1).all()).results;
  const page = rows.slice(0, pageSize), last = page.at(-1);
  const readings = page.map(row => unpackSample(JSON.parse(row.tuple), deviceId, row.boot_id, row.anchor_ms));
  return { readings, nextCursor: rows.length > pageSize
    ? btoa(JSON.stringify([deviceId, from, to, last.estimated_ms, last.boot_id, readings.at(-1).seq, order])) : null,
    pageSize, mode: latest ? 'latest' : 'range', order, from: iso(from), to: iso(to),
    timeline: `Individual readings ordered by server-anchored uptime, ${descending ? 'newest' : 'oldest'} first` };
}
