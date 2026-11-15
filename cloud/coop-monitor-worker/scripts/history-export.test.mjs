import assert from 'node:assert/strict';
import { test } from 'node:test';
import { exportReadingParts, createHistoryExport } from '../public/history-export.js';
import { fixture, deviceId, reading, request } from './backend-fixture.mjs';
import { blockKey } from '../src/storage.js';
import { packSample } from '../src/protocol.js';
import app from '../src/app.js';

const row = seq => ({ seq, value: seq / 10 });
function pages(total, pageSize = 713) {
  let offset = 0;
  return async path => {
    const params = new URL('https://test' + path).searchParams;
    assert.equal(params.get('cursor'), offset ? String(offset) : null);
    const readings = Array.from({ length: Math.min(pageSize, total - offset) }, (_, n) => row(offset + n));
    offset += readings.length;
    return { readings, nextCursor: offset < total ? String(offset) : null };
  };
}
for (const total of [0, 1, 49999, 50000, 50001, 100000, 127719]) {
  test(`exports ${total} readings exactly once across file and API-page boundaries`, async () => {
    const parts = [];
    const result = await exportReadingParts({ api: pages(total), query: '', onPart: p => parts.push(p) });
    assert.deepEqual(result, { total, parts: Math.ceil(total / 50000) });
    const ids = [];
    for (const [index, p] of parts.entries()) {
      assert.equal(p.filename, `coop-readings-part-${String(index + 1).padStart(3, '0')}.csv`);
      const [header, ...lines] = p.csv.split('\r\n');
      assert.equal(header, 'seq,value');
      assert.equal(lines.length, p.count);
      assert.equal(p.count, Math.min(50000, total - index * 50000));
      ids.push(...lines.map(line => Number(line.split(',')[0].replaceAll('"', ''))));
    }
    assert.deepEqual(ids, Array.from({ length: total }, (_, n) => n));
  });
}

test('CSV escaping and formula protection survive splitting; empty API pages are followed', async () => {
  let call = 0; const parts = [];
  await exportReadingParts({ query: '', api: async () => ++call === 1
    ? { readings: [], nextCursor: 'next' }
    : { readings: [{ text: '=SUM(A1)', quoted: 'a,"b"\nnext', value: -2 }], nextCursor: null }, onPart: p => parts.push(p) });
  assert.equal(call, 2);
  assert.equal(parts[0].csv, 'text,quoted,value\r\n"\'=SUM(A1)","a,""b""\nnext","-2"');
});

test('real authenticated history route exports 127,719 SQLite-backed readings without writes', async t => {
  const { db, env, queries } = await fixture(t), anchor = Date.parse('2026-10-16T00:00:00Z');
  const insert = db.prepare('INSERT INTO reading_windows(device_id,block_id,boot_id,anchor_ms,data_json,received_at,revision) VALUES (?,?,?,?,?,?,1)');
  const total = 127719;
  for (let start = 0; start < total; start += 12) {
    const tuples = Array.from({ length: Math.min(12, total - start) }, (_, n) => packSample(reading(start + n, (start + n) * 5000)));
    insert.run(deviceId, blockKey(anchor, start * 5000, 'boot'), 'boot', anchor, JSON.stringify(tuples), new Date(anchor).toISOString());
  }
  queries.length = 0;
  let expected = 0, calls = 0; const counts = [];
  const result = await exportReadingParts({
    query: new URLSearchParams({ deviceId, from: new Date(anchor).toISOString(), to: new Date(anchor + total * 5000).toISOString() }),
    api: async path => { calls++; const response = await app.fetch(request(path), env); assert.equal(response.status, 200); return response.json(); },
    onPart: p => {
      counts.push(p.count);
      const [header, ...lines] = p.csv.split('\r\n'), seqColumn = header.split(',').indexOf('seq');
      for (const line of lines) assert.equal(Number(line.split(',')[seqColumn].replaceAll('"', '')), expected++);
    } });
  assert.equal(expected, total); assert.deepEqual(counts, [50000, 50000, 27719]);
  assert.equal(result.parts, 3); assert.equal(calls, Math.ceil(Math.ceil(total / 12) / 30));
  assert.ok(queries.every(sql => /^SELECT/i.test(sql.trim())));
});

