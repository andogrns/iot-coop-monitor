// Counts the readings in the History From/To range (debounced, stale responses ignored).
// onCount(listener) receives (count | null, { from, to }) with the input values the count belongs to:
// a number once counted, null when the range changed, was reset or could not be counted.
export function createHistorySelection({ api, deviceId }) {
  const $ = id => document.getElementById(id);
  let revision = 0, timer, listener = () => {};
  const signature = () => [deviceId(), $('from').value, $('to').value].join('|');
  const range = () => ({ from: $('from').value, to: $('to').value });
  const notify = (count, values = range()) => listener(count, values);
  async function countSelection() {
    clearTimeout(timer);
    const request = ++revision, key = signature(), values = range();
    try {
      const from = new Date($('from').value), to = new Date($('to').value);
      if (!deviceId()) throw Error('Choose a device to count readings.');
      if (!Number.isFinite(+from) || !Number.isFinite(+to) || +from < 0 || +to <= +from || +to - +from > 31 * 86400000)
        throw Error('Choose a valid From / To range up to 31 days.');
      $('history-selection-count').textContent = 'Counting readings…';
      const result = await api('/api/archives/selection?' + new URLSearchParams({ deviceId: deviceId(), from: from.toISOString(), to: to.toISOString() }));
      if (request !== revision || key !== signature()) return;
      if (!Number.isSafeInteger(result.count) || result.count < 0) throw Error('Could not count the readings in this range. Try applying it again.');
      $('history-selection-count').textContent = result.count
        ? `${result.count.toLocaleString()} ${result.count === 1 ? 'reading' : 'readings'} in this range.`
        : 'No readings in this range.';
      notify(result.count, values);
    } catch (error) {
      if (request === revision && key === signature()) { $('history-selection-count').textContent = error.message; notify(null, values); }
    }
  }
  function invalidate() {
    revision++; clearTimeout(timer);
    $('history-selection-count').textContent = 'Counting readings…';
    notify(null);
    timer = setTimeout(countSelection, 300);
  }
  for (const id of ['from', 'to']) $(id).addEventListener('input', invalidate);
  return {
    countSelection,
    reset() { revision++; clearTimeout(timer); $('history-selection-count').textContent = 'Choose a range to count readings.'; notify(null); },
    onCount(fn) { listener = typeof fn === 'function' ? fn : () => {}; },
  };
}
