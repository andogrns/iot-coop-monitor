// Alert delivery: dashboard-editable settings (D1 system_state 'alert_settings'), one sender per service,
// and the last delivery result (system_state 'alert_delivery') shown in the Settings tab.
// Only Discord exists today; add a sender to SENDERS and a name to ALERT_CHANNELS (public/alert-settings.js).
import { ApiError, object, integer, unpackSample } from './protocol.js';
import { ALERT_CHANNELS, CHECK_EVERY_MINUTES, TEMPLATE_VARIABLES, buildMessage, checkAlertSettings, defaultAlertSettings, messageVariables } from '../public/alert-settings.js';

const DISCORD_API = 'https://discord.com/api/v10';
const SETTINGS_KEY = 'alert_settings', DELIVERY_KEY = 'alert_delivery';
const stmt = (db, sql, ...values) => db.prepare(sql).bind(...values);
const iso = ms => new Date(ms).toISOString();
const UPSERT = 'INSERT INTO system_state(key,value_json,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at';

// Wait time when nothing has been saved from the dashboard yet (the original fixed setting).
export function envAfterMinutes(env) {
  const minutes = Number(env.GAS_ALERT_AFTER_MINUTES ?? 60);
  return Number.isSafeInteger(minutes) && minutes >= 5 && minutes <= 720 ? minutes : 60;
}

export async function loadAlertSettings(env) {
  const row = await stmt(env.DB, 'SELECT value_json,updated_at FROM system_state WHERE key=?', SETTINGS_KEY).first();
  const defaults = defaultAlertSettings(envAfterMinutes(env));
  if (!row) return { revision: 0, settings: defaults, savedAt: null };
  const stored = JSON.parse(row.value_json);
  // Fields added in later versions fall back to their defaults instead of failing the alert run.
  const { settings } = checkAlertSettings({ ...defaults, ...stored.settings });
  return { revision: stored.revision, settings: settings ?? defaults, savedAt: row.updated_at };
}

// Optimistic concurrency like device config: a stale expectedRevision is rejected, not overwritten.
export async function saveAlertSettings(env, body, now = Date.now()) {
  const v = object(body, 'request body'), expected = integer(v.expectedRevision, 'expectedRevision', 0);
  const { settings, errors } = checkAlertSettings(v.settings);
  if (!settings) throw new ApiError(400, 'invalid_alert_settings', Object.values(errors)[0]);
  const value = JSON.stringify({ revision: expected + 1, settings });
  const result = expected === 0
    ? await stmt(env.DB, 'INSERT INTO system_state(key,value_json,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO NOTHING', SETTINGS_KEY, value, iso(now)).run()
    : await stmt(env.DB, "UPDATE system_state SET value_json=?,updated_at=? WHERE key=? AND json_extract(value_json,'$.revision')=?", value, iso(now), SETTINGS_KEY, expected).run();
  if (!result.meta.changes) throw new ApiError(409, 'alert_settings_changed', 'Alert settings were changed elsewhere. Reload them and try again.');
  return { revision: expected + 1, settings, savedAt: iso(now) };
}

// ---- Discord ----
async function discord(env, fetchImpl, path, init = {}) {
  const response = await fetchImpl(DISCORD_API + path, { ...init, headers: { authorization: `Bot ${env.DISCORD_BOT_TOKEN}`, 'content-type': 'application/json', 'user-agent': 'DiscordBot (coop-monitor-worker, 1.0)', ...init.headers } });
  if (!response.ok) throw new Error(`discord_${response.status}`);
  return response.json();
}

// Channel ID from the dashboard wins, then the DISCORD_CHANNEL_ID var, then the first server's system channel,
// then its first text channel.
export async function discordChannel(env, fetchImpl = fetch, channelId = '') {
  if (channelId) return channelId;
  if (env.DISCORD_CHANNEL_ID) return env.DISCORD_CHANNEL_ID;
  const guilds = await discord(env, fetchImpl, '/users/@me/guilds');
  if (!guilds.length) throw new Error('discord_bot_not_in_server');
  const guild = await discord(env, fetchImpl, `/guilds/${guilds[0].id}`);
  if (guild.system_channel_id) return guild.system_channel_id;
  const text = (await discord(env, fetchImpl, `/guilds/${guilds[0].id}/channels`)).filter(c => c.type === 0).sort((a, b) => a.position - b.position);
  if (!text.length) throw new Error('discord_no_text_channel');
  return text[0].id;
}

// ping: whether a mention in the text may notify (never for tests or offline alerts).
async function sendDiscord(env, fetchImpl, content, settings, { ping = false } = {}) {
  const channel = await discordChannel(env, fetchImpl, settings.discordChannelId);
  const allowed = ping && settings.mention !== 'none' ? { parse: ['everyone'] } : { parse: [] };
  await discord(env, fetchImpl, `/channels/${channel}/messages`, { method: 'POST', body: JSON.stringify({ content, allowed_mentions: allowed }) });
  return { channelId: channel };
}

const SENDERS = { discord: { ready: env => Boolean(env.DISCORD_BOT_TOKEN), send: sendDiscord } };
export const channelReady = (env, settings) => Boolean(SENDERS[settings.channel]?.ready(env));

