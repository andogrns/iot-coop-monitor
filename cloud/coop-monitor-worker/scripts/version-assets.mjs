// Rewrites the ?v= cache-busting query on dashboard assets to a hash of each file's content.
// Run from cloud/coop-monitor-worker after changing anything in public/:  node scripts/version-assets.mjs
// Files are processed in dependency order, so an importer's hash includes its imports' new versions.
// Every importer gets the same URL for a module, which keeps one shared instance of ui.js/format.js.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const root = new URL('../public/', import.meta.url);
const ORDER = ['csv.js', 'archive-zip.js', 'format.js', 'ui.js', 'trends.js', 'history-export.js', 'history-selection.js',
  'manual-archive.js', 'archive-library.js', 'console.js', 'alert-settings.js', 'alerts.js', 'app.js', 'style.css', 'history.css', 'console.css', 'archives.css', 'index.html'];
const versions = new Map();
let changed = 0;
for (const name of ORDER) {
  const url = new URL(name, root), before = await readFile(url, 'utf8');
  // './name.js' or './name.js?v=old' in imports; '/name.ext' or '/name.ext?v=old' in index.html.
  const after = before.replace(/(['"])(\.\/|\/)([a-z0-9-]+\.(?:js|css))(?:\?v=[A-Za-z0-9-]+)?\1/g, (match, quote, prefix, file) =>
    versions.has(file) ? `${quote}${prefix}${file}?v=${versions.get(file)}${quote}` : match);
  if (after !== before) { await writeFile(url, after); changed++; }
  versions.set(name, createHash('sha256').update(after).digest('hex').slice(0, 12));
}
console.log(`Asset versions updated in ${changed} file(s).`);
