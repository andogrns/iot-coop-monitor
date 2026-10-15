import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { allArchiveFiles } from '../public/archive-library.js';
import { createZip, crc32, verifiedArchiveZip, archiveZipName } from '../public/archive-zip.js';
const file = n => ({ object_key: 'part-' + n, sha256: 'a'.repeat(64) });

test('download all follows every file page beyond the visible page', async () => {
  const paths = [], files = await allArchiveFiles(async path => {
    const q = new URL('https://test' + path).searchParams; paths.push(q);
    return q.has('cursor') ? { files: [file(101)], nextCursor: null } : { files: Array.from({ length: 100 }, (_, i) => file(i + 1)), nextCursor: 'next' };
  }, 'coop', 'manual:home');
  assert.equal(files.length, 101); assert.equal(paths[1].get('cursor'), 'next'); assert.equal(paths[1].get('folder'), 'manual:home');
});
test('listing failures, duplicated/repeated pages and device cancellation prevent a partial all-files download', async () => {
  await assert.rejects(allArchiveFiles(async () => { throw Error('network'); }, 'coop', 'manual:home'), /network/);
  await assert.rejects(allArchiveFiles(async () => ({ files: [file(1)], nextCursor: 'repeat' }), 'coop', 'manual:home'), /file list changed/);
  await assert.rejects(allArchiveFiles(async () => ({ files: [], nextCursor: 'repeat' }), 'coop', 'manual:home'), /could not be completed/);
  await assert.rejects(allArchiveFiles(async () => ({ files: [file(1)], nextCursor: null }), 'coop', 'manual:home', () => false), /cancelled/);
});
test('ZIP stores original bytes with CRC, UTF-8 names, central directory and safe unique filenames', async () => {
  const bytes = new TextEncoder().encode('123456789'); assert.equal(crc32(bytes), 0xcbf43926);
  const blob = createZip([{ name: 'part-0001.json.gz', bytes }, { name: 'téšt.json.gz', bytes: new Uint8Array([0, 1, 255]) }]);
  const buffer = await blob.arrayBuffer(), view = new DataView(buffer);
  assert.equal(blob.type, 'application/zip'); assert.equal(view.getUint32(0, true), 0x04034b50); assert.equal(view.getUint16(6, true), 0x800);
  assert.equal(view.getUint32(14, true), 0xcbf43926); assert.equal(view.getUint16(8, true), 0);
  const end = buffer.byteLength - 22; assert.equal(view.getUint32(end, true), 0x06054b50); assert.equal(view.getUint16(end + 10, true), 2);
  assert.equal(view.getUint32(view.getUint32(end + 16, true), true), 0x02014b50);
  assert.throws(() => createZip([{ name: '../bad', bytes }]), /filename/);
  assert.throws(() => createZip([{ name: 'same', bytes }, { name: 'same', bytes }]), /filename/);
  assert.equal(archiveZipName('Home Testing Session'), 'Home Testing Session.zip'); assert.equal(archiveZipName('Week / 1 <coop>'), 'Week _ 1 _coop_.zip');
});
test('ZIP verifies each selected file SHA-256, retains only the supplied files and publishes no partial result on failure', async () => {
  const data = [new Uint8Array([1, 2, 3]), new Uint8Array([7, 8])];
  const files = data.map((bytes, index) => ({ ...file(index), sha256: createHash('sha256').update(bytes).digest('hex'), created_at: '2026-10-13T00:00:00Z' }));
  const reads = [], progress = [];
  const zip = await verifiedArchiveZip([files[1]], { readFile: async f => { reads.push(f.object_key); return data[1]; }, progress: n => progress.push(n) });
  assert.deepEqual(reads, ['part-1']); assert.deepEqual(progress, [1]);
  const buffer = await zip.arrayBuffer(); assert.equal(new DataView(buffer).getUint16(buffer.byteLength - 12, true), 1);
  await assert.rejects(verifiedArchiveZip(files, { readFile: async () => new Uint8Array([99]) }), /verification failed/);
  await assert.rejects(verifiedArchiveZip(files, { readFile: async () => { throw Error('unavailable'); } }), /unavailable/);
  await assert.rejects(verifiedArchiveZip(files, { readFile: async () => data[0], current: () => false }), /cancelled/);
  await assert.rejects(verifiedArchiveZip([], { readFile: async () => data[0] }), /No saved files/);
});