function ui(api) {
  const elements = Object.fromEntries(['export', 'export-status', 'export-downloads', 'from', 'to'].map(id => [id, {
    value: '', textContent: '', children: [], disabled: false, addEventListener() {},
    append(child) { this.children.push(child); }, replaceChildren() { this.children = []; }
  }]));
  elements.from.value = '2026-10-16T00:00'; elements.to.value = '2026-10-23T00:00';
  const blobs = [], revoked = [], clicked = [];
  const document = { getElementById: id => elements[id], createElement: () => ({ children: [], append(child) { this.children.push(child); }, click() { clicked.push(this.download); } }) };
  const controller = createHistoryExport({ api, deviceId: () => 'original', document,
    urls: { createObjectURL(blob) { blobs.push(blob); return `blob:${blobs.length}`; }, revokeObjectURL(url) { revoked.push(url); } } });
  return { ...controller, elements, blobs, revoked, clicked };
}

test('UI freezes dates, triggers numbered downloads, retains fallback links and cleans up on reset', async () => {
  const source = pages(50001); let firstRange;
  const f = ui(async path => {
    const p = new URL('https://test' + path).searchParams;
    firstRange ??= p.get('from'); assert.equal(p.get('from'), firstRange); assert.equal(p.get('deviceId'), 'original');
    f.elements.from.value = '2026-11-01T00:00';
    return source(path);
  });
  await f.start();
  assert.deepEqual(f.clicked, ['coop-readings-part-001.csv', 'coop-readings-part-002.csv']);
  assert.equal(f.elements['export-downloads'].children.length, 2);
  assert.ok(f.elements['export-status'].textContent.includes(`${(50001).toLocaleString()} readings in 2 CSV`));
  assert.equal(f.elements.export.disabled, false); assert.equal(f.revoked.length, 0);
  f.reset(); assert.deepEqual(f.revoked, ['blob:1', 'blob:2']); assert.equal(f.elements['export-downloads'].children.length, 0);
});

test('network failure keeps completed parts and allows a fresh retry', async () => {
  let source = pages(100001, 1000), calls = 0, fail = true;
  const f = ui(async path => { if (fail && ++calls === 52) throw Error('Network unavailable'); return source(path); });
  await f.start();
  assert.equal(f.blobs.length, 1); assert.match(f.elements['export-status'].textContent, /Export stopped: Network unavailable 1 completed part/);
  assert.equal(f.elements.export.disabled, false);
  source = pages(1); fail = false; await f.start();
  assert.deepEqual(f.revoked, ['blob:1']); assert.match(f.elements['export-status'].textContent, /Prepared 1 reading in 1 CSV file/);
});

test('reset suppresses late responses and concurrent starts do not duplicate requests', async () => {
  let resolve, calls = 0;
  const f = ui(() => { calls++; return new Promise(r => resolve = r); });
  const pending = f.start(); await f.start(); assert.equal(calls, 1);
  f.reset(); resolve({ readings: [row(1)], nextCursor: null }); await pending;
  assert.equal(f.blobs.length, 0); assert.equal(f.elements['export-status'].textContent, '');
  assert.equal(f.elements.export.disabled, false);
});

test('invalid ranges make no requests, and cyclic cursors stop pagination', async () => {
  const f = ui(() => { throw Error('must not fetch'); });
  f.elements.to.value = f.elements.from.value; await f.start();
  assert.match(f.elements['export-status'].textContent, /valid From \/ To/);
  let calls = 0;
  await assert.rejects(exportReadingParts({ query: '', api: async () => { calls++; return { readings: [], nextCursor: 'same' }; }, onPart() {} }), /repeated a cursor/);
  assert.equal(calls, 2);
});

test('a guard can block an export (with or without a message) without clearing earlier links', async () => {
  let calls = 0; const f = ui(async path => { calls++; return pages(1)(path); });
  await f.start(); assert.equal(f.elements['export-downloads'].children.length, 1);
  f.setGuard(() => 'Apply the new dates first.'); await f.start();
  assert.equal(f.elements['export-status'].textContent, 'Apply the new dates first.');
  f.setGuard(() => ''); await f.start();
  assert.equal(calls, 1); assert.equal(f.elements['export-downloads'].children.length, 1); assert.equal(f.revoked.length, 0);
  f.setGuard(null); await f.start(); assert.equal(calls, 2);
});
