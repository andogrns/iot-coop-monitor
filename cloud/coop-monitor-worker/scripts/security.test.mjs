import assert from 'node:assert/strict';
import { test } from 'node:test';
import app from '../src/app.js';
import { makeSession, validSession, requireAdmin } from '../src/auth.js';
import { redact } from '../src/protocol.js';
import { createLoginThrottle } from '../src/login-throttle.js';
import { csvCell } from '../public/csv.js';
import { fixture, request, ownerToken, deviceToken, payload } from './backend-fixture.mjs';

test('sessions reject tampering, expiry and missing signing configuration', async () => {
  const now = Date.now(), secret = 'test-session-secret', session = await makeSession(secret, now);
  assert.equal(await validSession(session, secret, now), true);
  assert.equal(await validSession(session + 'x', secret, now), false);
  assert.equal(await validSession(session, 'wrong', now), false);
  assert.equal(await validSession(session, secret, now + 8 * 3600000), false);
  for (const invalid of [undefined, null, '', '   ']) {
    await assert.rejects(makeSession(invalid), e => e.status === 503);
    assert.equal(await validSession(session, invalid), false);
  }
});

test('owner cookie permits reads and same-origin writes, rejects foreign writes', async t => {
  const { env } = await fixture(t), cookie = 'coop_session=' + await makeSession(env.SESSION_SECRET);
  await requireAdmin(request('/api/snapshot', { token: null, headers: { cookie } }), env);
  await requireAdmin(request('/auth/logout', { method: 'POST', token: null, headers: { cookie, origin: 'https://audit.example' } }), env);
  for (const origin of ['', 'https://foreign.example']) await assert.rejects(
    requireAdmin(request('/auth/logout', { method: 'POST', token: null, headers: { cookie, origin } }), env), e => e.status === 403);
  await requireAdmin(request('/auth/logout', { method: 'POST' }), env);
});

test('all private read routes and archives reject anonymous and device bearer access', async t => {
  const { env } = await fixture(t);
  for (const path of ['/api/snapshot', '/api/history', '/api/logs', '/api/export', '/api/archives', '/api/archive?key=anything', '/api/devices/audit-device/commands']) {
    for (const token of [null, deviceToken]) assert.equal((await app.fetch(request(path, { token }), env)).status, 401, path);
  }
  assert.equal((await app.fetch(request('/api/device/exchange', { method: 'POST', value: payload() }), env)).status, 401);
});

