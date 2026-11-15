import assert from 'node:assert/strict';
import { test } from 'node:test';
import app from '../src/app.js';
import { snapshot } from '../src/storage.js';
import { sanitizeHealth } from '../src/protocol.js';
import { deviceAlerts, evaluateOffline, offlineAfterMs } from '../src/device-alerts.js';
import { fixture, request, deviceToken, bootId, payload } from './backend-fixture.mjs';

const MIN = 60000;
const HEALTH = { resetReason: 'brownout', rssiDbm: -67, wifiReconnects: 2, uploadFailures: 1, queuePending: 12, freeHeap: 150000, minFreeHeap: 98000, largestFreeBlock: 81920,
  aht: { ok: true, recovered: 1, failed: 0 }, bmp: { ok: false, recovered: 0, failed: 3 },
  sd: { state: 'ok', fileBytes: 10240, flushes: 2, flushFailures: 0, verifyFailures: 0, bufferedBytes: 300, droppedRecords: 0, lastFlushAgeSec: 40 } };

async function post(env, value) {
  const response = await app.fetch(request('/api/device/exchange', { method: 'POST', token: deviceToken, value }), env);
  return { status: response.status, value: await response.json() };
}
const withHealth = (health, extra = {}) => { const p = payload(extra); p.state = { ...p.state, health }; return p; };
const latestState = db => JSON.parse(db.prepare('SELECT state_json FROM reading_windows WHERE state_json IS NOT NULL ORDER BY block_id DESC LIMIT 1').get().state_json);

function discordStub() {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? 'GET', body: init.body ? JSON.parse(init.body) : null });
    if (url.endsWith('/users/@me/guilds')) return Response.json([{ id: '42' }]);
    if (url.endsWith('/guilds/42')) return Response.json({ id: '42', system_channel_id: '555' });
    return Response.json({ id: 'msg' });
  };
  return { fetchImpl, posts: () => calls.filter(c => c.method === 'POST').map(c => c.body.content) };
}

test('health summary is stored with device state', async t => {
  const { env, db } = await fixture(t);
  assert.equal((await post(env, withHealth(HEALTH))).status, 200);
  assert.deepEqual(latestState(db).health, HEALTH);
});

test('invalid health never rejects readings; bad fields are dropped', async t => {
  const { env, db } = await fixture(t);
  const bad = { resetReason: 'x'.repeat(400), rssiDbm: 20, wifiReconnects: -1, queuePending: 'many', minFreeHeap: 50000, extra: 'ignored', sd: { state: 'melted', flushes: 3 } };
  const result = await post(env, withHealth(bad));
  assert.equal(result.status, 200); assert.equal(result.value.acked.readings.length, 1);
  assert.deepEqual(latestState(db).health, { minFreeHeap: 50000, sd: { flushes: 3 } });
  assert.equal(sanitizeHealth('nope'), undefined); assert.equal(sanitizeHealth([]), undefined); assert.equal(sanitizeHealth({ junk: 1 }), undefined);
});

test('firmware without health is unchanged', async t => {
  const { env, db } = await fixture(t);
  assert.equal((await post(env, payload())).status, 200);
  assert.equal(latestState(db).health, undefined);
});

test('snapshot lists recent restarts with the firmware BOOT reason', async t => {
  const { env } = await fixture(t);
  const log = { seq: 1, uptimeMs: 9000, sampledAt: null, level: 'info', message: 'BOOT reset=brownout fw=cloudflare-1.1.0' };
  assert.equal((await post(env, withHealth(HEALTH, { logs: [log] }))).status, 200);
  const boots = (await snapshot(env)).devices[0].recentBoots;
  assert.equal(boots.length, 1); assert.equal(boots[0].bootId, bootId);
  assert.match(boots[0].message, /reset=brownout/);
});

test('offline decision', () => {
  const now = Date.UTC(2026, 10, 15, 12), after = 20 * MIN, state = { receivedAt: new Date(now - 25 * MIN).toISOString(), bootId: 'b1' };
  assert.equal(evaluateOffline(null, null, now, after).action, 'none');
  assert.equal(evaluateOffline(state, null, now, after).action, 'offline');
  assert.equal(evaluateOffline({ ...state, receivedAt: new Date(now - 10 * MIN).toISOString() }, null, now, after).action, 'none');
  assert.equal(evaluateOffline(state, { lastSeen: 0, bootId: 'b1' }, now, after).reason, 'still_offline');
  const back = evaluateOffline({ receivedAt: new Date(now - MIN).toISOString(), bootId: 'b2' }, { lastSeen: 0, bootId: 'b1' }, now, after);
  assert.deepEqual([back.action, back.restarted], ['online', true]);
  assert.equal(offlineAfterMs({}), 20 * MIN); assert.equal(offlineAfterMs({ OFFLINE_ALERT_AFTER_MINUTES: '3' }), 20 * MIN); assert.equal(offlineAfterMs({ OFFLINE_ALERT_AFTER_MINUTES: '30' }), 30 * MIN);
});

test('one offline message, no repeats, then one back-online message after a restart', async t => {
  const { env } = await fixture(t);
  const discord = discordStub(), run = now => deviceAlerts({ ...env, DISCORD_BOT_TOKEN: 't' }, { fetchImpl: discord.fetchImpl, now });
  assert.equal((await post(env, withHealth(HEALTH))).status, 200);
  await run(Date.now() + 5 * MIN); assert.equal(discord.posts().length, 0);
  await run(Date.now() + 25 * MIN); await run(Date.now() + 30 * MIN);
  assert.equal(discord.posts().length, 1); assert.match(discord.posts()[0], /No data from the coop monitor/); assert.match(discord.posts()[0], /-67 dBm/);
  const rebooted = withHealth({ ...HEALTH, resetReason: 'power_on' }, { bootId: 'second-boot' });
  assert.equal((await post(env, rebooted)).status, 200);
  await run(Date.now()); await run(Date.now() + MIN);
  assert.equal(discord.posts().length, 2);
  assert.match(discord.posts()[1], /back online/); assert.match(discord.posts()[1], /power-on/);
});

test('no offline alerts while the owner has paused uploads or Discord is unset', async t => {
  const { env, db } = await fixture(t);
  assert.equal((await post(env, payload())).status, 200);
  assert.equal((await deviceAlerts(env, { now: Date.now() + 60 * MIN, fetchImpl: () => assert.fail('no fetch') })).status, 'discord_not_configured');
  db.prepare('UPDATE devices SET writes_paused=1').run();
  const result = await deviceAlerts({ ...env, DISCORD_BOT_TOKEN: 't' }, { now: Date.now() + 60 * MIN, fetchImpl: () => assert.fail('no fetch') });
  assert.equal(result.results[0].reason, 'owner_pause');
});
