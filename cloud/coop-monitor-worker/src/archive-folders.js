import { ApiError, id } from './protocol.js';

const iso = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
function folderIdentity(value) {
  if (typeof value === 'string' && value.startsWith('manual:')) { id(value.slice(7), 'archiveId'); return { type: 'manual', value: value.slice(7) }; }
  // Automatic folders are whole UTC days; each day holds that day's hourly chunks.
  if (typeof value === 'string' && value.startsWith('auto:') && iso(value.slice(5)) && value.endsWith('T00:00:00.000Z')) return { type: 'automatic', value: value.slice(5) };
  throw new ApiError(400, 'invalid_folder', 'Invalid archive folder');
}
function cursor(url, kind, deviceId, folder) {
  const value = url.searchParams.get('cursor');
  if (!value) return null;
  try {
    if (value.length > 1024) throw Error();
    const parts = JSON.parse(atob(value));
    if (!Array.isArray(parts) || parts.length !== (folder ? 5 : 4) || parts[0] !== kind || parts[1] !== deviceId) throw Error();
    if (folder && parts[2] !== folder) throw Error();
    const [time, key] = parts.slice(-2);
    if (!iso(time) || typeof key !== 'string' || !key || key.length > 250) throw Error();
    if (!folder) folderIdentity(key);
    return [time, key];
  } catch { throw new ApiError(400, 'invalid_cursor', 'Invalid archive cursor'); }
}
const groupQuery = `WITH parts AS (
  SELECT manual_archive_id,COALESCE(manual_archive_id,substr(hour_start,1,10)||'T00:00:00.000Z') AS group_key,
    COUNT(*) AS file_count,SUM(sample_count) AS sample_count,SUM(compressed_bytes) AS compressed_bytes,MAX(created_at) AS saved_at
  FROM archive_manifests WHERE device_id=? GROUP BY manual_archive_id,group_key
), folders AS (
  SELECT 'manual:'||j.archive_id AS folder_id,'manual' AS type,j.label,j.range_from,j.range_to,
    j.updated_at AS archived_at,j.created_at AS started_at,j.status,j.archive_id,j.selected_count,j.archived_count,
    COALESCE(p.file_count,0) AS file_count,COALESCE(p.sample_count,0) AS sample_count,COALESCE(p.compressed_bytes,0) AS compressed_bytes
  FROM manual_archives j LEFT JOIN parts p ON p.manual_archive_id=j.archive_id WHERE j.device_id=?
  UNION ALL
  SELECT 'auto:'||p.group_key,'automatic','Automatic archive '||substr(p.group_key,1,10)||' (UTC)',p.group_key,
    strftime('%Y-%m-%dT%H:%M:%fZ',p.group_key,'+1 day'),p.saved_at,p.saved_at,'complete',NULL,p.sample_count,p.sample_count,
    p.file_count,p.sample_count,p.compressed_bytes FROM parts p WHERE p.manual_archive_id IS NULL
) SELECT * FROM folders`;

export async function archiveFolders(env, url) {
  const deviceId = id(url.searchParams.get('deviceId') ?? 'coop-monitor-01');
  const position = cursor(url, 'folders', deviceId);
  const rows = (await env.DB.prepare(groupQuery + (position ? ' WHERE (archived_at,folder_id)<(?,?)' : '') + ' ORDER BY archived_at DESC,folder_id DESC LIMIT 51')
    .bind(deviceId, deviceId, ...(position ?? [])).all()).results;
  const folders = rows.slice(0, 50), last = folders.at(-1);
  return { folders, nextCursor: rows.length > 50 ? btoa(JSON.stringify(['folders', deviceId, last.archived_at, last.folder_id])) : null };
}

export async function archiveFiles(env, url) {
  const deviceId = id(url.searchParams.get('deviceId') ?? 'coop-monitor-01'), folder = url.searchParams.get('folder');
  const identity = folderIdentity(folder), position = cursor(url, 'files', deviceId, folder);
  const manual = identity.type === 'manual';
  const predicate = manual ? 'manual_archive_id=?' : 'manual_archive_id IS NULL AND hour_start>=? AND hour_start<?';
  const scope = manual ? [identity.value] : [identity.value, new Date(Date.parse(identity.value) + 86400000).toISOString()];
  const exists = manual
    ? await env.DB.prepare('SELECT 1 AS found FROM manual_archives WHERE device_id=? AND archive_id=?').bind(deviceId, identity.value).first()
    : await env.DB.prepare(`SELECT 1 AS found FROM archive_manifests WHERE device_id=? AND ${predicate} LIMIT 1`).bind(deviceId, ...scope).first();
  if (!exists) throw new ApiError(404, 'archive_not_found', 'Archive folder was not found for this device');
  const rows = (await env.DB.prepare(`SELECT object_key,sample_count,block_count,compressed_bytes,sha256,original_sha256,created_at,verified_at
    FROM archive_manifests WHERE device_id=? AND ${predicate}${position ? ' AND (created_at,object_key)>(?,?)' : ''}
    ORDER BY created_at,object_key LIMIT 101`).bind(deviceId, ...scope, ...(position ?? [])).all()).results;
  const files = rows.slice(0, 100), last = files.at(-1);
  return { files, nextCursor: rows.length > 100 ? btoa(JSON.stringify(['files', deviceId, folder, last.created_at, last.object_key])) : null };
}
