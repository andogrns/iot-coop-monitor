import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture, deviceId } from './backend-fixture.mjs';
import { blockKey } from '../src/storage.js';
import { gasAlerts, evaluate, discordChannel } from '../src/gas-alerts.js';
import worker from '../src/app.js';

const MIN = 60000, NOW = Date.UTC(2026, 10, 13, 12, 0, 0);
const tuple = (seq, uptimeMs, status) => [seq, uptimeMs, null, 900, 812, 1.21, 760, 28, 70, 28.4, 1008, status, 1, 1];
// One reading per minute from `fromMin` to `toMin` minutes before NOW (inclusive), status chosen per minute.
function seed(db, fromMin, toMin, statusFor) {
  const anchor = NOW - 6 * 3600000;
  for (let m = fromMin, seq = 1; m >= toMin; m--, seq++) {
    const uptime = NOW - m * MIN - anchor;
    db.prepare('INSERT INTO reading_windows(device_id,block_id,boot_id,anchor_ms,data_json,received_at,revision) VALUES (?,?,?,?,?,?,1)')
      .run(deviceId, blockKey(anchor, uptime, 'boot'), 'boot', anchor, JSON.stringify([tuple(seq, uptime, statusFor(m))]), new Date(NOW).toISOString());
  }
}
function discordStub({ fail = false, systemChannel = '555' } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? 'GET', body: init.body ? JSON.parse(init.body) : null, auth: init.headers?.authorization });
    if (fail) return new Response('{}', { status: 500 });
    if (url.endsWith('/users/@me/guilds')) return Response.json([{ id: '42' }]);
    if (url.endsWith('/guilds/42')) return Response.json({ id: '42', system_channel_id: systemChannel });
    if (url.endsWith('/guilds/42/channels')) return Response.json([{ id: '9', type: 2, position: 0 }, { id: '8', type: 0, position: 3 }, { id: '7', type: 0, position: 1 }]);
    return Response.json({ id: 'msg' });
  };
  return { calls, fetchImpl, posts: () => calls.filter(c => c.method === 'POST') };
}
const WARN = 'GAS_WARNING', OK = 'OK';
const run = (env, stub, now = NOW) => gasAlerts({ ...env, DISCORD_BOT_TOKEN: 'test-token' }, { fetchImpl: stub.fetchImpl, now });

test('does nothing when Discord is not configured', async t => {
  const { env, db } = await fixture(t); seed(db, 90, 0, () => WARN);
  assert.equal((await gasAlerts(env, { now: NOW, fetchImpl: () => assert.fail('no fetch') })).status, 'discord_not_configured');
});

test('no message while the warning is under one hour', async t => {
  const { env, db } = await fixture(t); seed(db, 90, 0, m => m <= 55 ? WARN : OK);
  const stub = discordStub();
  assert.equal((await run(env, stub)).results[0].reason, 'warning_under_threshold');
  assert.equal(stub.posts().length, 0);
});

test('one message after an hour of continuous warning, then none while it continues', async t => {
  const { env, db } = await fixture(t); seed(db, 90, 0, m => m <= 61 ? WARN : OK);
  const stub = discordStub();
  assert.equal((await run(env, stub)).results[0].action, 'notify');
  assert.equal(stub.posts().length, 1);
  const post = stub.posts()[0];
  assert.match(post.url, /\/channels\/555\/messages$/);
  assert.equal(post.auth, 'Bot test-token');
  assert.match(post.body.content, /Gas warning ongoing for 1 h 1 min/);
  assert.match(post.body.content, /not calibrated ammonia ppm/);
  assert.match(post.body.content, new RegExp(`<t:${Math.floor((NOW - 61 * MIN) / 1000)}:f>`));
  assert.deepEqual(post.body.allowed_mentions, { parse: [] });
  assert.equal((await run(env, stub, NOW + 5 * MIN)).results[0].reason, 'already_notified');
  // Long episodes stay one episode once the run reaches past the lookback window.
  seed(db, -1, -180, () => WARN);
  assert.equal((await run(env, stub, NOW + 180 * MIN)).results[0].reason, 'already_notified');
  assert.equal(stub.posts().length, 1);
});

