// Alert message when a device's firmware GAS_WARNING flag has been continuous for the dashboard-set wait time
// (Settings > Gas warning alerts; default GAS_ALERT_AFTER_MINUTES, 60). Optional reminders while it continues and
// an optional message when it ends. Runs from its own cron. Reads only the recent readings it needs; writes D1 only
// when a message is sent (plus the delivery result, see notify.js).
import { unpackSample } from './protocol.js';
import { buildMessage, deviceName, messageVariables } from '../public/alert-settings.js';
import { channelReady, deliver, discordChannel, loadAlertSettings } from './notify.js';

export const GAS_ALERT_CRON = '*/5 * * * *';
const MINUTE = 60000;
const MAX_GAP_MS = 10 * MINUTE; // a longer gap between readings breaks continuity (warning cannot be established)
const STALE_MS = 10 * MINUTE; // newest reading older than this: device offline, leave alert state unchanged
const REMIND_SLACK_MS = MINUTE; // cron runs drift by seconds; a reminder due within a minute goes out now
const iso = ms => new Date(ms).toISOString();
const stmt = (db, sql, ...values) => db.prepare(sql).bind(...values);
const isWarning = r => typeof r.status === 'string' && r.status.includes('GAS_WARNING');
const stateKey = deviceId => `gas_alert:${deviceId}`;

export { discordChannel };
export const name = device => deviceName(device);

// Pure evaluation of readings (ascending by time) against the stored episode, if any.
export function evaluate(readings, stored, now, afterMs, remindMs = 0) {
  const latest = readings.at(-1);
  if (!latest || now - latest.time > STALE_MS) return { action: 'none', reason: 'no_recent_readings' };
  const windowStart = now - afterMs - MAX_GAP_MS;
  let start = null, reachesBoundary = false;
  if (isWarning(latest)) {
    let i = readings.length - 1;
    while (i > 0 && isWarning(readings[i - 1]) && readings[i].time - readings[i - 1].time <= MAX_GAP_MS) i--;
    start = readings[i].time;
    reachesBoundary = i === 0 && readings[0].time - windowStart <= MAX_GAP_MS;
  }
  const sameEpisode = stored && start !== null && (reachesBoundary || start <= stored.latestAt);
  const ended = stored && !sameEpisode;
  if (start === null) return ended ? { action: 'clear', latest } : { action: 'none', reason: 'no_warning' };
  if (sameEpisode) {
    const lastSent = stored.lastSentAt ?? stored.notifiedAt;
    if (remindMs > 0 && now - lastSent >= remindMs - REMIND_SLACK_MS) return { action: 'remind', since: stored.since, sinceIsLowerBound: Boolean(stored.sinceIsLowerBound), latest };
    return { action: 'none', reason: 'already_notified' };
  }
  if (latest.time - start >= afterMs) return { action: 'notify', clearFirst: Boolean(ended), since: start, sinceIsLowerBound: reachesBoundary, latest };
  return ended ? { action: 'clear', latest } : { action: 'none', reason: 'warning_under_threshold', warningMs: latest.time - start };
}

async function recentReadings(env, deviceId, from) {
  const rows = (await stmt(env.DB, "SELECT boot_id,anchor_ms,data_json FROM reading_windows WHERE device_id=? AND block_id>=? AND data_json<>'[]' ORDER BY block_id", deviceId, iso(from - MINUTE)).all()).results;
  return rows.flatMap(row => JSON.parse(row.data_json).map(t => unpackSample(t, deviceId, row.boot_id, row.anchor_ms)))
    .map(r => ({ ...r, time: Date.parse(r.estimatedAt) }))
    .filter(r => r.time >= from)
    .sort((a, b) => a.time - b.time || a.seq - b.seq);
}

// Message text for a decision. The ended message uses the stored episode start.
export function warningMessage(device, decision, settings, now) {
  const vars = messageVariables({ device, reading: decision.latest, since: decision.since, sinceIsLowerBound: decision.sinceIsLowerBound, afterMinutes: settings.afterMinutes, now });
  return buildMessage(settings.warningTemplate, vars, { mention: settings.mention });
}
export function endedMessage(device, decision, stored, settings, now) {
  const vars = messageVariables({ device, reading: decision.latest, since: stored?.since ?? null, sinceIsLowerBound: Boolean(stored?.sinceIsLowerBound), afterMinutes: settings.afterMinutes, now });
  return buildMessage(settings.endedTemplate, vars);
}

const saveEpisode = (env, deviceId, value, now) => stmt(env.DB, 'INSERT INTO system_state(key,value_json,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at', stateKey(deviceId), JSON.stringify(value), iso(now)).run();

export async function gasAlerts(env, { fetchImpl = fetch, now = Date.now() } = {}) {
  const { settings } = await loadAlertSettings(env);
  if (!settings.enabled) return { status: 'disabled' };
  if (!channelReady(env, settings)) return { status: `${settings.channel}_not_configured` };
  const afterMs = settings.afterMinutes * MINUTE, remindMs = settings.remindEveryMinutes * MINUTE, results = [];
  const devices = (await env.DB.prepare('SELECT device_id,label FROM devices ORDER BY device_id').all()).results;
  for (const device of devices) {
    try {
      const row = await stmt(env.DB, 'SELECT value_json FROM system_state WHERE key=?', stateKey(device.device_id)).first();
      const stored = row ? JSON.parse(row.value_json) : null;
      const decision = evaluate(await recentReadings(env, device.device_id, now - afterMs - 2 * MAX_GAP_MS), stored, now, afterMs, remindMs);
      if (decision.action === 'clear' || decision.clearFirst) {
        if (settings.sendEnded) await deliver(env, fetchImpl, endedMessage(device, decision, stored, settings, now), settings, { kind: 'ended', now });
        await stmt(env.DB, 'DELETE FROM system_state WHERE key=?', stateKey(device.device_id)).run();
      }
      if (decision.action === 'notify') {
        await deliver(env, fetchImpl, warningMessage(device, decision, settings, now), settings, { kind: 'warning', ping: true, now });
        await saveEpisode(env, device.device_id, { since: decision.since, sinceIsLowerBound: decision.sinceIsLowerBound, latestAt: decision.latest.time, notifiedAt: now, lastSentAt: now }, now);
      }
      if (decision.action === 'remind') {
        await deliver(env, fetchImpl, warningMessage(device, decision, settings, now), settings, { kind: 'reminder', ping: true, now });
        await saveEpisode(env, device.device_id, { ...stored, latestAt: decision.latest.time, lastSentAt: now }, now);
      }
      results.push({ deviceId: device.device_id, action: decision.action, reason: decision.reason });
    } catch (error) {
      // Not recorded as sent, so the next run retries. Never log the token or response bodies.
      console.error('gas_alert_failed', device.device_id, String(error?.message ?? error).slice(0, 80));
      results.push({ deviceId: device.device_id, action: 'failed' });
    }
  }
  return { status: 'checked', results };
}
