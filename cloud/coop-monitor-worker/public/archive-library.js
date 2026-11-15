import { verifiedArchiveZip, archiveZipName, archiveFileName } from './archive-zip.js?v=0a25c8ade641';
import { formatBytes, formatDateTime, formatNumber } from './format.js?v=0242141ec619';
import { badge, el, emptyState, notice, setRelativeTime } from './ui.js?v=c84da061d886';

export async function allArchiveFiles(api, deviceId, folder, current = () => true) {
  const files = [], keys = new Set(), cursors = new Set(); let cursor;
  do {
    const page = await api('/api/archive-files?' + new URLSearchParams({ deviceId, folder, ...(cursor ? { cursor } : {}) }));
    if (!current()) throw Error('Download cancelled.');
    for (const file of page.files) {
      if (keys.has(file.object_key)) throw Error('Archive file list changed. Reopen the archive and try again.');
      keys.add(file.object_key); files.push(file);
    }
    cursor = page.nextCursor;
    if (cursor && cursors.has(cursor)) throw Error('Archive file list could not be completed. Try again.');
    if (cursor) cursors.add(cursor);
  } while (cursor);
  return files;
}

const count = n => formatNumber(n, { digits: 0 });
const plural = (n, one, many = one + 's') => `${count(n)} ${n === 1 ? one : many}`;
// Automatic folders cover one UTC day; take the date from the ISO string so local timezones cannot shift it.
const utcDay = iso => { const [y, m, d] = String(iso).slice(0, 10).split('-'); return `${d}/${m}/${y}`; };

