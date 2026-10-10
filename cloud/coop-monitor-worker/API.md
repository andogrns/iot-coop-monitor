# Owner API

All `/api/*` routes except device exchange require the owner bearer key or a signed owner cookie. Public static assets and `/health` contain no readings. No cross-origin API access is enabled.

| Method | Route | Purpose |
|---|---|---|
| GET | `/health` | D1 connectivity and protocol version |
| POST | `/auth/login` | Same-origin `{key}`; signed Secure/HttpOnly/SameSite=Strict cookie, 8 hours |
| POST | `/auth/logout` | Clear owner cookie |
| GET | `/api/snapshot` | All devices, state, latest reading, capacity, maintenance; optional `consoleDeviceId` and log `cursor` include logs/commands in one poll |
| GET | `/api/history` | Device/range readings, minute-block pagination |
| GET | `/api/export` | One history page as CSV; `X-Next-Cursor` for another page |
| GET | `/api/logs` | Firmware logs; cursor pagination |
| POST | `/api/devices` | Register `{deviceId,label,token}` (64 lowercase hex token) |
| PUT | `/api/devices/:id/config` | `{expectedRevision,settings}`; optimistic revision check |
| GET/POST | `/api/devices/:id/commands` | Latest 100 commands / queue allowlisted command |
| PUT | `/api/devices/:id/uploads` | `{paused:true/false}` owner pause; capacity pause remains independent |
| GET | `/api/archives` | Verified catalog, `deviceId` and `cursor` |
| GET | `/api/archive?key=...` | Authenticated gzip download and `X-Archive-SHA256` |
| POST | `/api/maintenance` | Run bounded archive/pruning/capacity work immediately |
| POST | `/api/device/exchange` | Separate device credential; see firmware handoff |

History parameters: `deviceId` (default `coop-monitor-01`), `from`, `to` (ISO dates; maximum 31-day range), `limit` (1–60 minute blocks; default 30), `cursor` (prior `nextCursor`). Default range is the last hour. Follow `nextCursor` until null for a full export. Dashboard exports the selected range with a 50,000-reading browser limit; use paginated API retrieval for larger ranges.

Logs: `deviceId`, optional returned `cursor`; 100 rows/page. `nextCursor` also works for incremental polling. Stored rows use snake_case SQL names. Retention is 24 hours plus bounded pruning lag. Archives catalog: 100 records/page; `nextCursor` until null.

Commands: `{type,args:{},ttlSec:60}`. TTL 15–300 seconds, maximum 10 active commands per device. `CAL_START` args must explicitly confirm known reference conditions. No free-form shell, Wi-Fi credential updates, calibration import, or firmware OTA endpoint.

Errors use `{error,message}` with status 400 invalid payload, 401 missing/invalid credential, 403 cookie origin failure, 404 unknown resource, 409 reused sample values/revision conflict/full command queue, 413 body >64 KiB, 415 wrong content type, 429 owner login throttle, 503 backend/provider failure. No request bodies or credentials are emitted to Worker logs.
