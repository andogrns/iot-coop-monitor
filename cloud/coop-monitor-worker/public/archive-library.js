import { verifiedArchiveZip, archiveZipName, archiveFileName } from './archive-zip.js?v=0a25c8ade641';

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
const date = value => value ? new Date(value).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ', ' + new Date(value).toLocaleTimeString() : 'Unknown';
const size = bytes => (bytes / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 }) + ' kB';
const plural = (n, word) => `${n.toLocaleString()} ${n === 1 ? word : word === 'entry' ? 'entries' : word + 's'}`;

export function createArchiveLibrary({ api, deviceId, continueArchive, onUnauthorized }) {
  const $ = id => document.getElementById(id), root = $('archive-list'), more = $('more-archives');
  let revision = 0, cursor = null, loading = false, download = null;
  const states = new Map();
  const element = (tag, className, text) => { const e = document.createElement(tag); if (className) e.className = className; if (text !== undefined) e.textContent = text; return e; };
  function reset() {
    revision++; cursor = null; loading = false; download?.abort(); download = null; states.clear(); root.replaceChildren(); more.hidden = true;
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
    state.selection.textContent = `${selected} of ${state.files.length} loaded files selected · ${state.folder.file_count} files in archive`;
  }
  function updateControls() { for (const state of states.values()) controls(state); }
  async function downloadFiles(state, selectedOnly) {
    if (download) return;
    const scope = revision, owner = deviceId(), controller = new AbortController(); download = controller; updateControls();
    const current = () => scope === revision && owner === deviceId() && !controller.signal.aborted;
    state.status.textContent = 'Preparing file list…';
    try {
      let files = selectedOnly ? state.files.filter(f => state.selected.has(f.object_key)) : await allArchiveFiles(api, owner, state.folder.folder_id, current);
      files = files.map((file, index) => ({ ...file, filename: archiveFileName(file, selectedOnly ? state.files.findIndex(f => f.object_key === file.object_key) : index) }));
      const blob = await verifiedArchiveZip(files, {
        current, progress: (n, total) => { state.status.textContent = `Preparing ZIP · ${n} of ${total} files verified…`; },
        readFile: async file => {
          const response = await fetch('/api/archive?' + new URLSearchParams({ key: file.object_key }), { signal: controller.signal });
          if (!response.ok) { if (response.status === 401) onUnauthorized(); throw Error('A saved file could not be downloaded. No ZIP was downloaded; try again.'); }
          return response.arrayBuffer();
        },
      });
      if (!current()) return;
      const url = URL.createObjectURL(blob), link = element('a'); link.href = url; link.download = archiveZipName(state.folder.label + (selectedOnly ? ' - selected' : ''));
      document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
      state.status.textContent = `Downloaded ${plural(files.length, 'file')} in one ZIP.`;
    } catch (error) { if (current()) state.status.textContent = error.message; }
    finally { if (download === controller) download = null; updateControls(); }
  }
  async function loadFiles(state) {
    if (state.loading || state.complete) return;
    const scope = revision, owner = deviceId(); state.loading = true; state.more.disabled = true; state.status.textContent = 'Loading files…';
    try {
      const page = await api('/api/archive-files?' + new URLSearchParams({ deviceId: owner, folder: state.folder.folder_id, ...(state.cursor ? { cursor: state.cursor } : {}) }));
      if (scope !== revision || owner !== deviceId()) return;
      const known = new Set(state.files.map(f => f.object_key));
      for (const file of page.files) {
        if (known.has(file.object_key)) continue;
        const index = state.files.length; state.files.push(file); known.add(file.object_key);
        const row = element('div', 'archive-file-row'), label = element('label', 'archive-file-select'), check = element('input'); check.type = 'checkbox';
        const filename = archiveFileName(file, index); check.setAttribute('aria-label', 'Select ' + filename);
        check.addEventListener('change', () => { if (check.checked) state.selected.add(file.object_key); else state.selected.delete(file.object_key); controls(state); });
        label.append(check, element('span', '', filename));
        const link = element('a', '', 'Download file'); link.href = '/api/archive?' + new URLSearchParams({ key: file.object_key });
        const info = element('p', 'small', `${file.sample_count.toLocaleString()} ${file.sample_count === 1 ? 'entry' : 'entries'} · ${size(file.compressed_bytes)} · Archived ${date(file.created_at)}`);
        const hash = element('p', 'archive-checksum small', 'SHA-256 ' + file.sha256);
        row.append(label, link, info, hash); state.list.append(row);
      }
      state.cursor = page.nextCursor; state.complete = !state.cursor; state.more.hidden = state.complete; state.more.textContent = 'Load more files';
      state.status.textContent = state.files.length ? `${state.files.length} files loaded${state.cursor ? '; more available.' : '.'}` : 'No saved files yet. Continue archiving to save the selected entries.';
      controls(state);
    } catch (error) { if (scope === revision && owner === deviceId()) { state.status.textContent = error.message; state.more.hidden = false; state.more.textContent = 'Retry loading files'; } }
    finally { state.loading = false; state.more.disabled = false; }
  }
  function renderFolder(folder) {
    if (states.has(folder.folder_id)) return;
    const details = element('details', 'archive-folder'), summary = element('summary'), body = element('div', 'archive-folder-body');
    summary.append(element('span', 'archive-folder-title', folder.label), element('span', 'small archive-folder-count', `${plural(folder.file_count, 'file')} · ${folder.sample_count.toLocaleString()} ${folder.sample_count === 1 ? 'entry' : 'entries'}${folder.status === 'complete' ? '' : ' · In progress'}`),
      element('span', 'small archive-folder-meta', `Date range: ${date(folder.range_from)} – ${date(folder.range_to)}`),
      element('span', 'small archive-folder-meta', `${folder.status === 'complete' ? 'Date archived' : folder.file_count ? 'Last saved' : 'Started'}: ${date(folder.file_count ? folder.archived_at : folder.started_at)}`));
    const toolbar = element('div', 'archive-folder-actions'), downloadAll = element('button', 'primary', 'Download all files'), downloadSelected = element('button', '', 'Download selected (0)');
    const selectLabel = element('label', 'check-label'), selectAll = element('input'); selectAll.type = 'checkbox'; selectAll.setAttribute('aria-label', 'Select all loaded files in ' + folder.label);
    selectLabel.append(selectAll, element('span', '', 'Select all loaded files'));
    toolbar.append(downloadAll, downloadSelected, selectLabel);
    if (folder.status !== 'complete' && folder.archive_id) {
      const resume = element('button', 'archive-resume', 'Continue archiving'); resume.addEventListener('click', () => continueArchive({ archive_id: folder.archive_id, label: folder.label, status: folder.status, selected_count: folder.selected_count, archived_count: folder.archived_count })); toolbar.append(resume);
    }
    const selection = element('p', 'small'), status = element('p', 'small'), list = element('div', 'archive-files'), next = element('button', '', 'Load more files');
    status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); next.hidden = true;
    body.append(toolbar, selection, status, list, next); details.append(summary, body); root.append(details);
    const state = { folder, details, files: [], selected: new Set(), cursor: null, complete: false, loading: false, list, status, selection, selectAll, downloadAll, downloadSelected, more: next }; states.set(folder.folder_id, state);
    details.addEventListener('toggle', () => { if (details.open && !state.files.length && !state.complete) loadFiles(state); });
    next.addEventListener('click', () => loadFiles(state)); downloadAll.addEventListener('click', () => downloadFiles(state, false)); downloadSelected.addEventListener('click', () => downloadFiles(state, true));
    selectAll.addEventListener('change', () => { for (const file of state.files) { if (selectAll.checked) state.selected.add(file.object_key); else state.selected.delete(file.object_key); } for (const check of list.querySelectorAll('input')) check.checked = selectAll.checked; controls(state); });
    controls(state);
  }
  async function load(replace) {
    if (replace) reset();
    if (loading) return;
    const scope = revision, owner = deviceId(); loading = true; more.disabled = true;
    if (replace) root.textContent = 'Loading archives…';
    try {
      const page = await api('/api/archive-folders?' + new URLSearchParams({ deviceId: owner, ...(cursor ? { cursor } : {}) }));
      if (scope !== revision || owner !== deviceId()) return;
      if (replace) root.replaceChildren();
      for (const folder of page.folders) renderFolder(folder);
      cursor = page.nextCursor; more.hidden = !cursor; more.textContent = 'Load more archives';
      if (!states.size) root.textContent = 'No archives yet. Create a labeled archive above or wait for automatic retention archiving.';
    } catch (error) {
      if (scope === revision && owner === deviceId()) { if (replace) root.textContent = error.message; more.hidden = false; more.textContent = 'Retry loading archives'; }
    } finally { if (scope === revision) { loading = false; more.disabled = false; } }
  }
  more.addEventListener('click', () => load(!states.size));
  return { load, reset };
}
