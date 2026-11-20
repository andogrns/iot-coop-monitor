import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pageCount, pageItems } from '../public/history-pager.js';

test('page lists show every page when they fit and keep a constant length otherwise', () => {
  assert.deepEqual(pageItems(1, 1), [1]);
  assert.deepEqual(pageItems(3, 7), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(pageItems(1, 20), [1, 2, 3, 4, 5, 'gap', 20]);
  assert.deepEqual(pageItems(4, 20), [1, 2, 3, 4, 5, 'gap', 20]);
  assert.deepEqual(pageItems(5, 20), [1, 'gap', 4, 5, 6, 'gap', 20]);
  assert.deepEqual(pageItems(16, 20), [1, 'gap', 15, 16, 17, 'gap', 20]);
  assert.deepEqual(pageItems(17, 20), [1, 'gap', 16, 17, 18, 19, 20]);
  assert.deepEqual(pageItems(20, 20), [1, 'gap', 16, 17, 18, 19, 20]);
  assert.deepEqual(pageItems(50, 100, 0), [1, 'gap', 50, 'gap', 100]);
  assert.deepEqual(pageItems(2, 100, 0), [1, 2, 3, 'gap', 100]);
  assert.deepEqual(pageItems(99, 100, 0), [1, 'gap', 98, 99, 100]);
  assert.deepEqual(pageItems(0, 0), [1]);
  assert.deepEqual(pageItems(30, 20), [1, 'gap', 16, 17, 18, 19, 20]); // clamped
  for (const siblings of [0, 1, 2]) for (let count = 1; count <= 40; count++) for (let current = 1; current <= count; current++) {
    const items = pageItems(current, count, siblings), numbers = items.filter(i => i !== 'gap');
    assert.ok(numbers.includes(1) && numbers.includes(count) && numbers.includes(current), `${current}/${count}`);
    assert.ok(numbers.every((n, i) => i === 0 || n > numbers[i - 1]), 'ascending');
    for (let s = 1; s <= siblings; s++) for (const p of [current - s, current + s]) if (p >= 1 && p <= count) assert.ok(numbers.includes(p), `sibling ${p} of ${current}/${count}`);
    // A gap always stands for at least two hidden pages; no duplicate gaps.
    items.forEach((item, i) => { if (item === 'gap') { assert.ok(items[i + 1] - items[i - 1] > 2); assert.notEqual(items[i + 1], 'gap'); } });
    if (count > 2 * siblings + 5) assert.equal(items.length, 2 * siblings + 5);
  }
});

test('page counts come from the total and yield to what the last page load reported', () => {
  assert.deepEqual(pageCount({ total: 1234, pageSize: 100, page: 1, rows: 100, hasNext: true }), { pages: 13, exact: true });
  assert.deepEqual(pageCount({ total: 1200, pageSize: 100, page: 12, rows: 100, hasNext: false }), { pages: 12, exact: true });
  assert.deepEqual(pageCount({ total: 57, pageSize: 100, page: 1, rows: 57, hasNext: false }), { pages: 1, exact: true });
  assert.deepEqual(pageCount({ total: 0, pageSize: 50, page: 1, rows: 0, hasNext: false }), { pages: 1, exact: true });
  // Not counted yet: one more page is known, more may follow.
  assert.deepEqual(pageCount({ total: null, pageSize: 100, page: 3, rows: 100, hasNext: true }), { pages: 4, exact: false });
  assert.deepEqual(pageCount({ total: null, pageSize: 100, page: 3, rows: 40, hasNext: false }), { pages: 3, exact: true });
  // Readings arrived or moved after counting.
  assert.deepEqual(pageCount({ total: 200, pageSize: 100, page: 2, rows: 100, hasNext: true }), { pages: 3, exact: false });
  assert.deepEqual(pageCount({ total: 1000, pageSize: 100, page: 4, rows: 30, hasNext: false }), { pages: 4, exact: true });
  assert.deepEqual(pageCount({ total: 1000, pageSize: 100, page: 12, rows: 0, hasNext: false }), { pages: 10, exact: true });
  assert.deepEqual(pageCount({ total: 1000, pageSize: 100, page: 8, rows: 0, hasNext: false }), { pages: 7, exact: true });
  assert.deepEqual(pageCount({ total: null, pageSize: 100, page: 1, rows: 0, hasNext: false }), { pages: 1, exact: false });
});
