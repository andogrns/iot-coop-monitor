import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { COMMANDS, SD_COMMANDS_FIRMWARE, supportsSdCommands } from '../public/console.js';
import { COMMAND_TYPES } from '../src/protocol.js';

test('every dashboard command is allowlisted by the Worker and present in the hidden select', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const options = [...html.match(/<select id="command"[^>]*>(.*?)<\/select>/s)[1].matchAll(/<option>([A-Z_]+)<\/option>/g)].map(m => m[1]);
  assert.deepEqual([...options].sort(), Object.keys(COMMANDS).sort());
  assert.deepEqual([...COMMAND_TYPES].sort(), Object.keys(COMMANDS).sort());
});

test('the firmware allowlist matches the Worker allowlist', async () => {
  const header = await readFile(new URL('../../../firmware/coop_monitor/dashboard_protocol.h', import.meta.url), 'utf8');
  const names = [...header.match(/static const char \*names\[\] = \{(.*?)\};/s)[1].matchAll(/"([A-Z_]*)"/g)].map(m => m[1]).filter(Boolean);
  assert.deepEqual(names.sort(), [...COMMAND_TYPES].sort());
});

test('SD commands are offered only to firmware that can run them', () => {
  assert.equal(SD_COMMANDS_FIRMWARE, 'cloudflare-1.2.0');
  for (const v of ['cloudflare-1.2.0', 'cloudflare-1.2.1', 'cloudflare-1.10.0', 'cloudflare-2.0.0']) assert.equal(supportsSdCommands(v), true, v);
  for (const v of ['cloudflare-1.1.0', 'cloudflare-1.0.4', 'cloudflare-0.9.9', 'unknown', '', null, undefined, 'cloudflare-1.2', 'other-9.9.9']) assert.equal(supportsSdCommands(v), false, String(v));
  assert.deepEqual(Object.entries(COMMANDS).filter(([, c]) => c.group === 'storage').map(([t]) => t), ['SD_STATUS', 'SD_TAIL', 'SD_FLUSH', 'SD_MOUNT', 'SD_EJECT']);
});
