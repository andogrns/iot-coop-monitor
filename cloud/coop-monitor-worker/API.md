# Owner API

All `/api/*` routes except device exchange require the owner bearer key or a signed owner cookie. Public static assets and `/health` contain no readings. No cross-origin API access is enabled.

Audit changes deployed with explicit authorization on 12 October 2026: JSON request bodies must be objects with `application/json` (case-insensitive; charset parameters accepted). Malformed/oversized log cursors return 400. Both CSV exporters escape formula-like text, including leading whitespace and full-width formula prefixes, while preserving numeric measurement values; raw JSON/archive values are unchanged. Owner-session creation fails with 503 when its signing secret is unavailable. Login throttling is best-effort per Worker isolate, not a global rate limit. See [audit report](../../docs/BACKEND_AUDIT_2026-10-12.md).

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
| GET | `/api/archive-folders` | Device-scoped archive folders, 50 per page, newest archived first |
| GET | `/api/archive-files` | Files inside one device/folder, 100 per page, in save order |
| GET | `/api/archives/selection` | `{count,deviceId,from,to}` for available History entries in the selected range |
| POST | `/api/archives/manual` | Create a resumable labeled job: `{deviceId,from,to,label,expectedCount}` |
| POST | `/api/archives/manual/:archiveId` | Save/verify/move up to 30 selected minute blocks; returns updated job |
| GET | `/api/archive?key=...` | Authenticated gzip download and `X-Archive-SHA256` |
| POST | `/api/maintenance` | Run bounded archive/pruning/capacity work immediately |
| POST | `/api/device/exchange` | Separate device credential; see firmware handoff |

Legacy History parameters (without `pageSize`): `deviceId` (default `coop-monitor-01`), `from`, `to` (ISO dates; maximum 31-day range), `limit` (1–60 minute blocks; default 30), `cursor` (prior `nextCursor`), `order` (`asc` by default, or `desc` for newest blocks first and pagination toward older blocks). Default range is the last hour. Follow `nextCursor` until null for a full export, keeping the range and order unchanged. CSV export retains ascending API retrieval and a 50,000-reading browser limit; use paginated API retrieval for larger ranges.

Without `pageSize`, `mode=latest` returns the newest individual readings within the recent retention period, ordered by server-anchored sample time descending. In this legacy mode `limit` is a reading count (1–100, default 100); date-range and cursor parameters are not used, and `nextCursor` is null. For example, `/api/history?deviceId=coop-monitor-01&mode=latest&limit=100`. Existing block pagination, trend requests and CSV export remain unchanged.

Adding `pageSize` opts into **individual entry pagination**, 50–1000 entries per request. `order=desc` (default) means newest first; `order=asc` means oldest first. Use `mode=latest` for the recent retention window (which can be traversed from either end) or `from`/`to` for a selected range (inclusive endpoints, maximum 31 days). `limit` is unused in this mode. Follow the opaque `nextCursor` with the same device/mode/range/order; the latest cursor freezes its original time window. Cursor ordering uses estimated time, binary boot ID and sequence, allowing a page boundary within a minute block without losing or repeating entries. Cursors bind the direction; older six-field cursors remain valid for descending requests. Candidate blocks and overlapping boot windows are bounded before JSON projection/sorting; at most `pageSize+1` tuples return from D1. No schema change or device write is involved. The History footer selects 50, 100 (default), 250, 500 or 1000 plus newest/oldest first. Changing size or order reloads the loaded view; **Load next page** appends the next batch. Newest-first numbers count down from the loaded total; oldest-first numbers count up from 1. Unsubmitted date-input edits do not change a running selection.

Logs: `deviceId`, optional returned `cursor`; 100 rows/page. `nextCursor` also works for incremental polling. Stored rows use snake_case SQL names. Retention is 24 hours plus bounded pruning lag. Archives catalog: 100 records/page; `nextCursor` until null.

