// Numbered pages for the History table (no DOM here, so it can be unit tested).

const range = (a, b) => Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => a + i);

// Page numbers to show, with 'gap' for hidden runs. The first and last page are always shown,
// plus `siblings` pages either side of the current one. Long lists keep a constant length
// (2 * siblings + 5), so the buttons do not jump around while paging, and a gap always hides
// at least two pages (a single hidden page is shown as its number instead).
export function pageItems(current, count, siblings = 1) {
  count = Math.max(1, count); current = Math.min(Math.max(1, current), count);
  const width = 2 * siblings + 1;
  if (count <= width + 4) return range(1, count);
  if (current <= siblings + 3) return [...range(1, width + 2), 'gap', count];
  if (current >= count - siblings - 2) return [1, 'gap', ...range(count - width - 1, count)];
  return [1, 'gap', ...range(current - siblings, current + siblings), 'gap', count];
}

// How many pages there are. `total` is the counted readings (null while unknown);
// `rows` and `hasNext` describe the page just loaded, which wins if the data changed
// since counting. exact = false means more pages may follow the ones known so far.
export function pageCount({ total, pageSize, page, rows, hasNext }) {
  const counted = Number.isSafeInteger(total) && total >= 0 ? Math.max(1, Math.ceil(total / pageSize)) : null;
  if (hasNext) return { pages: Math.max(counted ?? 0, page + 1), exact: counted !== null && counted > page };
  if (rows) return { pages: page, exact: true };
  return { pages: Math.max(1, Math.min(counted ?? Infinity, page - 1)), exact: counted !== null };
}
