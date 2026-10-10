import { ApiError, DEFAULT_CONFIG, id, integer, validateConfig, validateCommand, mergeSamples, unpackSample, canTransition } from './protocol.js';
import { sha256 } from './auth.js';
const iso = ms => new Date(ms).toISOString();
export const blockKey = (anchor, uptime, bootId) => `${iso(anchor + Math.floor(uptime / 60000) * 60000)}_${bootId}`;
const stmt = (db, sql, ...values) => db.prepare(sql).bind(...values);
export async function capacity(env) {
  const row = await stmt(env.DB, 'SELECT value_json, updated_at FROM system_state WHERE key = ?', 'capacity').first();
  const c = row ? JSON.parse(row.value_json) : { databaseBytes: 0, archiveBytes: 0, uploadRequests: 0, estimatedD1Writes: 0 };
  c.updatedAt = row?.updated_at ?? null;
  c.databaseLimitBytes = Number(env.DB_MAX_BYTES ?? 500000000);
  c.archiveLimitBytes = Number(env.ARCHIVE_MAX_BYTES ?? 10000000000);
  const stale = !c.updatedAt || Date.now() - Date.parse(c.updatedAt) > 3600000;
  const reasons = [];
  if (stale) reasons.push('capacity_check_pending');
  if (c.databaseBytes >= c.databaseLimitBytes * .95) reasons.push('database_storage');
  if (c.archiveBytes >= c.archiveLimitBytes * .95) reasons.push('archive_storage');
  if (c.estimatedD1Writes >= Number(env.D1_DAILY_WRITE_LIMIT ?? 100000) * .95) reasons.push('daily_database_writes');
  if (c.uploadRequests + Number(env.DASHBOARD_DAILY_REQUEST_RESERVE ?? 21600) >= Number(env.WORKER_DAILY_REQUEST_LIMIT ?? 100000) * .95) reasons.push('daily_request_reserve');
  c.paused = reasons.length > 0; c.reasons = reasons;
  c.warning = c.databaseBytes >= c.databaseLimitBytes * .8 || c.archiveBytes >= c.archiveLimitBytes * .8 || c.estimatedD1Writes >= Number(env.D1_DAILY_WRITE_LIMIT ?? 100000) * .8;
  return c;
}
export async function exchange(env, device, body) {
  const db = env.DB.withSession('first-primary');
  const now = Date.now(), receivedAt = iso(now), limits = await capacity(env);
  const currentConfig = () => ({ revision: device.desired_config_revision, settings: JSON.parse(device.desired_config_json) });
  const paused = limits.paused || device.writes_paused === 1;
  let boot = await stmt(db, 'SELECT anchor_ms FROM boot_sessions WHERE device_id = ? AND boot_id = ?', body.deviceId, body.bootId).first();
  if (!boot && !paused) {
    const anchor = now - body.state.uptimeMs;
    if (anchor < 0) throw new ApiError(400, 'invalid_uptime', 'Uptime exceeds server epoch');
    await stmt(db, 'INSERT INTO boot_sessions(device_id,boot_id,anchor_ms,created_at) VALUES (?,?,?,?) ON CONFLICT DO NOTHING', body.deviceId, body.bootId, anchor, receivedAt).run();
    boot = await stmt(db, 'SELECT anchor_ms FROM boot_sessions WHERE device_id = ? AND boot_id = ?', body.deviceId, body.bootId).first();
  }
  const anchor = boot?.anchor_ms ?? now - body.state.uptimeMs;
  if (Math.abs(anchor + body.state.uptimeMs - now) > 300000) throw new ApiError(400, 'boot_clock_mismatch', 'Use the current uptime and a new bootId after reboot; boot clock drift exceeds five minutes');
  const rejectedReadings = [], usableReadings = [];
  for (const r of body.readings) {
    const estimated = anchor + r.uptimeMs;
    if (estimated < now - Number(env.RETENTION_DAYS ?? 30) * 86400000) { rejectedReadings.push({ bootId: body.bootId, seq: r.seq, reason: 'outside_recent_retention' }); continue; }
    if (r.sampledAt && Math.abs(Date.parse(r.sampledAt) - estimated) > 300000) throw new ApiError(400, 'clock_mismatch', 'sampledAt disagrees with boot uptime by more than five minutes');
    usableReadings.push(r);
  }
  const groups = new Map();
  const liveKey = blockKey(anchor, body.state.uptimeMs, body.bootId);
  groups.set(liveKey, []);
  for (const r of usableReadings) { const key = blockKey(anchor, r.uptimeMs, body.bootId); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(r); }
  if (groups.size > 4) throw new ApiError(400, 'batch_spans_too_many_minutes', 'Limit each exchange to readings from four minute windows');

  const acceptedLogs = [], droppedLogs = [];
  if (!paused && body.logs.length) {
    const recent = await stmt(db, 'SELECT COUNT(*) AS n FROM device_logs WHERE device_id = ? AND received_at >= ?', body.deviceId, iso(now - 3600000)).first();
    let budget = Math.max(0, 60 - recent.n);
    for (const log of body.logs) {
      const existing = await stmt(db, 'SELECT seq FROM device_logs WHERE device_id = ? AND boot_id = ? AND seq = ?', body.deviceId, body.bootId, log.seq).first();
      if (existing) acceptedLogs.push({ ...log, duplicate: true });
      else if (budget > 0) { acceptedLogs.push(log); budget--; }
      else droppedLogs.push({ bootId: body.bootId, seq: log.seq, reason: 'console_rate_limit_60_per_hour' });
    }
  }
  const resultUpdates = [], ackedResults = [], rejectedResults = [];
  for (const result of body.commandResults) {
    const old = await stmt(db, 'SELECT * FROM commands WHERE command_id = ? AND device_id = ?', result.id, body.deviceId).first();
    if (!old || !canTransition(old.status, result.status, old.expires_at, now)) { rejectedResults.push({ id: result.id, reason: 'unknown_expired_or_terminal_command' }); continue; }
    if (old.status === result.status && (old.result_json === JSON.stringify(result) || ['completed','failed','uncertain'].includes(old.status))) { ackedResults.push(result.id); continue; }
    resultUpdates.push({ old, result });
  }
  let measured = { rowsRead: 0, rowsWritten: 0, databaseBytes: 0 };
  for (let attempt = 0; attempt < 4; attempt++) {
    const statements = [], windowCount = paused ? 0 : groups.size;
    if (!paused) {
      for (const [key, readings] of groups) {
        const old = await stmt(db, 'SELECT * FROM reading_windows WHERE device_id = ? AND block_id = ?', body.deviceId, key).first();
        const tuples = mergeSamples(old ? JSON.parse(old.data_json) : [], readings);
        const state = key === liveKey ? JSON.stringify({ ...body.state, bootId: body.bootId, receivedAt }) : old?.state_json ?? null;
        const writes = key === liveKey ? windowCount + acceptedLogs.filter(l => !l.duplicate).length * 3 + resultUpdates.length + (old ? 0 : 2) : 0;
        statements.push(stmt(db, `INSERT INTO reading_windows(device_id,block_id,boot_id,anchor_ms,data_json,state_json,received_at,revision,request_count,estimated_writes)
          VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(device_id,block_id) DO UPDATE SET
          data_json=excluded.data_json,state_json=excluded.state_json,received_at=excluded.received_at,
          revision=CASE WHEN reading_windows.revision=? THEN excluded.revision ELSE 0 END,
          request_count=excluded.request_count,estimated_writes=excluded.estimated_writes`,
          body.deviceId, key, body.bootId, anchor, JSON.stringify(tuples), state, receivedAt,
          (old?.revision ?? 0) + 1, (old?.request_count ?? 0) + (key === liveKey ? 1 : 0), (old?.estimated_writes ?? 0) + writes, old?.revision ?? 0));
      }
      for (const log of acceptedLogs.filter(l => !l.duplicate)) statements.push(stmt(db, 'INSERT INTO device_logs(device_id,boot_id,seq,uptime_ms,sampled_at,received_at,level,message) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING', body.deviceId, body.bootId, log.seq, log.uptimeMs, log.sampledAt, receivedAt, log.level, log.message));
    }
    for (const { old, result } of resultUpdates) statements.push(stmt(db, 'UPDATE commands SET status=?,result_json=?,updated_at=? WHERE command_id=? AND device_id=? AND status=?', result.status, JSON.stringify(result), receivedAt, result.id, body.deviceId, old.status));
    try {
      const results = statements.length ? await db.batch(statements) : [];
      measured = results.reduce((a, r) => ({ rowsRead: a.rowsRead + (r.meta.rows_read ?? 0), rowsWritten: a.rowsWritten + (r.meta.rows_written ?? 0), databaseBytes: Math.max(a.databaseBytes, r.meta.size_after ?? 0) }), measured);
      const offset = statements.length - resultUpdates.length;
      resultUpdates.forEach(({ result }, i) => { if (results[offset + i]?.meta.changes > 0) ackedResults.push(result.id); else rejectedResults.push({ id: result.id, reason: 'command_state_changed' }); });
      break;
    } catch (error) {
      if (String(error).includes('CHECK constraint failed') && attempt < 3) continue;
      if (String(error).includes('CHECK constraint failed')) throw new ApiError(409, 'exchange_conflict', 'Concurrent exchange; retry the same IDs');
      throw error;
    }
  }
  const pending = await stmt(db, "SELECT command_id,type,args_json,status,expires_at FROM commands WHERE device_id=? AND status IN ('queued','accepted','running') AND (status <> 'queued' OR expires_at > ?) ORDER BY created_at LIMIT 10", body.deviceId, receivedAt).all();
  return { protocolVersion: 1, serverTime: receivedAt,
    acked: { readings: paused ? [] : usableReadings.map(r => ({ bootId: body.bootId, seq: r.seq })), logs: acceptedLogs.map(l => ({ bootId: body.bootId, seq: l.seq })), commandResults: ackedResults },
    rejected: { readings: rejectedReadings, logs: droppedLogs, commandResults: rejectedResults }, desiredConfig: currentConfig(),
    commands: pending.results.map(c => ({ id: c.command_id, type: c.type, args: JSON.parse(c.args_json), status: c.status, expiresAt: c.expires_at })),
    uploads: { paused, warning: limits.warning, reasons: device.writes_paused ? ['owner_pause'] : limits.reasons, retryAfterSec: paused ? 60 : 2 }, databaseUsage: measured };
}
export async function snapshot(env) {
  const devices = (await env.DB.prepare('SELECT device_id,label,desired_config_revision,desired_config_json,writes_paused FROM devices ORDER BY device_id').all()).results;
  const views = [];
  for (const d of devices) {
    const block = await stmt(env.DB, 'SELECT * FROM reading_windows WHERE device_id=? AND state_json IS NOT NULL ORDER BY block_id DESC LIMIT 1', d.device_id).first();
    const state = block ? JSON.parse(block.state_json) : null;
    let sampleBlock = block, tuples = block ? JSON.parse(block.data_json) : [];
    if (block && !tuples.length) { sampleBlock = await stmt(env.DB, "SELECT * FROM reading_windows WHERE device_id=? AND data_json<>'[]' ORDER BY block_id DESC LIMIT 1", d.device_id).first(); tuples = sampleBlock ? JSON.parse(sampleBlock.data_json) : []; }
    views.push({ deviceId: d.device_id, label: d.label, state, stale: !state || Date.now() - Date.parse(state.receivedAt) > 15000,
      latestReading: tuples.length ? unpackSample(tuples[tuples.length - 1], d.device_id, sampleBlock.boot_id, sampleBlock.anchor_ms) : null,
      desiredConfig: { revision: d.desired_config_revision, settings: JSON.parse(d.desired_config_json) }, writesPaused: d.writes_paused === 1 });
  }
  const maintenance = await stmt(env.DB, 'SELECT value_json FROM system_state WHERE key=?', 'maintenance').first();
  return { devices: views, capacity: await capacity(env), maintenance: maintenance ? JSON.parse(maintenance.value_json) : null, serverTime: iso(Date.now()) };
}
export async function history(env, url) {
  const deviceId = id(url.searchParams.get('deviceId') ?? 'coop-monitor-01', 'deviceId');
  const from = Date.parse(url.searchParams.get('from') ?? iso(Date.now() - 3600000)), to = Date.parse(url.searchParams.get('to') ?? iso(Date.now()));
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || to - from > 31 * 86400000) throw new ApiError(400, 'invalid_range', 'Use a valid range up to 31 days');
  const limit = integer(Number(url.searchParams.get('limit') ?? 30), 'limit', 1, 60), cursor = url.searchParams.get('cursor') ?? '';
  if (cursor.length > 160 || (cursor && !/^[A-Za-z0-9:_.-]+$/.test(cursor))) throw new ApiError(400, 'invalid_cursor', 'Invalid cursor');
  const rows = (await stmt(env.DB, 'SELECT * FROM reading_windows WHERE device_id=? AND block_id>=? AND block_id<? AND block_id>? ORDER BY block_id LIMIT ?', deviceId, iso(Math.max(0, from - 60000)), iso(to), cursor, limit + 1).all()).results;
  const page = rows.slice(0, limit), readings = page.flatMap(row => JSON.parse(row.data_json).map(t => unpackSample(t, deviceId, row.boot_id, row.anchor_ms))).filter(r => Date.parse(r.estimatedAt) >= from && Date.parse(r.estimatedAt) <= to);
  return { readings, nextCursor: rows.length > limit ? page.at(-1).block_id : null, from: iso(from), to: iso(to), timeline: 'estimatedAt uses the server-anchored boot clock; sampledAt remains null when device UTC is unknown' };
}
export async function logs(env, url) {
  const deviceId = id(url.searchParams.get('deviceId') ?? 'coop-monitor-01'), cursor = url.searchParams.get('cursor');
  let position = [iso(Date.now() - 86400000), '', -1];
  if (cursor) { try { position = JSON.parse(atob(cursor)); if (!Array.isArray(position) || position.length !== 3 || !Number.isFinite(Date.parse(position[0])) || typeof position[1] !== 'string' || !Number.isInteger(position[2])) throw Error(); } catch { throw new ApiError(400, 'invalid_cursor', 'Invalid log cursor'); } }
  const rows = (await stmt(env.DB, 'SELECT boot_id,seq,uptime_ms,sampled_at,received_at,level,message FROM device_logs WHERE device_id=? AND (received_at,boot_id,seq)>(?,?,?) ORDER BY received_at,boot_id,seq LIMIT 101', deviceId, ...position).all()).results;
  const page = rows.slice(0, 100), last = page.at(-1);
  return { logs: page, nextCursor: last ? btoa(JSON.stringify([last.received_at, last.boot_id, last.seq])) : cursor ?? null, hasMore: rows.length > 100 };
}
export async function setConfig(env, deviceId, body) {
  id(deviceId); const settings = validateConfig(body.settings), expected = integer(body.expectedRevision, 'expectedRevision', 1), now = iso(Date.now());
  const exists = await stmt(env.DB, 'SELECT desired_config_revision FROM devices WHERE device_id=?', deviceId).first();
  if (!exists) throw new ApiError(404, 'device_not_found', 'Device is not registered');
  if (exists.desired_config_revision !== expected) throw new ApiError(409, 'config_conflict', 'Refresh settings before updating');
  try {
    await env.DB.batch([
      stmt(env.DB, 'UPDATE devices SET desired_config_revision=CASE WHEN desired_config_revision=? THEN desired_config_revision+1 ELSE 0 END,desired_config_json=?,config_updated_at=? WHERE device_id=?', expected, JSON.stringify(settings), now, deviceId),
      stmt(env.DB, 'INSERT INTO config_history(device_id,revision,settings_json,created_at) SELECT device_id,desired_config_revision,desired_config_json,? FROM devices WHERE device_id=?', now, deviceId)
    ]);
  } catch (e) { if (String(e).includes('constraint')) throw new ApiError(409, 'config_conflict', 'Concurrent settings update; refresh'); throw e; }
  return { revision: expected + 1, settings };
}
export async function enqueueCommand(env, deviceId, body) {
  id(deviceId); const value = validateCommand(body), now = Date.now(), commandId = crypto.randomUUID();
  const device = await stmt(env.DB, 'SELECT device_id FROM devices WHERE device_id=?', deviceId).first();
  if (!device) throw new ApiError(404, 'device_not_found', 'Device is not registered');
  const active = await stmt(env.DB, "SELECT COUNT(*) AS n FROM commands WHERE device_id=? AND status IN ('queued','accepted','running') AND (status<>'queued' OR expires_at>?)", deviceId, iso(now)).first();
  if (active.n >= 10) throw new ApiError(409, 'command_queue_full', 'Wait for pending commands');
  await stmt(env.DB, 'INSERT INTO commands(command_id,device_id,type,args_json,created_at,expires_at,status,updated_at) VALUES (?,?,?,?,?,?,?,?)', commandId, deviceId, value.type, JSON.stringify(value.args), iso(now), iso(now + value.ttlSec * 1000), 'queued', iso(now)).run();
  return { id: commandId, ...value, status: 'queued', expiresAt: iso(now + value.ttlSec * 1000) };
}
export async function commandHistory(env, deviceId) { id(deviceId); return (await stmt(env.DB, 'SELECT command_id AS id,type,status,created_at,expires_at,updated_at,result_json FROM commands WHERE device_id=? ORDER BY created_at DESC LIMIT 100', deviceId).all()).results.map(c => ({ ...c, result: c.result_json ? JSON.parse(c.result_json) : null, result_json: undefined })); }
export async function registerDevice(env, body) {
  const deviceId = id(body.deviceId), label = typeof body.label === 'string' ? body.label.slice(0, 80) : deviceId;
  if (typeof body.token !== 'string' || !/^[a-f0-9]{64}$/.test(body.token)) throw new ApiError(400, 'invalid_device_token', 'Use a random 32-byte token encoded as 64 lowercase hex characters');
  const hash = await sha256(body.token), now = iso(Date.now()), settings = JSON.stringify(DEFAULT_CONFIG);
  try { await env.DB.batch([stmt(env.DB, 'INSERT INTO devices(device_id,label,token_hash,desired_config_json) VALUES (?,?,?,?)', deviceId, label, hash, settings), stmt(env.DB, 'INSERT INTO config_history(device_id,revision,settings_json,created_at) VALUES (?,?,?,?)', deviceId, 1, settings, now)]); }
  catch(e) { if (String(e).includes('UNIQUE')) throw new ApiError(409, 'device_exists', 'Device ID already exists'); throw e; }
  return { deviceId, label, desiredConfig: { revision: 1, settings: DEFAULT_CONFIG } };
}
