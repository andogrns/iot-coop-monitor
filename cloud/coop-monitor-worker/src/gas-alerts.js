// Discord notification when a device's firmware GAS_WARNING flag has been continuous for an hour.
// Runs from its own cron. Reads only the last ~70 minutes of readings; writes D1 only when a message is sent.
import { unpackSample } from './protocol.js';

export const GAS_ALERT_CRON = '*/5 * * * *';
const MINUTE = 60000;
const MAX_GAP_MS = 10 * MINUTE; // a longer gap between readings breaks continuity (warning cannot be established)
const STALE_MS = 10 * MINUTE; // newest reading older than this: device offline, leave alert state unchanged
const DISCORD_API = 'https://discord.com/api/v10';
const iso = ms => new Date(ms).toISOString();
const stmt = (db, sql, ...values) => db.prepare(sql).bind(...values);
const isWarning = r => typeof r.status === 'string' && r.status.includes('GAS_WARNING');
const unix = ms => Math.floor(ms / 1000);
const stateKey = deviceId => `gas_alert:${deviceId}`;

export function alertAfterMs(env) {
  const minutes = Number(env.GAS_ALERT_AFTER_MINUTES ?? 60);
  return (Number.isFinite(minutes) && minutes >= 5 ? minutes : 60) * MINUTE;
}

// Pure evaluation of readings (ascending by time) against the stored episode, if any.
export function evaluate(readings, stored, now, afterMs) {
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
  if (sameEpisode) return { action: 'none', reason: 'already_notified' };
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

async function discord(env, fetchImpl, path, init = {}) {
  const response = await fetchImpl(DISCORD_API + path, { ...init, headers: { authorization: `Bot ${env.DISCORD_BOT_TOKEN}`, 'content-type': 'application/json', 'user-agent': 'DiscordBot (coop-monitor-worker, 1.0)', ...init.headers } });
  if (!response.ok) throw new Error(`discord_${response.status}`);
  return response.json();
}

// Explicit DISCORD_CHANNEL_ID wins; otherwise the first server's system channel, then its first text channel.
export async function discordChannel(env, fetchImpl = fetch) {
  if (env.DISCORD_CHANNEL_ID) return env.DISCORD_CHANNEL_ID;
  const guilds = await discord(env, fetchImpl, '/users/@me/guilds');
  if (!guilds.length) throw new Error('discord_bot_not_in_server');
  const guild = await discord(env, fetchImpl, `/guilds/${guilds[0].id}`);
  if (guild.system_channel_id) return guild.system_channel_id;
  const text = (await discord(env, fetchImpl, `/guilds/${guilds[0].id}/channels`)).filter(c => c.type === 0).sort((a, b) => a.position - b.position);
  if (!text.length) throw new Error('discord_no_text_channel');
  return text[0].id;
}

export const name = device => device.label && device.label !== device.device_id ? `${device.label} (${device.device_id})` : device.device_id;
const mv = value => Number.isFinite(value) ? `${Math.round(value)} mV` : 'unavailable';
export function warningMessage(device, decision, afterMs) {
  const r = decision.latest, hours = afterMs / 3600000;
  const duration = hours === 1 ? '1 hour' : afterMs % 3600000 ? `${afterMs / MINUTE} minutes` : `${hours} hours`;
  return [
    `⚠️ **Gas warning ongoing for over ${duration}** · ${name(device)}`,
    `Warning ${decision.sinceIsLowerBound ? 'continuous since at least' : 'started'} <t:${unix(decision.since)}:f> (<t:${unix(decision.since)}:R>).`,
    `Latest MQ-135 reading <t:${unix(r.time)}:t>: ${mv(r.mqMv)} at the ADC input${Number.isFinite(r.mqRatio) ? ` (${r.mqRatio.toFixed(2)}× baseline)` : ''}, warning threshold ${mv(r.mqThresholdMv)}.`,
    'MQ-135 is a relative gas response, not calibrated ammonia ppm. Check ventilation and litter in the coop.',
  ].join('\n');
}
export const clearedMessage = (device, decision) => decision.action === 'clear'
  ? `✅ Gas warning no longer continuous · ${name(device)} · latest status \`${decision.latest.status}\` <t:${unix(decision.latest.time)}:t>.`
  : `✅ Previous gas warning episode ended · ${name(device)} (a new one follows).`;

export async function send(env, fetchImpl, content) {
  const channel = await discordChannel(env, fetchImpl);
  await discord(env, fetchImpl, `/channels/${channel}/messages`, { method: 'POST', body: JSON.stringify({ content, allowed_mentions: { parse: [] } }) });
}

export async function gasAlerts(env, { fetchImpl = fetch, now = Date.now() } = {}) {
  if (!env.DISCORD_BOT_TOKEN) return { status: 'discord_not_configured' };
  const afterMs = alertAfterMs(env), results = [];
  const devices = (await env.DB.prepare('SELECT device_id,label FROM devices ORDER BY device_id').all()).results;
  for (const device of devices) {
    try {
      const row = await stmt(env.DB, 'SELECT value_json FROM system_state WHERE key=?', stateKey(device.device_id)).first();
      const stored = row ? JSON.parse(row.value_json) : null;
      const decision = evaluate(await recentReadings(env, device.device_id, now - afterMs - 2 * MAX_GAP_MS), stored, now, afterMs);
      if (decision.action === 'clear' || decision.clearFirst) {
        await send(env, fetchImpl, clearedMessage(device, decision));
        await stmt(env.DB, 'DELETE FROM system_state WHERE key=?', stateKey(device.device_id)).run();
      }
      if (decision.action === 'notify') {
        await send(env, fetchImpl, warningMessage(device, decision, afterMs));
        const value = { since: decision.since, latestAt: decision.latest.time, notifiedAt: now };
        await stmt(env.DB, 'INSERT INTO system_state(key,value_json,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at', stateKey(device.device_id), JSON.stringify(value), iso(now)).run();
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
