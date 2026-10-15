export function createManualArchives({ api, send, deviceId, reload, refresh, notice }) {
  const $ = id => document.getElementById(id);
  let revision = 0, timer, selection = null, busy = false;
  const signature = () => [deviceId(), $('archive-from').value, $('archive-to').value].join('|');
  function updateButton() {
    $('create-archive').disabled = busy || !selection?.count || selection.signature !== signature() || !$('archive-label').value.trim();
  }
  function query() {
    const from = new Date($('archive-from').value), to = new Date($('archive-to').value);
    if (!deviceId() || !Number.isFinite(+from) || !Number.isFinite(+to) || +to <= +from || +to - +from > 31 * 86400000)
      throw Error('Choose a valid From / To range up to 31 days.');
    return { deviceId: deviceId(), from: from.toISOString(), to: to.toISOString() };
  }
  async function countSelection() {
    clearTimeout(timer);
    const request = ++revision, key = signature();
    selection = null; updateButton();
    try {
      const params = query();
      $('archive-count').textContent = 'Counting selected entries…';
      const result = await api('/api/archives/selection?' + new URLSearchParams(params));
      if (request !== revision || key !== signature()) return;
      selection = { ...result, signature: key };
      $('archive-count').textContent = `${result.count.toLocaleString()} data ${result.count === 1 ? 'entry' : 'entries'} selected${result.count ? '.' : ' — no readings in this range.'}`;
    } catch (error) {
      if (request === revision && key === signature()) $('archive-count').textContent = error.message;
    }
    updateButton();
  }
  function invalidate() {
    revision++; selection = null; clearTimeout(timer); updateButton();
    $('archive-count').textContent = 'Counting selected entries…';
    timer = setTimeout(countSelection, 300);
  }
  function setBusy(value) {
    busy = value;
    for (const id of ['archive-from', 'archive-to', 'archive-label', 'device', 'logout']) $(id).disabled = value;
    for (const button of $('archive-list').querySelectorAll('.archive-resume')) button.disabled = value;
    updateButton();
  }
  async function run(job) {
    setBusy(true);
    try {
      while (job.status !== 'complete') {
        $('archive-progress').textContent = `Archiving “${job.label}”… ${job.archived_count.toLocaleString()} entries saved (${job.selected_count.toLocaleString()} selected when started). Keep this page open to finish.`;
        job = await send('/api/archives/manual/' + job.archive_id, 'POST', {});
      }
      $('archive-progress').textContent = `“${job.label}” complete: ${job.archived_count.toLocaleString()} entries archived.`;
      notice(`Archive “${job.label}” created with ${job.archived_count.toLocaleString()} entries.`);
    } catch (error) {
      $('archive-progress').textContent = `${error.message} Saved chunks are preserved. Use Continue archiving in the library to finish.`;
    } finally {
      try { await reload(); await refresh(); } catch (error) { notice(error.message); }
      setBusy(false);
      await countSelection();
    }
  }
  $('archive-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || !selection?.count || selection.signature !== signature()) return;
    setBusy(true);
    try {
      const job = await send('/api/archives/manual', 'POST', { ...query(), label: $('archive-label').value.trim(), expectedCount: selection.count });
      await run(job);
    } catch (error) {
      $('archive-progress').textContent = error.message;
      try { await reload(); } catch (reloadError) { notice(reloadError.message); }
      setBusy(false); await countSelection();
    }
  });
  for (const id of ['archive-from', 'archive-to']) $(id).addEventListener('input', invalidate);
  $('archive-label').addEventListener('input', updateButton);
  return {
    countSelection,
    reset() { revision++; selection = null; clearTimeout(timer); $('archive-count').textContent = 'Choose a range to count selected entries.'; $('archive-progress').textContent = ''; updateButton(); },
    continueArchive(job) { if (!busy) return run(job); },
  };
}
