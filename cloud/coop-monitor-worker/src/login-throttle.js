import { ApiError } from './protocol.js';

// Best-effort per-isolate protection, not a distributed rate limiter.
export function createLoginThrottle({ maxEntries = 1000, limit = 10, windowMs = 60000 } = {}) {
  const records = new Map();
  return (ip, now = Date.now()) => {
    let record = records.get(ip);
    if (record && now - record.start >= windowMs) { records.delete(ip); record = undefined; }
    if (!record) {
      if (records.size >= maxEntries) {
        for (const [key, value] of records) if (now - value.start >= windowMs) records.delete(key);
      }
      // Never clear active records: IP churn must not reset another IP's limit.
      if (records.size >= maxEntries) throw new ApiError(429, 'login_throttled', 'Wait one minute');
      record = { start: now, count: 0 };
      records.set(ip, record);
    }
    if (record.count >= limit) throw new ApiError(429, 'login_throttled', 'Wait one minute');
    record.count++;
  };
}