Manual archives use ISO `from` / `to`, inclusive endpoints on the server-anchored `estimatedAt` timeline, and a maximum 31-day range. They count individual readings still in D1, excluding previously archived entries and console logs. The History date picker shares the read-only `/api/archives/selection` count: it updates after date edits, on History entry/device changes, and when loading a range. This total is separate from loaded table rows and is independent of page size/order; editing dates leaves the loaded table intact until submission. Empty/invalid selections and failed count requests are shown explicitly; stale replies cannot replace a newer selection. Counts are a point-in-time preview and can change as readings arrive or are archived. Labels are trimmed, required, and limited to 80 characters without control characters. Creation rechecks `expectedCount`; a changed count returns `409 selection_changed` for user review. The returned job includes `archive_id`, `label`, `range_from`, `range_to`, `selected_count`, `archived_count` and `status` (`running` / `complete`). Continue POSTs until complete; repeating a completed POST has no effect. There is no automatic background continuation. `/api/archives` includes the latest 100 `manualArchives` jobs on the first catalog page; chunks include their `manual_archive_id`, label and range.

Each manual chunk keeps the version-1 tuple/block format and adds `manualArchive:{id,label,from,to}`. R2 upload, full readback and SHA-256 verification precede one atomic D1 transaction that removes only selected tuples, records the verified manifest and advances progress. Outside-range tuples, device state, exchange counters and sample identity/value fingerprints remain. Identical firmware retries are acknowledged without reinsertion; changed values retain the existing `sample_conflict` response, and the 32-sample minute limit still includes archived identities. Capacity, live maintenance leases and concurrent changes can stop a chunk with a recoverable error. Committed chunks remain available; failed chunks keep their source entries. New/late readings within the range can change the eventual total from the initial count. History continues to query only unarchived readings.

Commands: `{type,args:{},ttlSec:60}`. TTL 15–300 seconds, maximum 10 active commands per device. `CAL_START` args must explicitly confirm known reference conditions. No free-form shell, Wi-Fi credential updates, calibration import, or firmware OTA endpoint.

Errors use `{error,message}` with status 400 invalid payload, 401 missing/invalid credential, 403 cookie origin failure, 404 unknown resource, 409 reused sample values/revision conflict/full command queue, 413 body >64 KiB, 415 wrong content type, 429 owner login throttle, 503 backend/provider failure. No request bodies or credentials are emitted to Worker logs.

## Archive folders and bulk downloads

Deployed with explicit approval on 13 October 2026 as Worker `d19d670b-57b4-4108-be5f-ed7ca5b35c32`. Local browser/tests and live assets/private archive reads/download checks passed. Existing catalog/download routes remain available.

The library uses owner-only GET /api/archive-folders with deviceId and an opaque nextCursor. It groups each manual job by archive ID, including running jobs without files; duplicate labels stay distinct. Automatic chunks group by their existing hour_start. Each folder includes folder_id, type, label, range_from/range_to, archived_at, status, file_count, sample_count and compressed_bytes. Completed manual archives use the job completion timestamp; automatic archives use the latest saved-file timestamp. Folder pagination returns 50 groups ordered by archive date and ID descending, with device-bound cursors.

GET /api/archive-files takes deviceId, folder (the returned folder_id) and cursor. It returns 100 verified manifest files per page ordered by created_at/object_key; cursors bind both device and folder. Missing folders for the requested device return 404; malformed folders/cursors return 400. These routes only read existing tables; the legacy catalog, individual download route, archiving, ingestion and schema remain unchanged.

Bulk download is client-side: Download all walks every file page; Download selected uses the checked files among loaded pages. The browser fetches the existing private /api/archive files, verifies every compressed SHA-256, then puts the unchanged gzip bytes in one ZIP with unique part names. A failed read/hash produces an error and no partial ZIP. Device/logout/library reset cancels an in-progress download. Browser memory and standard ZIP limits apply to very large selections; smaller selections remain available. No new R2 object is created by downloading.
