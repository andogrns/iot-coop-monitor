import { formatNumber } from './format.js?v=0242141ec619';
import { confirmDialog } from './ui.js?v=c84da061d886';

const count = n => formatNumber(n, { digits: 0 });
const readings = n => `${count(n)} ${n === 1 ? 'reading' : 'readings'}`;

export function createManualArchives({ api, send, deviceId, reload, refresh, notice }) {
  const $ = id => document.getElementById(id);
  let revision = 0, timer, selection = null, busy = false;
  const signature = () => [deviceId(), $('archive-from').value, $('archive-to').value].join('|');
  function updateButton() {
    const ready = !!selection?.count && selection.signature === signature();
    $('create-archive').disabled = busy || !ready || !$('archive-label').value.trim();
    $('create-archive').textContent = ready ? `Archive ${readings(selection.count)}…` : 'Archive readings…';
  }
  function query() {
    if (!$('archive-from').value || !$('archive-to').value) throw Error('Choose a range to count readings.');
    const from = new Date($('archive-from').value), to = new Date($('archive-to').value);
    if (!deviceId() || !Number.isFinite(+from) || !Number.isFinite(+to) || +to <= +from || +to - +from > 31 * 86400000)
      throw Error('Choose a From time before the To time, at most 31 days apart.');
    return { deviceId: deviceId(), from: from.toISOString(), to: to.toISOString() };
  }
  function setCount(text, tone = '') { const node = $('archive-count'); node.textContent = text; node.className = 'arc-count' + (tone ? ' ' + tone : ''); }
  // Job progress lives at the top of the library so it is visible for new and continued jobs alike.
  function progress(text, tone = '', job = null) {
    $('archive-progress').textContent = text;
    $('archive-job').hidden = !text; $('archive-job').className = 'arc-job' + (tone ? ' ' + tone : '');
    $('archive-job-bar').hidden = !job;
    if (job) $('archive-job-fill').style.setProperty('--used', `${job.selected_count ? Math.min(100, Math.round(job.archived_count / job.selected_count * 100)) : 0}%`);
  }
  async function countSelection() {
    clearTimeout(timer);
    const request = ++revision, key = signature();
    selection = null; updateButton();
    if (!$('archive-from').value || !$('archive-to').value) { setCount('Choose a range to count readings.'); return; }
    try {
      const params = query();
      setCount('Counting readings…');
      const result = await api('/api/archives/selection?' + new URLSearchParams(params));
      if (request !== revision || key !== signature()) return;
      selection = { ...result, signature: key };
      if (result.count) setCount(`${readings(result.count)} selected.`, 'ok');
      else setCount('No readings in History for this range.');
    } catch (error) {
      if (request === revision && key === signature()) setCount(error.message, 'error');
    }
    updateButton();
  }
  function invalidate() {
    revision++; selection = null; clearTimeout(timer); updateButton();
    setCount('Counting readings…');
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
    $('archive-job').scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    try {
      while (job.status !== 'complete') {
        progress(`Archiving “${job.label}”: ${count(job.archived_count)} of ${count(job.selected_count)} readings saved. Keep this page open until it finishes.`, 'busy', job);
        job = await send('/api/archives/manual/' + job.archive_id, 'POST', {});
      }
      progress(`“${job.label}” is complete: ${readings(job.archived_count)} archived.`, 'ok');
      notice(`Archive “${job.label}” saved with ${readings(job.archived_count)}.`, 'success');
    } catch (error) {
      const text = `${error.message} The parts already saved are kept. Press “Continue archiving” on the folder to finish.`;
      progress(text, 'error'); notice(text, 'error');
    } finally {
      try { await reload(); await refresh(); } catch (error) { notice(error.message, 'error'); }
      setBusy(false);
      await countSelection();
    }
  }
  $('archive-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || !selection?.count || selection.signature !== signature()) return;
    const expected = selection, label = $('archive-label').value.trim();
    const confirmed = await confirmDialog({
      title: `Archive ${readings(expected.count)}?`,
      body: [
        `The ${readings(expected.count)} from this range will be moved into the archive “${label}”.`,
        'They will no longer appear in History or in the trend charts. They stay downloadable here in the Archives library.',
        'This cannot be undone from the dashboard.',
      ],
      confirmLabel: `Move ${readings(expected.count)}`,
      cancelLabel: 'Keep in History',
    });
    if (!confirmed || busy || selection !== expected || expected.signature !== signature()) return;
    setBusy(true);
    try {
      const job = await send('/api/archives/manual', 'POST', { ...query(), label, expectedCount: expected.count });
      $('archive-label').value = '';
      await run(job);
    } catch (error) {
      progress(error.message, 'error'); notice(error.message, 'error');
      try { await reload(); } catch (reloadError) { notice(reloadError.message, 'error'); }
      setBusy(false); await countSelection();
    }
  });
  for (const id of ['archive-from', 'archive-to']) $(id).addEventListener('input', invalidate);
  $('archive-label').addEventListener('input', updateButton);
  $('new-archive').addEventListener('click', () => {
    $('archive-create').open = true;
    $('archive-create').scrollIntoView?.({ block: 'start', behavior: 'smooth' });
    $('archive-from').focus({ preventScroll: true });
  });
  return {
    countSelection,
    reset() { revision++; selection = null; clearTimeout(timer); setCount('Choose a range to count readings.'); progress(''); updateButton(); },
    continueArchive(job) { if (!busy) return run(job); },
  };
}