// Plain-language reasons for the dashboard. Codes come from the Error messages above.
export function deliveryProblem(code) {
  const status = /^discord_(\d{3})$/.exec(code)?.[1];
  if (code === 'discord_not_configured') return 'Discord is not connected on the server: the Worker secret DISCORD_BOT_TOKEN is not set.';
  if (code === 'discord_bot_not_in_server') return 'The bot is not in any Discord server yet. Invite it to your server first.';
  if (code === 'discord_no_text_channel') return 'The bot’s server has no text channel it can use. Enter a channel ID.';
  if (status === '401') return 'Discord rejected the bot token. The Worker secret may be wrong or reset.';
  if (status === '403') return 'The bot is not allowed to post in that channel (it needs View Channel and Send Messages).';
  if (status === '404') return 'Discord could not find that channel. Check the channel ID.';
  if (status === '429') return 'Discord is rate-limiting the bot. It is retried on the next check.';
  if (status) return `Discord answered with error ${status}. It is retried on the next check.`;
  return 'The message could not be delivered. It is retried on the next check.';
}

async function recordDelivery(env, now, kind, code) {
  try {
    const row = await stmt(env.DB, 'SELECT value_json FROM system_state WHERE key=?', DELIVERY_KEY).first();
    const previous = row ? JSON.parse(row.value_json) : {};
    // A repeated identical failure is written once, not every five minutes.
    if (code && previous.lastError?.code === code) return;
    const value = code ? { ...previous, lastError: { code, at: iso(now), kind } } : { ...previous, lastSentAt: iso(now), lastKind: kind, lastError: null };
    await stmt(env.DB, UPSERT, DELIVERY_KEY, JSON.stringify(value), iso(now)).run();
  } catch { console.error('alert_delivery_record_failed'); }
}

// kind: 'warning' | 'reminder' | 'ended' | 'offline' | 'online' | 'test'. Throws on failure (callers retry next run).
export async function deliver(env, fetchImpl, content, settings, { kind, ping = false, now = Date.now() } = {}) {
  const sender = SENDERS[settings.channel];
  try {
    if (!sender?.ready(env)) throw new Error(`${settings.channel}_not_configured`);
    const result = await sender.send(env, fetchImpl, content, settings, { ping });
    await recordDelivery(env, now, kind, null);
    return result;
  } catch (error) {
    const code = String(error?.message ?? error).slice(0, 80);
    await recordDelivery(env, now, kind, code);
    throw error;
  }
}

export async function alertOverview(env) {
  const saved = await loadAlertSettings(env);
  const row = await stmt(env.DB, 'SELECT value_json FROM system_state WHERE key=?', DELIVERY_KEY).first();
  const delivery = row ? JSON.parse(row.value_json) : {};
  if (delivery.lastError) delivery.lastError.message = deliveryProblem(delivery.lastError.code);
  return { ...saved, defaults: defaultAlertSettings(envAfterMinutes(env)), checkEveryMinutes: CHECK_EVERY_MINUTES,
    channels: Object.entries(ALERT_CHANNELS).map(([id, c]) => ({ id, name: c.name, connected: Boolean(SENDERS[id]?.ready(env)) })),
    serverChannelId: Boolean(env.DISCORD_CHANNEL_ID), delivery, variables: TEMPLATE_VARIABLES.map(([name, description]) => ({ name, description })) };
}

async function latestReading(env, deviceId) {
  const block = await stmt(env.DB, "SELECT boot_id,anchor_ms,data_json FROM reading_windows WHERE device_id=? AND data_json<>'[]' ORDER BY block_id DESC LIMIT 1", deviceId).first();
  const tuples = block ? JSON.parse(block.data_json) : [];
  if (!tuples.length) return null;
  const r = unpackSample(tuples.at(-1), deviceId, block.boot_id, block.anchor_ms);
  return { ...r, time: Date.parse(r.estimatedAt) };
}

// Sends the (possibly unsaved) form settings once, marked as a test, using the device's latest stored reading.
// Mentions are shown but never ping anyone.
export async function sendTestAlert(env, body, { fetchImpl = fetch, now = Date.now() } = {}) {
  const v = object(body, 'request body');
  if (!['warning', 'ended'].includes(v.kind)) throw new ApiError(400, 'invalid_kind', 'kind must be warning or ended');
  const { settings, errors } = checkAlertSettings(v.settings);
  if (!settings) throw new ApiError(400, 'invalid_alert_settings', Object.values(errors)[0]);
  const device = typeof v.deviceId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v.deviceId)
    ? await stmt(env.DB, 'SELECT device_id,label FROM devices WHERE device_id=?', v.deviceId).first() : null;
  const reading = device ? await latestReading(env, device.device_id) : null;
  const latest = reading?.time ?? now, since = latest - settings.afterMinutes * 60000;
  const vars = messageVariables({ device: device ?? { device_id: 'coop-monitor', label: 'Coop Monitor' }, reading, since, afterMinutes: settings.afterMinutes, now });
  const content = buildMessage(v.kind === 'ended' ? settings.endedTemplate : settings.warningTemplate, vars, { mention: v.kind === 'ended' ? 'none' : settings.mention, test: true });
  try {
    const result = await deliver(env, fetchImpl, content, settings, { kind: 'test', ping: false, now });
    return { sent: true, channel: settings.channel, channelId: result.channelId, usedReading: Boolean(reading) };
  } catch (error) {
    const code = String(error?.message ?? error).slice(0, 80);
    throw new ApiError(502, 'alert_delivery_failed', deliveryProblem(code));
  }
}
