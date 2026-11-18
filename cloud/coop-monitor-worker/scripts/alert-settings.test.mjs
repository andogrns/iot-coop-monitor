// Dashboard-editable gas-warning alerts: settings API, templates, wait time, reminders, end message, mentions,
// channel choice, test messages and the recorded delivery result. Local fixture only; Discord is stubbed.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture, deviceId, request } from './backend-fixture.mjs';
import { blockKey } from '../src/storage.js';
import { gasAlerts } from '../src/gas-alerts.js';
import { deviceAlerts } from '../src/device-alerts.js';
import { alertOverview, loadAlertSettings, saveAlertSettings, sendTestAlert } from '../src/notify.js';
import { DISCORD_MAX, SCOPE_FOOTER, buildMessage, checkAlertSettings, defaultAlertSettings, durationText, elapsedText, messageVariables, unknownVariables } from '../public/alert-settings.js';
import app from '../src/app.js';

const MIN = 60000, NOW = Date.UTC(2026, 10, 18, 12, 0, 0);
const tuple = (seq, uptimeMs, status) => [seq, uptimeMs, null, 900, 812, 1.21, 760, 28, 70, 28.4, 1008, status, 1, 1];
function seed(db, fromMin, toMin, statusFor) {
  const anchor = NOW - 6 * 3600000;
  for (let m = fromMin, seq = 1; m >= toMin; m--, seq++) {
    const uptime = NOW - m * MIN - anchor;
    db.prepare('INSERT INTO reading_windows(device_id,block_id,boot_id,anchor_ms,data_json,received_at,revision) VALUES (?,?,?,?,?,?,1)')
      .run(deviceId, blockKey(anchor, uptime, 'boot'), 'boot', anchor, JSON.stringify([tuple(seq, uptime, statusFor(m))]), new Date(NOW).toISOString());
  }
}
function discordStub({ status = 200, guilds = [{ id: '42' }] } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? 'GET', body: init.body ? JSON.parse(init.body) : null });
    if (status !== 200) return new Response('{}', { status });
    if (url.endsWith('/users/@me/guilds')) return Response.json(guilds);
    if (url.endsWith('/guilds/42')) return Response.json({ id: '42', system_channel_id: '555' });
    return Response.json({ id: 'msg' });
  };
  return { calls, fetchImpl, posts: () => calls.filter(c => c.method === 'POST') };
}
const WARN = 'GAS_WARNING', OK = 'OK';
const withToken = env => ({ ...env, DISCORD_BOT_TOKEN: 'test-token' });
const run = (env, stub, now = NOW) => gasAlerts(withToken(env), { fetchImpl: stub.fetchImpl, now });
const settings = (changes = {}) => ({ ...defaultAlertSettings(), ...changes });
async function save(env, changes, expectedRevision = 0) { return saveAlertSettings(env, { expectedRevision, settings: settings(changes) }, NOW); }
const delivery = db => JSON.parse(db.prepare("SELECT value_json FROM system_state WHERE key='alert_delivery'").get()?.value_json ?? 'null');

test('templates: variables, unknown names, durations and the fixed scope footer', () => {
  assert.deepEqual(unknownVariables('{device} {gas_mv} {ppm} {ppm}'), ['ppm']);
  assert.equal(durationText(45), '45 minutes'); assert.equal(durationText(60), '1 hour'); assert.equal(durationText(90), '1 h 30 min'); assert.equal(durationText(120), '2 hours');
  assert.equal(elapsedText(59 * MIN + 59000), '59 min'); assert.equal(elapsedText(65 * MIN), '1 h 5 min'); assert.equal(elapsedText(180 * MIN), '3 h');
  const vars = messageVariables({ device: { device_id: 'coop-1', label: 'Coop' }, reading: { time: NOW, mqMv: 811.6, mqThresholdMv: 760, mqRatio: 1.214, ahtTemperatureC: 28.44, humidityPct: 70.2, status: 'GAS_WARNING' }, since: NOW - 65 * MIN, afterMinutes: 60, now: NOW });
  assert.equal(buildMessage('{device}: {gas_mv} / {threshold_mv} ({ratio}), {temperature}, {humidity}, {elapsed}, {duration}, {status}, {nope}', vars),
    `Coop (coop-1): 812 mV / 760 mV (1.21×), 28.4 °C, 70 %, 1 h 5 min, 1 hour, GAS_WARNING, {nope}\n${SCOPE_FOOTER}`);
  assert.equal(vars.since, `<t:${(NOW - 65 * MIN) / 1000}:f>`);
  assert.match(buildMessage('x', vars, { mention: 'everyone' }), /^@everyone x\n/);
  const long = buildMessage('a'.repeat(1500) + '{device}'.repeat(100), vars, { mention: 'here', test: true });
  assert.ok(long.length <= DISCORD_MAX && long.endsWith(SCOPE_FOOTER) && long.includes('…'));
});

