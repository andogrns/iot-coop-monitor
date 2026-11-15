import { csvCell } from './csv.js?v=22eabeae15dc';

export const EXPORT_PART_SIZE = 50000;

// Keep only one part's CSV lines plus the current API page in working memory.
export async function exportReadingParts({ api, query, onPart, onProgress = () => {}, signal }) {
  const params = new URLSearchParams(query);
  params.delete('cursor');
  params.delete('pageSize');
  params.delete('mode');
  params.set('limit', '30');
  params.set('order', 'asc');
  let cursor = null, fields, lines = [], count = 0, total = 0, part = 0;
  const seen = new Set();
  async function flush() {
    await onPart({ csv: [fields.join(','), ...lines].join('\r\n'), count, part: ++part,
      filename: `coop-readings-part-${String(part).padStart(3, '0')}.csv` });
    lines = []; count = 0;
  }
  do {
    signal?.throwIfAborted();
    if (cursor) params.set('cursor', cursor);
    const page = await api('/api/history?' + params, { signal });
    signal?.throwIfAborted();
    if (!Array.isArray(page.readings) || (page.nextCursor != null && typeof page.nextCursor !== 'string'))
      throw Error('Invalid history response.');
    if (page.nextCursor && seen.has(page.nextCursor)) throw Error('History pagination repeated a cursor.');
    for (const row of page.readings) {
      fields ??= Object.keys(row);
      lines.push(fields.map(field => csvCell(row[field])).join(','));
      count++; total++;
      if (count === EXPORT_PART_SIZE) await flush();
    }
    onProgress(total);
    cursor = page.nextCursor;
    if (cursor) {
      seen.add(cursor);
    }
  } while (cursor);
  if (count) await flush();
  return { total, parts: part };
}

// setGuard(fn): before each export fn() may return a message (shown, export not started), '' (silently not
// started, e.g. the caller handles the click) or null/undefined (export proceeds).
export function createHistoryExport({ api, deviceId, document: doc = document, urls = URL }) {
  const button = doc.getElementById('export'), status = doc.getElementById('export-status');
  const links = doc.getElementById('export-downloads');
  let controller = null, objectUrls = [], guard = () => null;
  function reset() {
    controller?.abort(); controller = null;
    for (const url of objectUrls) urls.revokeObjectURL(url);
    objectUrls = []; links.replaceChildren(); status.textContent = ''; button.disabled = false;
  }
  async function start() {
    if (controller) return;
    const blocked = guard();
    if (blocked != null) { if (blocked) status.textContent = blocked; return; }
    reset();
    const run = new AbortController(); controller = run; button.disabled = true;
    let parts = 0, saved = 0;
    try {
      const device = deviceId(), from = new Date(doc.getElementById('from').value), to = new Date(doc.getElementById('to').value);
      if (!device) throw Error('Choose a device before exporting.');
      if (!Number.isFinite(+from) || !Number.isFinite(+to) || to <= from || to - from > 31 * 86400000)
        throw Error('Choose a valid From / To range up to 31 days.');
      status.textContent = 'Preparing your CSV download…';
      const result = await exportReadingParts({ api, signal: run.signal,
        query: new URLSearchParams({ deviceId: device, from: from.toISOString(), to: to.toISOString() }),
        onProgress: total => { status.textContent = `Preparing CSV: ${total.toLocaleString()} readings read, ${parts} ${parts === 1 ? 'file' : 'files'} ready…`; },
        onPart: ({ csv, count, filename }) => {
          const url = urls.createObjectURL(new Blob([csv], { type: 'text/csv; charset=utf-8' }));
          objectUrls.push(url);
          const item = doc.createElement('li'), link = doc.createElement('a');
          link.href = url; link.download = filename;
          link.textContent = `${filename} (${count.toLocaleString()} readings)`;
          item.append(link); links.append(item); parts++; saved += count;
          link.click();
        } });
      status.textContent = result.total
        ? `Prepared ${result.total.toLocaleString()} ${result.total === 1 ? 'reading' : 'readings'} in ${result.parts} CSV ${result.parts === 1 ? 'file' : 'files'}. If a download did not start, use the ${result.parts === 1 ? 'link' : 'links'} below (kept until you export again, change device or sign out).`
        : 'No readings in this range, so there was nothing to export.';
    } catch (error) {
      if (!run.signal.aborted) status.textContent = `Export stopped: ${error.message} ${parts} completed part(s) (${saved.toLocaleString()} readings) can still be downloaded below. Export again to restart from the beginning of the range.`;
    } finally {
      if (controller === run) { controller = null; button.disabled = false; }
    }
  }
  button.addEventListener('click', start);
  return { start, reset, setGuard(fn) { guard = typeof fn === 'function' ? fn : () => null; } };
}
