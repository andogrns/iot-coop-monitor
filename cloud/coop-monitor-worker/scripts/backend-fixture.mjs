// Local-only D1-shaped SQLite and in-memory R2 adapters. Never read credentials.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { registerDevice } from '../src/storage.js';

export const deviceToken = 'a'.repeat(64), ownerToken = 'b'.repeat(64);
export const deviceId = 'audit-device', bootId = 'audit-boot';
export const reading = (seq = 1, uptimeMs = 10000) => ({ seq, uptimeMs, sampledAt: null,
  mqRaw: 720, mqMv: 580, mqRatio: 1.04, mqThresholdMv: 650, ahtTemperatureC: 28.2,
  humidityPct: 65.1, bmpTemperatureC: 28.4, pressureHpa: 1008.6, status: 'OK',
  configRevision: 1, calibrationRevision: 1234567890 });
export const payload = (overrides = {}) => ({ protocolVersion: 1, deviceId, bootId,
  state: { uptimeMs: 10000, firmwareVersion: 'cloudflare-1.0.1', appliedConfigRevision: 1,
    configStatus: 'applied', status: 'OK', calibrated: true,
    calibration: { revision: 1234567890, baselineMv: 550, thresholdMv: 650, sdMv: 5,
      samples: 150, temperatureC: 28.2, humidityPct: 65.1 } },
  readings: [reading()], logs: [], commandResults: [], ...overrides });

export async function fixture(t) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec('PRAGMA foreign_keys=ON');
  for (const file of ['0001_create_devices.sql', '0002_backend.sql', '0003_archive_catalog_index.sql', '0004_manual_archives.sql']) {
    db.exec(readFileSync(new URL('../migrations/' + file, import.meta.url), 'utf8'));
  }
  const queries = [], objects = new Map(), hooks = {};
  const execute = (sql, values) => {
    queries.push(sql); hooks.beforeQuery?.(sql, values);
    const prepared = db.prepare(sql), isRead = /^(SELECT|WITH|PRAGMA)\b/i.test(sql.trim());
    const results = isRead ? prepared.all(...values) : [];
    const changes = isRead ? 0 : Number(prepared.run(...values).changes);
    return { results, success: true, meta: { changes, rows_read: results.length, rows_written: changes, size_after: 4096 } };
  };
  const statement = (sql, values = []) => ({
    sql, values, bind(...v) { return statement(sql, v); },
    async first() { return execute(sql, values).results[0] ?? null; },
    async all() { return execute(sql, values); }, async run() { return execute(sql, values); },
  });
  const DB = { prepare: statement, withSession() { return this; }, async batch(statements) {
    hooks.beforeBatch?.(statements);
    db.exec('BEGIN');
    try { const results = statements.map(s => execute(s.sql, s.values)); db.exec('COMMIT'); return results; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  } };
  const env = { DB, ADMIN_TOKEN: ownerToken, SESSION_SECRET: 'local-audit-session-secret', RETENTION_DAYS: '30',
    ASSETS: { async fetch() { return new Response('<html>fixture</html>', { headers: { 'content-type': 'text/html' } }); } },
    ARCHIVES: {
      async put(key, bytes) { hooks.beforePut?.(); objects.set(key, new Uint8Array(bytes)); },
      async get(key) { hooks.beforeGet?.(); const bytes = objects.get(key); if (!bytes) return null;
        const value = hooks.corruptReadback ? new Uint8Array([0]) : bytes;
        return { body: value, async arrayBuffer() { return value.slice().buffer; } }; },
    } };
  await registerDevice(env, { deviceId, label: 'Local audit fixture', token: deviceToken });
  db.prepare('INSERT INTO system_state VALUES (?,?,?)').run('capacity', JSON.stringify({ databaseBytes: 4096, archiveBytes: 0, uploadRequests: 0, estimatedD1Writes: 0 }), new Date().toISOString());
  return { db, env, queries, objects, hooks };
}

export function request(path, { method = 'GET', value, token = ownerToken, headers = {}, raw } = {}) {
  return new Request('https://audit.example' + path, { method,
    headers: { ...(token ? { authorization: 'Bearer ' + token } : {}),
      ...(value !== undefined || raw !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
    ...(value !== undefined || raw !== undefined ? { body: raw ?? JSON.stringify(value) } : {}) });
}