test('settings validation reports each bad field', () => {
  const { errors } = checkAlertSettings(settings({ discordChannelId: '12ab', afterMinutes: 2, remindEveryMinutes: 7, mention: 'all', warningTemplate: ' ', endedTemplate: 'x{bad}', channel: 'sms' }));
  assert.deepEqual(Object.keys(errors).sort(), ['afterMinutes', 'channel', 'discordChannelId', 'endedTemplate', 'mention', 'remindEveryMinutes', 'warningTemplate']);
  assert.match(errors.endedTemplate, /\{bad\}/);
  // The end message may be empty only while it is switched off; channel IDs are trimmed.
  assert.ok(checkAlertSettings(settings({ sendEnded: false, endedTemplate: '' })).settings);
  assert.equal(checkAlertSettings(settings({ discordChannelId: ' 123456789012345678 ' })).settings.discordChannelId, '123456789012345678');
  assert.match(checkAlertSettings({ ...settings(), extra: 1 }).errors.settings, /Unknown alert setting extra/);
});

test('API: defaults until saved, owner-only, revision conflicts rejected, invalid settings rejected', async t => {
  const { env } = await fixture(t);
  const get = async () => (await app.fetch(request('/api/alerts'), env)).json();
  assert.equal((await app.fetch(request('/api/alerts', { token: null }), env)).status, 401);
  const first = await get();
  assert.equal(first.revision, 0); assert.equal(first.settings.afterMinutes, 60); assert.equal(first.channels[0].connected, false);
  assert.equal(first.checkEveryMinutes, 5); assert.ok(first.variables.some(v => v.name === 'gas_mv'));
  const put = value => app.fetch(request('/api/alerts', { method: 'PUT', value }), env);
  assert.equal((await put({ expectedRevision: 0, settings: settings({ afterMinutes: 30 }) })).status, 200);
  assert.equal((await get()).settings.afterMinutes, 30);
  const stale = await put({ expectedRevision: 0, settings: settings({ afterMinutes: 45 }) });
  assert.equal(stale.status, 409); assert.equal((await stale.json()).error, 'alert_settings_changed');
  const bad = await put({ expectedRevision: 1, settings: settings({ afterMinutes: 1 }) });
  assert.equal(bad.status, 400); assert.match((await bad.json()).message, /5 to 720/);
  assert.equal((await put({ expectedRevision: 1, settings: settings({ afterMinutes: 45 }) })).status, 200);
  assert.deepEqual([(await get()).revision, (await get()).settings.afterMinutes], [2, 45]);
});

test('the saved wait time and template drive the alert', async t => {
  const { env, db } = await fixture(t); seed(db, 60, 0, m => m <= 31 ? WARN : OK);
  const stub = discordStub();
  assert.equal((await run(env, stub)).results[0].reason, 'warning_under_threshold'); // default 60 minutes
  await save(env, { afterMinutes: 30, warningTemplate: 'Coop gas {gas_mv} for {elapsed} on {device}' });
  assert.equal((await run(env, stub)).results[0].action, 'notify');
  assert.equal(stub.posts()[0].body.content, `Coop gas 812 mV for 31 min on Local audit fixture (audit-device)\n${SCOPE_FOOTER}`);
  assert.deepEqual(stub.posts()[0].body.allowed_mentions, { parse: [] });
});

test('alerts switched off: nothing is read or sent', async t => {
  const { env, db } = await fixture(t); seed(db, 90, 0, () => WARN);
  await save(env, { enabled: false });
  const stub = discordStub();
  assert.equal((await run(env, stub)).status, 'disabled');
  assert.equal(stub.calls.length, 0);
});

test('reminders repeat while the warning continues; the end message can be switched off', async t => {
  const { env, db } = await fixture(t); seed(db, 70, 0, () => WARN);
  await save(env, { remindEveryMinutes: 30, sendEnded: false });
  const stub = discordStub();
  assert.equal((await run(env, stub)).results[0].action, 'notify');
  seed(db, -1, -25, () => WARN);
  assert.equal((await run(env, stub, NOW + 25 * MIN)).results[0].reason, 'already_notified');
  seed(db, -26, -30, () => WARN);
  // A run a few seconds early still sends the due reminder.
  assert.equal((await run(env, stub, NOW + 30 * MIN - 5000)).results[0].action, 'remind');
  assert.match(stub.posts()[1].body.content, /ongoing for 1 h 40 min/);
  assert.equal((await run(env, stub, NOW + 35 * MIN)).results[0].reason, 'already_notified');
  seed(db, -31, -36, () => OK);
  assert.equal((await run(env, stub, NOW + 36 * MIN)).results[0].action, 'clear');
  assert.equal(stub.posts().length, 2); // no end message
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM system_state WHERE key LIKE 'gas_alert:%'").get().n, 0);
});

