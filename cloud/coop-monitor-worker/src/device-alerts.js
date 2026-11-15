// Discord notification when a device stops exchanging data, and once more when it is back.
// Runs on the gas-alert cron. Reads the latest stored device state; writes D1 only when a message is sent.
import { send, name } from './gas-alerts.js';
import { capacity } from './storage.js';

const MINUTE = 60000;
const BACK_ONLINE_MS = 5 * MINUTE; // a state received this recently counts as "back"
const stmt = (db, sql, ...values) => db.prepare(sql).bind(...values);
const unix = ms => Math.floor(ms / 1000);
const iso = ms => new Date(ms).toISOString();
const stateKey = deviceId => `offline_alert:${deviceId}`;

export function offlineAfterMs(env) {
  const minutes = Number(env.OFFLINE_ALERT_AFTER_MINUTES ?? 20);
  return (Number.isFinite(minutes) && minutes >= 10 ? minutes : 20) * MINUTE;
}

const RESET_TEXT = {
  power_on: 'power-on (power was cut or the cable reconnected)', brownout: 'brownout (supply voltage dipped)',
  panic: 'firmware crash', task_watchdog: 'watchdog (firmware stuck)', interrupt_watchdog: 'watchdog (firmware stuck)',
  watchdog: 'watchdog', software: 'software restart (command or firmware recovery)', external: 'reset pin / button',
  usb: 'USB reset', deep_sleep: 'wake from sleep',
};
export const resetText = reason => RESET_TEXT[reason] ?? reason ?? 'not reported';
const minutes = ms => { const m = Math.round(ms / MINUTE); return m < 120 ? `${m} min` : `${(m / 60).toFixed(1)} h`; };

// Pure decision from the latest stored state and any stored alert.
export function evaluateOffline(state, stored, now, afterMs) {
  const seen = state ? Date.parse(state.receivedAt) : NaN;
  if (!Number.isFinite(seen)) return { action: 'none', reason: 'never_reported' };
  if (!stored && now - seen > afterMs) return { action: 'offline', seen };
  if (stored && now - seen <= BACK_ONLINE_MS) return { action: 'online', seen, restarted: state.bootId !== stored.bootId };
  return { action: 'none', reason: stored ? 'still_offline' : 'online' };
}

export function offlineMessage(device, state, decision) {
  const h = state.health ?? {};
  const details = [`last status \`${state.status ?? 'unknown'}\``];
  if (Number.isFinite(h.rssiDbm)) details.push(`Wi-Fi signal ${h.rssiDbm} dBm`);
  if (Number.isFinite(h.queuePending)) details.push(`${h.queuePending} readings were queued`);
  return [
    `📴 **No data from the coop monitor** · ${name(device)}`,
    `Last contact <t:${unix(decision.seen)}:f> (<t:${unix(decision.seen)}:R>); ${details.join(', ')}.`,
    'Check power, the Wi-Fi modem and the internet connection. The device keeps readings in its queue (and SD backup, if fitted) while offline.',
  ].join('\n');
}

export function onlineMessage(device, state, stored, decision, now) {
  const h = state.health ?? {};
  const lines = [`📶 **Coop monitor back online** · ${name(device)} · silent for about ${minutes(now - stored.lastSeen)} before this message.`];
  lines.push(decision.restarted
    ? `The device restarted while offline. Reset reason: ${resetText(h.resetReason)}.`
    : 'Same boot as before (no restart): the connection dropped, the device kept running.');
  if (Number.isFinite(h.queuePending) && h.queuePending > 0) lines.push(`${h.queuePending} queued readings are still uploading.`);
  return lines.join('\n');
}

export async function deviceAlerts(env, { fetchImpl = fetch, now = Date.now() } = {}) {
  if (!env.DISCORD_BOT_TOKEN) return { status: 'discord_not_configured' };
  // While uploads are paused the backend stores no new state, so silence would be misread as offline.
  if ((await capacity(env)).paused) return { status: 'uploads_paused' };
  const afterMs = offlineAfterMs(env), results = [];
  const devices = (await env.DB.prepare('SELECT device_id,label,writes_paused FROM devices ORDER BY device_id').all()).results;
  for (const device of devices) {
    if (device.writes_paused === 1) { results.push({ deviceId: device.device_id, action: 'none', reason: 'owner_pause' }); continue; }
    try {
      const block = await stmt(env.DB, 'SELECT state_json FROM reading_windows WHERE device_id=? AND state_json IS NOT NULL ORDER BY block_id DESC LIMIT 1', device.device_id).first();
      const state = block ? JSON.parse(block.state_json) : null;
      const row = await stmt(env.DB, 'SELECT value_json FROM system_state WHERE key=?', stateKey(device.device_id)).first();
      const stored = row ? JSON.parse(row.value_json) : null;
      const decision = evaluateOffline(state, stored, now, afterMs);
      if (decision.action === 'offline') {
        await send(env, fetchImpl, offlineMessage(device, state, decision));
        await stmt(env.DB, 'INSERT INTO system_state(key,value_json,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at',
          stateKey(device.device_id), JSON.stringify({ lastSeen: decision.seen, bootId: state.bootId, notifiedAt: now }), iso(now)).run();
      } else if (decision.action === 'online') {
        await send(env, fetchImpl, onlineMessage(device, state, stored, decision, now));
        await stmt(env.DB, 'DELETE FROM system_state WHERE key=?', stateKey(device.device_id)).run();
      }
      results.push({ deviceId: device.device_id, action: decision.action, reason: decision.reason });
    } catch (error) {
      // Not recorded as sent, so the next run retries. Never log the token or response bodies.
      console.error('device_alert_failed', device.device_id, String(error?.message ?? error).slice(0, 80));
      results.push({ deviceId: device.device_id, action: 'failed' });
    }
  }
  return { status: 'checked', results };
}