test('login cookies are secure and missing secret fails closed without issuing one', async t => {
  const { env } = await fixture(t), options = { method: 'POST', token: null, value: { key: ownerToken }, headers: { origin: 'https://audit.example', 'cf-connecting-ip': 'login-fixture' } };
  const response = await app.fetch(request('/auth/login', options), env);
  assert.equal(response.status, 200);
  for (const attribute of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Max-Age=28800']) assert.ok(response.headers.get('set-cookie').includes(attribute));
  delete env.SESSION_SECRET;
  const failed = await app.fetch(request('/auth/login', options), env);
  assert.equal(failed.status, 503); assert.equal(failed.headers.get('set-cookie'), null);
});

test('login throttle preserves blocked IPs under churn and reclaims only expired entries', () => {
  const throttle = createLoginThrottle({ maxEntries: 3, limit: 2, windowMs: 100 });
  throttle('a', 0); throttle('a', 1); throttle('b', 2); throttle('c', 3);
  assert.throws(() => throttle('a', 4), e => e.status === 429);
  assert.throws(() => throttle('d', 4), e => e.status === 429);
  assert.throws(() => throttle('a', 5), e => e.status === 429);
  throttle('d', 101);
  assert.throws(() => throttle('a', 101), e => e.status === 429);
  assert.throws(() => throttle('e', 101), e => e.status === 429);
  throttle('a', 104); throttle('e', 104);
});

test('malformed owner JSON receives client errors rather than backend failures', async t => {
  const { env } = await fixture(t);
  for (const [path, method] of [['/api/devices', 'POST'], ['/api/devices/audit-device/config', 'PUT'], ['/api/devices/audit-device/uploads', 'PUT'], ['/api/devices/audit-device/commands', 'POST']]) {
    for (const value of [null, [], 1, true, 'text']) assert.equal((await app.fetch(request(path, { method, value }), env)).status, 400);
  }
  assert.equal((await app.fetch(request('/api/devices', { method: 'POST', raw: '{' }), env)).status, 400);
  assert.equal((await app.fetch(request('/api/devices', { method: 'POST', value: {}, headers: { 'content-type': 'application/jsonjunk' } }), env)).status, 415);
  assert.equal((await app.fetch(request('/api/devices', { method: 'POST', value: {}, headers: { 'content-type': 'Application/JSON; charset=utf-8' } }), env)).status, 400);
});

test('body size enforcement covers absent and misleading Content-Length', async t => {
  const { env } = await fixture(t);
  for (const headers of [{}, { 'content-length': '10' }, { 'content-length': '70000' }]) {
    const response = await app.fetch(request('/api/devices', { method: 'POST', raw: JSON.stringify({ label: 'x'.repeat(66000) }), headers }), env);
    assert.equal(response.status, 413);
  }
});

test('redaction removes authorization schemes, quoted and multiword secret values', () => {
  for (const [message, hidden] of [
    ['Authorization: Bearer abc_DEF-123', ['abc_DEF-123']],
    ['Authorization: Basic dXNlcjpwYXNz', ['dXNlcjpwYXNz']],
    ['password="two word secret"; status=ok', ['two word secret']],
    ['{"ssid":"Private Coop Network","token":"abc.def"}', ['Private', 'Coop', 'Network', 'abc.def']],
    ["password='hello world'; ready", ['hello', 'world']],
    ['ssid=Private Coop Network, ready', ['Private', 'Coop', 'Network']],
    ['token=' + deviceToken, [deviceToken]],
  ]) { const result = redact(message); for (const value of hidden) assert.ok(!result.includes(value), result); assert.ok(result.includes('[redacted]')); }
  assert.equal(redact('MQ input=580 mV; calibration completed'), 'MQ input=580 mV; calibration completed');
  assert.equal(redact('x'.repeat(700)).length, 512);
});

test('unexpected thrown values never disclose provider/request details or break error handling', async t => {
  const { env } = await fixture(t), output = [];
  t.mock.method(console, 'error', (...args) => output.push(args.join(' ')));
  for (const thrown of [new Error('private-provider-detail'), null, 'private-provider-detail']) {
    env.DB.prepare = () => { throw thrown; };
    const response = await app.fetch(request('/health', { token: null }), env);
    assert.equal(response.status, 503); assert.ok(!(await response.text()).includes('private-provider-detail'));
  }
  assert.deepEqual(output, ['request_failed', 'request_failed', 'request_failed']);
});

test('log cursor rejects oversized and malformed values before querying D1', async t => {
  const { env, queries } = await fixture(t);
  for (const cursor of ['x'.repeat(257), btoa(JSON.stringify([123, 'boot', 1])), btoa(JSON.stringify([new Date().toISOString(), 'boot', -1]))]) {
    queries.length = 0;
    const response = await app.fetch(request('/api/logs?cursor=' + encodeURIComponent(cursor)), env);
    assert.equal(response.status, 400); assert.equal(queries.length, 0);
  }
});

test('dashboard assets retain CSP, no-sniff and referrer protection', async t => {
  const { env } = await fixture(t), response = await app.fetch(request('/', { token: null }), env);
  assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
});

test('shared CSV encoder neutralizes formula text and preserves numeric measurements', () => {
  for (const value of ['=1+1', '+1', '-1', '@SUM(A1)', ' \t=1+1', '\r=1+1', '\n=1+1', '＝1+1', '＋1', '－1', '＠SUM(A1)']) {
    assert.ok(csvCell(value).startsWith('"\''));
  }
  assert.equal(csvCell(-2.5), '"-2.5"'); assert.equal(csvCell(null), '""');
  assert.equal(csvCell('OK'), '"OK"'); assert.equal(csvCell('a,"b"'), '"a,""b"""');
});

test('authenticated CSV export uses the shared encoder without modifying stored status', async t => {
  const { env } = await fixture(t), value = payload(), status = ' \t=HYPERLINK("https://example.invalid")';
  value.readings[0].status = status;
  assert.equal((await app.fetch(request('/api/device/exchange', { method: 'POST', value, token: deviceToken }), env)).status, 200);
  const response = await app.fetch(request('/api/export?deviceId=audit-device'), env);
  assert.equal(response.status, 200); assert.ok((await response.text()).includes(csvCell(status)));
  const history = await (await app.fetch(request('/api/history?deviceId=audit-device'), env)).json();
  assert.equal(history.readings[0].status, status);
});