export function createArchiveLibrary({ api, deviceId, continueArchive, onUnauthorized }) {
  const $ = id => document.getElementById(id), root = $('archive-list'), more = $('more-archives');
  const summary = $('archive-summary'), filterGroup = $('archive-filter'), tools = filterGroup;
  let revision = 0, cursor = null, loading = false, download = null, filter = 'all', bodyIds = 0;
  const states = new Map();

  function setStatus(state, text, tone = '') { state.status.textContent = text; state.status.className = 'arc-status' + (tone ? ' ' + tone : ''); }
  function applyFilter() {
    let manual = 0, automatic = 0, visible = 0;
    for (const state of states.values()) {
      const type = state.folder.type === 'manual' ? 'manual' : 'automatic';
      if (type === 'manual') manual++; else automatic++;
      state.item.hidden = filter !== 'all' && filter !== type;
      if (!state.item.hidden) visible++;
    }
    for (const button of filterGroup.querySelectorAll('button')) {
      const on = button.dataset.filter === filter;
      button.classList.toggle('selected', on); button.setAttribute('aria-pressed', String(on));
    }
    tools.hidden = !states.size;
    summary.textContent = states.size ? `${count(manual)} manual · ${count(automatic)} automatic ${cursor ? 'loaded so far — more available below' : ''}`.trim() : '';
    let none = root.querySelector('.arc-filter-empty');
    if (states.size && !visible) {
      none ??= el('p', 'arc-filter-empty'); root.append(none);
      none.textContent = `No ${filter} archives ${cursor ? 'loaded yet. Use “Load more archives” to look further back.' : 'for this device.'}`;
    } else none?.remove();
  }
  function reset() {
    revision++; cursor = null; loading = false; download?.abort(); download = null; states.clear(); root.replaceChildren(); more.hidden = true;
    summary.textContent = ''; tools.hidden = true;
  }
  function controls(state) {
    const selected = state.files.filter(f => state.selected.has(f.object_key)).length;
    state.downloadSelected.textContent = `Download selected (${selected})`;
    state.downloadSelected.disabled = !!download || !selected;
    state.downloadAll.disabled = !!download || !state.folder.file_count;
    state.selectAll.disabled = !!download || !state.files.length;
    state.selectAll.checked = !!state.files.length && selected === state.files.length;
    state.selectAll.indeterminate = selected > 0 && selected < state.files.length;
    for (const check of state.list.querySelectorAll('input')) check.disabled = !!download;
    state.selectText.textContent = state.complete || !state.files.length ? 'Select all' : `Select all shown (${count(state.files.length)} of ${count(state.folder.file_count)})`;
    state.selectHead.hidden = !state.files.length;
  }
  function updateControls() { for (const state of states.values()) controls(state); }
  async function downloadFiles(state, selectedOnly) {
    if (download) return;
    const scope = revision, owner = deviceId(), controller = new AbortController(); download = controller; updateControls();
    const current = () => scope === revision && owner === deviceId() && !controller.signal.aborted;
    setStatus(state, 'Preparing file list…', 'busy'); state.bar.hidden = false; state.fill.style.setProperty('--used', '0%');
    try {
      let files = selectedOnly ? state.files.filter(f => state.selected.has(f.object_key)) : await allArchiveFiles(api, owner, state.folder.folder_id, current);
      files = files.map((file, index) => ({ ...file, filename: archiveFileName(file, selectedOnly ? state.files.findIndex(f => f.object_key === file.object_key) : index) }));
      const blob = await verifiedArchiveZip(files, {
        current, progress: (n, total) => {
          setStatus(state, `Preparing ZIP: ${count(n)} of ${count(total)} files verified…`, 'busy');
          state.fill.style.setProperty('--used', `${Math.round(n / total * 100)}%`);
        },
        readFile: async file => {
          const response = await fetch('/api/archive?' + new URLSearchParams({ key: file.object_key }), { signal: controller.signal });
          if (!response.ok) { if (response.status === 401) onUnauthorized(); throw Error('A saved file could not be downloaded. No ZIP was downloaded; try again.'); }
          return response.arrayBuffer();
        },
      });
      if (!current()) return;
      const url = URL.createObjectURL(blob), link = el('a'); link.href = url; link.download = archiveZipName(state.folder.label + (selectedOnly ? ' - selected' : ''));
      document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
      const done = `ZIP ready: ${plural(files.length, 'file')} checked and downloaded.`;
      setStatus(state, done, 'ok'); notice(`${done} (${state.title})`, 'success');
    } catch (error) { if (current()) { setStatus(state, error.message, 'error'); notice(error.message, 'error'); } }
    finally { if (download === controller) download = null; state.bar.hidden = true; updateControls(); }
  }
  function fileRow(state, file, index) {
    const name = `Part ${count(index + 1)}`, filename = archiveFileName(file, index);
    const row = el('div', 'arc-file'), label = el('label', 'arc-file-name'), check = el('input');
    check.type = 'checkbox'; check.setAttribute('aria-label', `Select ${name}`);
    check.addEventListener('change', () => { if (check.checked) state.selected.add(file.object_key); else state.selected.delete(file.object_key); controls(state); });
    label.append(check, el('span', '', name));
    const saved = el('span', 'arc-file-saved', formatDateTime(file.created_at));
    const actions = el('span', 'arc-file-actions'), toggle = el('button', 'quiet small', 'Checksum');
    const hash = el('p', 'arc-checksum', `SHA-256 ${file.sha256}`); hash.hidden = true; hash.id = `arc-hash-${++bodyIds}`;
    toggle.type = 'button'; toggle.title = `SHA-256 ${file.sha256}`; toggle.setAttribute('aria-expanded', 'false'); toggle.setAttribute('aria-controls', hash.id);
    toggle.addEventListener('click', () => { hash.hidden = !hash.hidden; toggle.setAttribute('aria-expanded', String(!hash.hidden)); });
    const link = el('a', 'arc-file-link', 'Download'); link.href = '/api/archive?' + new URLSearchParams({ key: file.object_key });
    link.title = filename; link.setAttribute('aria-label', `Download ${name} (${filename})`);
    actions.append(toggle, link);
    row.append(label, el('span', 'arc-file-num', plural(file.sample_count, 'reading')), el('span', 'arc-file-num', formatBytes(file.compressed_bytes)), saved, actions, hash);
    return row;
  }
  async function loadFiles(state) {
    if (state.loading || state.complete) return;
    const scope = revision, owner = deviceId(); state.loading = true; state.more.disabled = true; setStatus(state, 'Loading files…', 'busy');
    try {
      const page = await api('/api/archive-files?' + new URLSearchParams({ deviceId: owner, folder: state.folder.folder_id, ...(state.cursor ? { cursor: state.cursor } : {}) }));
      if (scope !== revision || owner !== deviceId()) return;
      const known = new Set(state.files.map(f => f.object_key));
      for (const file of page.files) {
        if (known.has(file.object_key)) continue;
        const index = state.files.length; state.files.push(file); known.add(file.object_key);
        state.list.append(fileRow(state, file, index));
      }
      state.cursor = page.nextCursor; state.complete = !state.cursor; state.more.hidden = state.complete;
      state.more.textContent = `Show more files (${count(state.files.length)} of ${count(state.folder.file_count)} shown)`;
      setStatus(state, state.files.length ? '' : 'No files saved yet. Press “Continue archiving” to save the selected readings.');
      controls(state);
    } catch (error) { if (scope === revision && owner === deviceId()) { setStatus(state, error.message, 'error'); state.more.hidden = false; state.more.textContent = 'Retry loading files'; } }
    finally { state.loading = false; state.more.disabled = false; }
  }
  function renderFolder(folder) {
    if (states.has(folder.folder_id)) return;
    const manual = folder.type === 'manual', complete = folder.status === 'complete';
    const title = manual ? folder.label : `Automatic · ${utcDay(folder.range_from)}`;
    const item = el('div', `arc-folder ${manual ? 'manual' : 'automatic'}${complete ? '' : ' incomplete'}`), row = el('div', 'arc-row');
    const toggle = el('button', 'arc-toggle'), body = el('div', 'arc-body'), text = el('span', 'arc-text'), head = el('span', 'arc-head');
    body.id = `arc-body-${++bodyIds}`; body.hidden = true;
    toggle.type = 'button'; toggle.setAttribute('aria-expanded', 'false'); toggle.setAttribute('aria-controls', body.id);
    head.append(el('span', 'arc-title', title), badge(manual ? 'Manual' : 'Automatic', manual ? 'info' : 'muted'));
    if (!complete) head.append(badge(`Incomplete — ${count(folder.archived_count ?? 0)} of ${count(folder.selected_count ?? 0)} saved`, 'warn'));
    const meta = el('span', 'arc-meta'), range = el('span', '', manual ? `${formatDateTime(folder.range_from)} – ${formatDateTime(folder.range_to)}` : 'Whole day (UTC)');
    if (!manual) range.title = `In your time: ${formatDateTime(folder.range_from)} – ${formatDateTime(folder.range_to)}`;
    const when = el('span'), stamp = manual && !complete && !folder.file_count ? folder.started_at : folder.archived_at;
    const verb = !complete ? (folder.file_count ? 'Last saved' : 'Started') : manual ? 'Archived' : 'Moved here';
    setRelativeTime(when, stamp, rel => `${verb} ${rel}`);
    meta.append(range, el('span', '', plural(folder.sample_count, 'reading')), el('span', '', plural(folder.file_count, 'file')), el('span', '', formatBytes(folder.compressed_bytes)), when);
    text.append(head, meta); toggle.append(el('span', 'arc-chevron'), text); toggle.firstChild.setAttribute('aria-hidden', 'true');
    row.append(toggle);
    if (!complete && folder.archive_id) {
      const resume = el('button', 'archive-resume', 'Continue archiving'); resume.type = 'button';
      resume.addEventListener('click', () => continueArchive({ archive_id: folder.archive_id, label: folder.label, status: folder.status, selected_count: folder.selected_count, archived_count: folder.archived_count }));
      row.append(resume);
    }
    const actions = el('div', 'arc-actions'), downloadAll = el('button', 'primary', 'Download all as ZIP'), downloadSelected = el('button', '', 'Download selected (0)');
    downloadAll.type = downloadSelected.type = 'button';
    actions.append(downloadAll, downloadSelected);
    const bar = el('div', 'usage-bar arc-bar'), fill = el('span', 'usage-fill'); bar.append(fill); bar.hidden = true;
    const status = el('p', 'arc-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const files = el('div', 'arc-files'), selectHead = el('div', 'arc-file arc-file-head'), selectLabel = el('label', 'arc-file-name'), selectAll = el('input'), selectText = el('span', '', 'Select all');
    selectAll.type = 'checkbox'; selectAll.setAttribute('aria-label', `Select all shown files in ${title}`);
    selectLabel.append(selectAll, selectText);
    selectHead.append(selectLabel, el('span', 'arc-file-num', 'Readings'), el('span', 'arc-file-num', 'Size'), el('span', 'arc-file-saved', 'Saved'), el('span', 'arc-file-actions'));
    selectHead.hidden = true;
    const list = el('div', 'arc-file-list'), next = el('button', 'quiet', 'Show more files'); next.type = 'button'; next.hidden = true;
    files.append(selectHead, list);
    body.append(actions, bar, status, files, next); item.append(row, body); root.append(item);
    const state = { folder, title, item, files: [], selected: new Set(), cursor: null, complete: false, loading: false, list, status, bar, fill, selectAll, selectText, selectHead, downloadAll, downloadSelected, more: next };
    states.set(folder.folder_id, state);
    toggle.addEventListener('click', () => {
      const open = body.hidden; body.hidden = !open; item.classList.toggle('open', open); toggle.setAttribute('aria-expanded', String(open));
      if (open && !state.files.length && !state.complete) loadFiles(state);
    });
    next.addEventListener('click', () => loadFiles(state)); downloadAll.addEventListener('click', () => downloadFiles(state, false)); downloadSelected.addEventListener('click', () => downloadFiles(state, true));
    selectAll.addEventListener('change', () => { for (const file of state.files) { if (selectAll.checked) state.selected.add(file.object_key); else state.selected.delete(file.object_key); } for (const check of list.querySelectorAll('input')) check.checked = selectAll.checked; controls(state); });
    controls(state);
  }
  async function load(replace) {
    if (replace) reset();
    if (loading) return;
    const scope = revision, owner = deviceId(); loading = true; more.disabled = true;
    if (replace) root.replaceChildren(el('p', 'arc-loading', 'Loading archives…'));
    try {
      const page = await api('/api/archive-folders?' + new URLSearchParams({ deviceId: owner, ...(cursor ? { cursor } : {}) }));
      if (scope !== revision || owner !== deviceId()) return;
      if (replace || !states.size) root.replaceChildren();
      for (const folder of page.folders) renderFolder(folder);
      cursor = page.nextCursor; more.hidden = !cursor; more.textContent = 'Load more archives';
      if (!states.size) root.replaceChildren(emptyState('No archives yet', 'Readings older than 30 days will appear here automatically, one folder per day. To keep a finished experiment together sooner, create a labelled archive below.'));
      applyFilter();
    } catch (error) {
      if (scope === revision && owner === deviceId()) { if (replace || !states.size) root.replaceChildren(el('p', 'arc-status error', error.message)); more.hidden = false; more.textContent = 'Retry loading archives'; }
    } finally { if (scope === revision) { loading = false; more.disabled = false; } }
  }
  more.addEventListener('click', () => load(!states.size));
  filterGroup.addEventListener('click', event => {
    const button = event.target.closest('button[data-filter]');
    if (button) { filter = button.dataset.filter; applyFilter(); }
  });
  return { load, reset };
}
