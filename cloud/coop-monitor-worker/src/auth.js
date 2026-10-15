import { ApiError } from './protocol.js';
const encoder = new TextEncoder();
export async function sha256(value) {
  const bytes = typeof value === 'string' ? encoder.encode(value) : value;
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
}
export function equal(a, b) { if (typeof a !== 'string' || typeof b !== 'string') return false; let diff = a.length ^ b.length; for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0); return diff === 0; }
export function bearer(request) { return /^Bearer ([a-zA-Z0-9_-]{32,128})$/.exec(request.headers.get('authorization') ?? '')?.[1] ?? null; }
async function sign(value, secret) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value)))].map(b => b.toString(16).padStart(2, '0')).join('');
}
export async function makeSession(secret, now = Date.now()) {
  if (typeof secret !== 'string' || !secret.trim()) throw new ApiError(503, 'authentication_unavailable', 'Owner sessions are unavailable');
  const payload = `${now + 8 * 3600000}.${crypto.randomUUID()}`; return `${payload}.${await sign(payload, secret)}`;
}
export async function validSession(session, secret, now = Date.now()) {
  if (typeof session !== 'string' || session.length > 180 || typeof secret !== 'string' || !secret.trim()) return false;
  const parts = session.split('.');
  if (parts.length !== 3 || !/^\d{13}$/.test(parts[0]) || Number(parts[0]) <= now || Number(parts[0]) > now + 8 * 3600000 + 60000) return false;
  return equal(await sign(`${parts[0]}.${parts[1]}`, secret), parts[2]);
}
export async function requireAdmin(request, env) {
  const token = bearer(request);
  if (token && env.ADMIN_TOKEN && equal(await sha256(token), await sha256(env.ADMIN_TOKEN))) return;
  const cookie = /(?:^|;\s*)coop_session=([^;]+)/.exec(request.headers.get('cookie') ?? '')?.[1];
  if (!await validSession(cookie, env.SESSION_SECRET)) throw new ApiError(401, 'authentication_required', 'Owner authentication is required');
  if (!['GET', 'HEAD'].includes(request.method) && request.headers.get('origin') !== new URL(request.url).origin) throw new ApiError(403, 'origin_rejected', 'A same-origin request is required');
}
export async function requireDevice(request, env, deviceId) {
  const token = bearer(request);
  if (!token) throw new ApiError(401, 'authentication_required', 'Device credential is required');
  const device = await env.DB.prepare('SELECT * FROM devices WHERE device_id = ?').bind(deviceId).first();
  if (!device?.token_hash || !equal(await sha256(token), device.token_hash)) throw new ApiError(401, 'invalid_device_credential', 'Invalid device credential');
  return device;
}
