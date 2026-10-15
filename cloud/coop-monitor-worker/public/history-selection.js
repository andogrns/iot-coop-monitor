export function createHistorySelection({ api, deviceId }) {
  const $ = id => document.getElementById(id);
  let revision = 0, timer;
  const signature = () => [deviceId(), $('from').value, $('to').value].join('|');
  async function countSelection() {
    clearTimeout(timer);
    const request = ++revision, key = signature();
    try {
      const from = new Date($('from').value), to = new Date($('to').value);
      if (!deviceId()) throw Error('Choose a device to count selected entries.');
      if (!Number.isFinite(+from) || !Number.isFinite(+to) || +from < 0 || +to <= +from || +to - +from > 31 * 86400000)
        throw Error('Choose a valid From / To range up to 31 days.');
      $('history-selection-count').textContent = 'Counting selected entries…';
      const result = await api('/api/archives/selection?' + new URLSearchParams({ deviceId: deviceId(), from: from.toISOString(), to: to.toISOString() }));
      if (request !== revision || key !== signature()) return;
      if (!Number.isSafeInteger(result.count) || result.count < 0) throw Error('Could not count selected entries. Try loading the range again.');
      $('history-selection-count').textContent = `${result.count.toLocaleString()} data ${result.count === 1 ? 'entry' : 'entries'} selected${result.count ? '.' : ' — no readings in this range.'}`;
    } catch (error) {
      if (request === revision && key === signature()) $('history-selection-count').textContent = error.message;
    }
  }
  function invalidate() {
    revision++; clearTimeout(timer);
    $('history-selection-count').textContent = 'Counting selected entries…';
    timer = setTimeout(countSelection, 300);
  }
  for (const id of ['from', 'to']) $(id).addEventListener('input', invalidate);
  return {
    countSelection,
    reset() { revision++; clearTimeout(timer); $('history-selection-count').textContent = 'Choose a range to count selected entries.'; },
  };
}
