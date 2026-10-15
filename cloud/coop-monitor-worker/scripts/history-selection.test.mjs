import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHistorySelection } from '../public/history-selection.js';
import app from '../src/app.js';
import { history, blockKey } from '../src/storage.js';
import { packSample } from '../src/protocol.js';
import { fixture, deviceId, reading, request } from './backend-fixture.mjs';

function ui(t, api = async () => ({ count: 1200 })) {
  const previous = globalThis.document;
  const elements = Object.fromEntries(['from', 'to', 'history-selection-count'].map(id => [id, {
    value: '', textContent: '', listeners: {}, addEventListener(type, handler) { this.listeners[type] = handler; },
  }]));
  elements.from.value = '2026-10-13T10:00'; elements.to.value = '2026-10-13T11:00';
  globalThis.document = { getElementById: id => elements[id] };
  let device = 'coop';
  const controller = createHistorySelection({ api, deviceId: () => device });
  t.after(() => { controller.reset(); globalThis.document = previous; });
  return { elements, controller, setDevice(value) { device = value; }, text: () => elements['history-selection-count'].textContent };
}

test('counts the entire local date range, including singular and empty selections', async t => {
  let count = 1200; const paths = [];
  const f = ui(t, async path => { paths.push(path); return { count }; });
  await f.controller.countSelection(); assert.equal(f.text(), `${(1200).toLocaleString()} data entries selected.`);
  const url = new URL('https://test' + paths[0]);
  assert.equal(url.pathname, '/api/archives/selection'); assert.equal(url.searchParams.get('deviceId'), 'coop');
  assert.equal(url.searchParams.get('from'), new Date(f.elements.from.value).toISOString());
  assert.equal(url.searchParams.get('to'), new Date(f.elements.to.value).toISOString());
  count = 1; await f.controller.countSelection(); assert.equal(f.text(), '1 data entry selected.');
  count = 0; await f.controller.countSelection(); assert.equal(f.text(), '0 data entries selected — no readings in this range.');
});

test('invalid, missing and overlong ranges clear the previous count without a request', async t => {
  let calls = 0; const f = ui(t, async () => { calls++; return { count: 8 }; });
  await f.controller.countSelection();
  for (const [from, to] of [['', '2026-10-13T11:00'], ['2026-10-13T12:00', '2026-10-13T11:00'], ['2026-10-13T11:00', '2026-10-13T11:00'], ['2026-09-01T00:00', '2026-10-13T00:00']]) {
    f.elements.from.value = from; f.elements.to.value = to;
    await f.controller.countSelection(); assert.match(f.text(), /valid From \/ To range up to 31 days/);
  }
  assert.equal(calls, 1);
  f.elements.from.value = '2026-10-01T00:00'; f.elements.to.value = '2026-11-01T00:00';
  await f.controller.countSelection(); assert.equal(calls, 2);
  f.setDevice(''); await f.controller.countSelection(); assert.match(f.text(), /Choose a device/); assert.equal(calls, 2);
});

test('date edits invalidate immediately and debounce both inputs into one count', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0; const f = ui(t, async () => { calls++; return { count: 9 }; });
  await f.controller.countSelection();
  f.elements.from.listeners.input(); assert.equal(f.text(), 'Counting selected entries…');
  t.mock.timers.tick(200); f.elements.to.listeners.input(); t.mock.timers.tick(299); assert.equal(calls, 1);
  t.mock.timers.tick(1); await Promise.resolve(); assert.equal(calls, 2); assert.equal(f.text(), '9 data entries selected.');
});

test('older successes and failures cannot overwrite counts after date/device changes', async t => {
  const pending = [];
  const f = ui(t, () => new Promise((resolve, reject) => pending.push({ resolve, reject })));
  const old = f.controller.countSelection();
  f.elements.from.value = '2026-10-13T10:15'; const current = f.controller.countSelection();
  pending[1].resolve({ count: 4 }); await current;
  pending[0].resolve({ count: 99 }); await old; assert.equal(f.text(), '4 data entries selected.');
  const oldFailure = f.controller.countSelection(); f.setDevice('other'); const newer = f.controller.countSelection();
  pending[3].resolve({ count: 0 }); await newer;
  pending[2].reject(Error('old failure')); await oldFailure; assert.match(f.text(), /0 data entries/);
});

test('reset cancels a scheduled count and suppresses an in-flight response', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let resolve, calls = 0; const f = ui(t, () => { calls++; return new Promise(r => resolve = r); });
  f.elements.from.listeners.input(); f.controller.reset(); t.mock.timers.tick(300); assert.equal(calls, 0);
  const pending = f.controller.countSelection(); f.controller.reset(); resolve({ count: 12 }); await pending;
  assert.equal(f.text(), 'Choose a range to count selected entries.');
});

test('failed or invalid responses replace an old count and a retry recovers', async t => {
  let response = 3;
  const f = ui(t, async () => { if (response === 'fail') throw Error('Count unavailable'); return { count: response }; });
  await f.controller.countSelection(); response = 'fail'; await f.controller.countSelection(); assert.equal(f.text(), 'Count unavailable');
  response = -1; await f.controller.countSelection(); assert.match(f.text(), /Could not count/);
  response = 2; await f.controller.countSelection(); assert.equal(f.text(), '2 data entries selected.');
});

test('shared selection count equals complete History in both orders beyond one page and stays read-only/private', async t => {
  const { env, db, queries } = await fixture(t), anchor = Date.parse('2026-10-13T00:00:00Z');
  for (let n = 0; n < 40; n++) {
    const samples = Array.from({ length: 30 }, (_, i) => ({ ...reading(n * 30 + i + 1, n * 60000 + i * 2000), sampledAt: '2026-10-01T00:00:00Z' }));
    db.prepare('INSERT INTO reading_windows(device_id,block_id,boot_id,anchor_ms,data_json,state_json,received_at,revision) VALUES (?,?,?,?,?,?,?,1)')
      .run(deviceId, blockKey(anchor, n * 60000, 'count-boot'), 'count-boot', anchor, JSON.stringify(samples.map(packSample)), '{}', new Date(anchor).toISOString());
  }
  // Endpoints select exactly 301 tuples despite the unrelated device UTC dates.
  const params = { deviceId, from: new Date(anchor + 10000).toISOString(), to: new Date(anchor + 610000).toISOString() };
  queries.length = 0;
  const selectionResponse = await app.fetch(request('/api/archives/selection?' + new URLSearchParams(params)), env);
  assert.equal(selectionResponse.status, 200); const selection = await selectionResponse.json(); assert.equal(selection.count, 301);
  assert.ok(queries.every(q => /^SELECT/i.test(q.trim())));
  for (const order of ['desc', 'asc']) {
    let cursor, loaded = [];
    do {
      const page = await history(env, new URL('https://test/api/history?' + new URLSearchParams({ ...params, order, pageSize: '50', ...(cursor ? { cursor } : {}) })));
      if (!cursor) assert.equal(page.readings.length, 50);
      loaded.push(...page.readings); cursor = page.nextCursor;
    } while (cursor);
    assert.equal(loaded.length, selection.count); assert.equal(new Set(loaded.map(r => r.seq)).size, 301);
  }
  assert.equal((await app.fetch(request('/api/archives/selection?' + new URLSearchParams(params), { token: null }), env)).status, 401);
  const empty = { ...params, from: new Date(anchor - 20000).toISOString(), to: new Date(anchor - 10000).toISOString() };
  assert.equal((await (await app.fetch(request('/api/archives/selection?' + new URLSearchParams(empty)), env)).json()).count, 0);
});
