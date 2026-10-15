const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
export function createZip(files) {
  if (files.length > 65535) throw Error('Too many files for one ZIP. Download a smaller selection.');
  const local = [], central = [], names = new Set(); let offset = 0, directorySize = 0;
  for (const file of files) {
    if (!file.name || /[\\/\u0000]/.test(file.name) || names.has(file.name)) throw Error('Invalid or duplicate ZIP filename.');
    names.add(file.name);
    const name = new TextEncoder().encode(file.name), size = file.bytes.byteLength;
    if (name.length > 65535 || size > 0xffffffff || offset + size + name.length + 30 > 0xffffffff) throw Error('ZIP is too large. Download a smaller selection.');
    const date = new Date(file.modifiedAt ?? '1980-01-01T00:00:00Z'), year = Math.min(2107, Math.max(1980, date.getUTCFullYear()));
    const time = (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | Math.floor(date.getUTCSeconds() / 2);
    const day = ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate(), crc = crc32(file.bytes);
    const header = new Uint8Array(30 + name.length), h = new DataView(header.buffer);
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x800, true);
    h.setUint16(10, time, true); h.setUint16(12, day, true); h.setUint32(14, crc, true);
    h.setUint32(18, size, true); h.setUint32(22, size, true); h.setUint16(26, name.length, true); header.set(name, 30);
    const entry = new Uint8Array(46 + name.length), c = new DataView(entry.buffer);
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x800, true);
    c.setUint16(12, time, true); c.setUint16(14, day, true); c.setUint32(16, crc, true);
    c.setUint32(20, size, true); c.setUint32(24, size, true); c.setUint16(28, name.length, true);
    c.setUint32(42, offset, true); entry.set(name, 46);
    local.push(header, file.bytes); central.push(entry); offset += header.byteLength + size; directorySize += entry.byteLength;
  }
  if (offset + directorySize > 0xffffffff) throw Error('ZIP is too large. Download a smaller selection.');
  const end = new Uint8Array(22), e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
  e.setUint32(12, directorySize, true); e.setUint32(16, offset, true);
  return new Blob([...local, ...central, end], { type: 'application/zip' });
}
export const archiveZipName = label => (label.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '').slice(0, 100) || 'Archive') + '.zip';
export const archiveFileName = (file, index) => `part-${String(index + 1).padStart(4, '0')}-${file.sha256.slice(0, 12)}.json.gz`;
export async function verifiedArchiveZip(files, { readFile, progress = () => {}, current = () => true }) {
  if (!files.length) throw Error('No saved files to download.');
  const entries = [];
  for (const [index, file] of files.entries()) {
    if (!current()) throw Error('Download cancelled.');
    const bytes = new Uint8Array(await readFile(file));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const hash = [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, '0')).join('');
    if (!current()) throw Error('Download cancelled.');
    if (hash !== file.sha256) throw Error('File verification failed. No ZIP was downloaded; try again.');
    entries.push({ name: file.filename ?? archiveFileName(file, index), bytes, modifiedAt: file.created_at });
    progress(index + 1, files.length);
  }
  return createZip(entries);
}