test('a non-warning reading inside the hour breaks continuity', async t => {
  const { env, db } = await fixture(t); seed(db, 90, 0, m => m === 30 ? OK : WARN);
  const stub = discordStub();
  assert.equal((await run(env, stub)).results[0].action, 'none');
  assert.equal(stub.posts().length, 0);
});

test('clear message after a notified warning ends; a new hour notifies again', async t => {
  const { env, db } = await fixture(t); seed(db, 70, 0, () => WARN);
  const stub = discordStub();
  await run(env, stub);
  seed(db, -1, -5, () => OK);
  assert.equal((await run(env, stub, NOW + 5 * MIN)).results[0].action, 'clear');
  assert.match(stub.posts()[1].body.content, /no longer continuous/);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM system_state WHERE key LIKE 'gas_alert:%'").get().n, 0);
  seed(db, -6, -70, () => WARN);
  assert.equal((await run(env, stub, NOW + 70 * MIN)).results[0].action, 'notify');
  assert.equal(stub.posts().length, 3);
});

test('offline device (stale readings) neither notifies nor clears', async t => {
  const { env, db } = await fixture(t); seed(db, 120, 20, () => WARN);
  const stub = discordStub();
  assert.equal((await run(env, stub)).results[0].reason, 'no_recent_readings');
  assert.equal(stub.posts().length, 0);
});

test('a reading gap longer than ten minutes breaks continuity', async t => {
  const { env, db } = await fixture(t); seed(db, 80, 41, () => WARN); seed(db, 29, 0, () => WARN);
  const stub = discordStub();
  assert.equal((await run(env, stub)).results[0].reason, 'warning_under_threshold');
});

test('failed Discord delivery is retried on the next run', async t => {
  const { env, db } = await fixture(t); seed(db, 70, 0, () => WARN);
  const failing = discordStub({ fail: true });
  assert.equal((await run(env, failing)).results[0].action, 'failed');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM system_state WHERE key LIKE 'gas_alert:%'").get().n, 0);
  const ok = discordStub();
  assert.equal((await run(env, ok, NOW + 5 * MIN)).results[0].action, 'notify');
});

test('channel selection: explicit, system channel, then first text channel', async () => {
  assert.equal(await discordChannel({ DISCORD_CHANNEL_ID: '1' }, () => assert.fail('no fetch')), '1');
  assert.equal(await discordChannel({ DISCORD_BOT_TOKEN: 't' }, discordStub().fetchImpl), '555');
  assert.equal(await discordChannel({ DISCORD_BOT_TOKEN: 't' }, discordStub({ systemChannel: null }).fetchImpl), '7');
});

test('evaluate ignores empty data', () => {
  assert.equal(evaluate([], null, NOW, 3600000).reason, 'no_recent_readings');
});

test('scheduled handler routes the five-minute cron to alerts and others to maintenance', async () => {
  const seen = [];
  const env = { DB: { prepare(sql) { seen.push(sql); return { bind() { return this; }, async all() { return { results: [] }; }, async run() { return { meta: { changes: 0 } }; }, async first() { return null; } }; } } };
  const waits = []; const ctx = { waitUntil: p => waits.push(p.catch(() => {})) };
  worker.scheduled({ cron: '*/5 * * * *' }, { ...env, DISCORD_BOT_TOKEN: 't' }, ctx); await Promise.all(waits);
  assert.ok(seen.some(s => s.includes('FROM devices')) && !seen.some(s => s.includes('maintenance_leases')));
  seen.length = 0; waits.length = 0;
  worker.scheduled({ cron: '*/15 * * * *' }, env, ctx); await Promise.all(waits);
  assert.ok(seen.some(s => s.includes('maintenance_leases')));
});