test('mentions ping only on warning messages; the end message and channel ID come from the settings', async t => {
  const { env, db } = await fixture(t); seed(db, 70, 0, () => WARN);
  await save(env, { mention: 'everyone', discordChannelId: '123456789012345678', endedTemplate: 'Ended {device} {status}' });
  const stub = discordStub();
  await run(env, stub);
  const [warning] = stub.posts();
  assert.match(warning.url, /\/channels\/123456789012345678\/messages$/);
  assert.match(warning.body.content, /^@everyone ⚠️/);
  assert.deepEqual(warning.body.allowed_mentions, { parse: ['everyone'] });
  assert.ok(!stub.calls.some(c => c.url.includes('/guilds')));
  seed(db, -1, -5, () => OK);
  await run(env, stub, NOW + 5 * MIN);
  assert.equal(stub.posts()[1].body.content, `Ended Local audit fixture (audit-device) OK\n${SCOPE_FOOTER}`);
  assert.deepEqual(stub.posts()[1].body.allowed_mentions, { parse: [] });
});

test('delivery results are recorded once per distinct failure and cleared by a success', async t => {
  const { env, db } = await fixture(t); seed(db, 70, 0, () => WARN);
  const writes = () => db.prepare("SELECT updated_at FROM system_state WHERE key='alert_delivery'").get()?.updated_at;
  await run(env, discordStub({ status: 403 }));
  assert.equal(delivery(db).lastError.code, 'discord_403');
  const firstWrite = writes();
  await run(env, discordStub({ status: 403 }), NOW + 5 * MIN);
  assert.equal(writes(), firstWrite);
  const overview = await alertOverview(withToken(env));
  assert.match(overview.delivery.lastError.message, /not allowed to post/);
  assert.equal(overview.channels[0].connected, true);
  await run(env, discordStub(), NOW + 6 * MIN);
  assert.equal(delivery(db).lastError, null); assert.equal(delivery(db).lastKind, 'warning');
});

test('test message: unsaved settings, latest reading, marked as a test, never pings', async t => {
  const { env, db } = await fixture(t); seed(db, 3, 0, () => OK);
  const stub = discordStub();
  const result = await sendTestAlert(withToken(env), { kind: 'warning', deviceId, settings: settings({ mention: 'here', warningTemplate: 'Gas {gas_mv} at {device}' }) }, { fetchImpl: stub.fetchImpl, now: NOW });
  assert.deepEqual(result, { sent: true, channel: 'discord', channelId: '555', usedReading: true });
  const [post] = stub.posts();
  assert.match(post.body.content, /^🧪 \*\*Test message from the dashboard\.\*\*.*\n@here Gas 812 mV at Local audit fixture/);
  assert.deepEqual(post.body.allowed_mentions, { parse: [] });
  assert.equal(delivery(db).lastKind, 'test');
  assert.equal((await loadAlertSettings(env)).revision, 0); // nothing saved
  await assert.rejects(sendTestAlert(withToken(env), { kind: 'warning', settings: settings() }, { fetchImpl: discordStub({ guilds: [] }).fetchImpl, now: NOW }),
    e => e.status === 502 && /not in any Discord server/.test(e.message));
  await assert.rejects(sendTestAlert(withToken(env), { kind: 'nope', settings: settings() }), e => e.status === 400);
  // Route without a bot token fails before any network call.
  const response = await app.fetch(request('/api/alerts/test', { method: 'POST', value: { kind: 'ended', settings: settings() } }), env);
  assert.equal(response.status, 502); assert.match((await response.json()).message, /DISCORD_BOT_TOKEN/);
});

test('offline alerts use the chosen channel and never mention', async t => {
  const { env, db } = await fixture(t);
  await save(env, { mention: 'everyone', discordChannelId: '123456789012345678' });
  const state = { receivedAt: new Date(NOW - 30 * MIN).toISOString(), bootId: 'boot', status: 'OK', health: {} };
  db.prepare('INSERT INTO reading_windows(device_id,block_id,boot_id,anchor_ms,data_json,state_json,received_at,revision) VALUES (?,?,?,?,?,?,?,1)')
    .run(deviceId, blockKey(NOW - 3600000, 0, 'boot'), 'boot', NOW - 3600000, '[]', JSON.stringify(state), state.receivedAt);
  const stub = discordStub();
  assert.equal((await deviceAlerts(withToken(env), { fetchImpl: stub.fetchImpl, now: NOW })).results[0].action, 'offline');
  assert.match(stub.posts()[0].url, /\/channels\/123456789012345678\/messages$/);
  assert.doesNotMatch(stub.posts()[0].body.content, /@everyone/);
  assert.deepEqual(stub.posts()[0].body.allowed_mentions, { parse: [] });
});
