# Backend verification

## Archive folders and ZIP downloads — 13 October 2026, deployed

Archive library entries group manual IDs and automatic hours with range/archive-date metadata, lazy file pages, checkbox selection and all/selected ZIP downloads of SHA-256-verified original files. New owner-only GET `/api/archive-folders` and `/api/archive-files` use existing tables and scoped cursors; old catalog/download and firmware/archiving contracts remain unchanged. **82 Node tests**, **50 isolated Worker checks**, synthetic desktop/mobile browser checks, and independent 19-file/2-file/105-file synthetic ZIP decoding passed. After fresh user approval, published **`d19d670b-57b4-4108-be5f-ed7ca5b35c32`**; all **nine asset hashes** matched. Live Home Testing Session appeared once with correct metadata and 19 original files / 2,206 entries. Target job/manifest hash was preserved, full and two-selected-file ZIPs independently passed CRC/both SHA-256/gzip/count/unique-sample checks (2,206 / 1,245 entries), and private/device/cursor access checks passed.

Production reads were limited to public assets/health and the named archive; the earlier broader baseline was rejected before execution and remains unused. No snapshot/History/settings/calibration reads, cloud data/device writes, migration, firmware or Git publication occurred. Authenticated production browser UI and physical ingestion were not tested. See [root verification](../../VERIFICATION.md); ignored `.local/archive-folders/` contains evidence. Localhost 8791 is a synthetic review preview.

## History selected-range total — 13 October 2026, deployed

History shares the read-only `/api/archives/selection` total, updating after date edits and on History/device/range-load changes, independently of loaded rows/page size/order. Invalid/empty/error states and stale reply protection are verified. **74 Node tests**, synthetic desktop/mobile browser checks, **seven live asset hashes** and **eleven API/preservation checks** passed. Production's 24-hour **1,468-entry** total matched complete paginated History in both orders; invalid/anonymous requests and an empty minute were checked. Deployed **`7bbc4775-3566-4c61-b5e8-130062fe35f8`** with explicit user authorization. No backend/schema/firmware change or cloud data/device writes. Readings/settings/calibration were preserved; authenticated production browser UI and physical ingestion remain outside this verification. See [root verification](../../VERIFICATION.md); private evidence is in ignored `.local/history-selection/`.

## History date consistency — 13 October 2026, deployed

History table dates now explicitly use padded **DD/MM/YYYY**, preserving local timezone/time and estimated labels. Syntax, formatter and synthetic browser checks passed for both recent orders and selected ranges. After fresh user approval, Worker **`bc8c9f1d-bcab-4279-b527-e94dc2ce89f5`** was deployed; six live asset hashes and eleven read-only API/preservation checks passed. No backend/schema/firmware changes or cloud data/device writes. Existing readings/settings/calibration were preserved. See [root verification](../../VERIFICATION.md) for evidence boundaries; private readbacks are in ignored `.local/history-date-format/`.

## History ordering — 13 October 2026

**Newest first / Oldest first** now applies to recent retention and selected ranges at every History page size, including continuation and row numbering. Cursor direction is validated and prior descending cursors remain supported. Worker **`aee21cc5-7810-44d5-a934-f960a20b1364`** is deployed after **67 Node tests**, **44 isolated Worker checks** and synthetic browser range/race/failure/mobile checks. All six deployed asset hashes, eleven API/preservation checks and **44 read-only production ordering checks** passed; both directions reconstructed the same 120-entry range as the legacy API. No migration, cloud data writes, device operations or Git publication. Stored real readings/settings/calibration were unchanged; fresh physical ingestion and authenticated production browser UI were not reviewed. See [root verification](../../VERIFICATION.md); private evidence remains in ignored `.local/history-order/`.

## History entry pagination — 13 October 2026

The footer dropdown selects 50, 100 (default), 250, 500 or 1,000 entries, reloads the current latest/range view and appends the next batch on **Load next page**. Read-only `pageSize` requests use scoped entry cursors; legacy history/trend/export requests and firmware ingestion are unchanged. No migration/data/device writes occurred.

Worker **`2a12ba13-95e3-40e2-8456-ba54232471ad`** is deployed. **65 Node tests**, **36 isolated Worker checks**, synthetic browser interaction/failure/race/mobile checks, six live asset hashes, **22 read-only live pagination checks** and eleven preservation/API checks passed. All dropdown counts and continuation worked on real retained readings; a 120-entry range reconstructed identically to the legacy API. Latest-100 readings/settings/calibration/firmware/pause state were preserved. Fresh physical ESP ingestion and authenticated production browser UI were not tested. Details are in [root verification](../../VERIFICATION.md), private readbacks in ignored `.local/history-page-size/`.

## Approved manual archive deployment — 13 October 2026

Worker **`0ce40449-3102-4c19-b53d-22dfd179bbc0`** publishes the approved date-range archive controls, labels/counts and Overview heading. Private D1 backup preceded migration 0004; remote readback confirms no pending migrations. All six deployed assets matched local SHA-256; eleven owner/private API and preservation checks and **22 synthetic production checks** passed. The synthetic device, job/manifests/rows and exact R2 object were removed and fixture absence verified. The archive checks include checksum reconstruction, outside-range retention, resume/idempotency and archived ESP retry acknowledgement without reinsertion/conflict weakening.

Latest 100 real readings and stored desired/applied revision 3, 30-second sampling, calibration fingerprint 2300842445, firmware and pause state were preserved. The real device was already offline, last exchange 13 October 08:16:23 Jakarta. No real readings were manually archived, device commands/settings/flash or Git publication occurred. Authenticated production API/asset checks passed; authenticated browser UI and fresh physical ingestion were not verified in this rollout. Details and evidence boundaries are in [root verification](../../VERIFICATION.md); private evidence remains in ignored `.local/manual-deploy-2026-10-13/`.

## Manual range archives: 13 October 2026 — local implementation

Added date-range entry counts, labeled/resumable verified archive jobs, migration `0004_manual_archives.sql`, firmware retry fingerprints and the **Environment Readings** heading. All **60 Node tests**, **29 isolated workerd/Miniflare checks**, JavaScript syntax and whitespace checks passed. Synthetic local browser checks covered creation/counts/labels, source-retaining checksum failure, reload/resume, device selection and 320/390 px layout without overflow or page/CSP logs. See [root verification](../../VERIFICATION.md) for evidence boundaries. No production access/deployment/remote migration or device/Git publication operations occurred; rollout remains pending authorization and backup/migration.

## Signal dashboard — 12 October 2026

Approved dashboard redesign deployed as **`8d50edc6-b376-44dd-bd48-dd06a29c9d40`**. All 46 Node tests (38 existing + 8 trends), synthetic browser checks, syntax and packaging passed. Five deployed asset hashes and authenticated production navigation/range checks passed; real-device state and latest 100 readings were preserved. No backend source/schema/firmware changes were made for this redesign. The offline device supplied no readings in the four trailing windows, so populated trend rendering was tested locally with synthetic data. See [root verification](../../VERIFICATION.md) for exact evidence boundaries.

## Authorized deployment — 12 October 2026

Compatible audit fixes and migration `0003_archive_catalog_index.sql` are deployed as version **`c57d5a65-0e42-483c-a2dd-04433b0858c3`**. A private D1 backup preceded migration; remote index/migration readback and all four deployed asset hashes passed. Nine synthetic production checks passed and the temporary device was removed. Owner login/CSRF/logout and read APIs passed; the real device's latest 100 readings and settings/calibration were unchanged.

The real ESP32 was already offline before rollout (last exchange 11 October at 16:21:28 Jakarta). Its saved five-second sampling/revision 2 was preserved. Fresh physical ingestion remains pending; the synthetic result does not establish that. See the [full audit/deployment record](../../docs/BACKEND_AUDIT_2026-10-12.md) and [root verification](../../VERIFICATION.md). Firmware-sensitive issues remain deferred; no firmware flash, real-device command, commit or push occurred.

## Local audit verification — 12 October 2026

The initial [backend audit](../../docs/BACKEND_AUDIT_2026-10-12.md) recorded **38 passing Node/SQLite tests**, **20 passing isolated workerd/Miniflare checks**, deferred issue reproductions, the improved archive query plan and exact verification boundaries. That initial phase performed no production/account/device operations; the subsequently authorized rollout is documented above. The 10 October evidence below remains historical.

Repeat from this directory using Node with `node:sqlite`:

```powershell
npm test
node scripts/local-runtime-smoke.mjs
node scripts/audit-findings.mjs
```

These commands use synthetic local-only data and do not read provisioning credentials. The runtime check requires the installed Wrangler/esbuild/Miniflare toolchain; a Windows sandbox may prevent workerd from opening its temporary SQLite files. The separate findings script reports current deferred behavior rather than counting it as successful regression coverage.

## Actual execution

Wrangler 4.148.0, bundled Node 24.19.0, Windows PowerShell. The isolated acceptance script uses real HTTP requests and real D1/R2 bindings; it does not substitute an in-memory implementation for the deployed storage.

| Environment | Result | Evidence |
|---|---|---|
| Local Wrangler/workerd, local D1/R2 | 31 checks passed at 07:12:20 UTC | `.local/local-acceptance.json` |
| Deployed HTTPS Worker, remote D1/R2, final version | 32 checks passed at 07:25:34 UTC (14:25:34 Jakarta) | `.local/production-acceptance.json` |
| Deployed archive fixture | 900 readings, 30 blocks, gzip 12,973 bytes, checksum verified after R2 readback and owner download | Production acceptance report |
| Resource readback | D1 APAC, registered `coop-monitor-01`; secrets installed; cron deployed; R2 Standard/APAC with public access disabled | Wrangler/API metadata reads |
| Credential exclusion | All 5 relevant local secret/provisioning/report paths matched Git ignore rules | `git check-ignore` |

Worker version used for these acceptance checks: `46c5362c-39a0-4472-ba44-7f00fadbe996`. The later overview spacing deployment is `a56bc274-6d03-4ebb-afc9-414cb0a842e5`; see `DEPLOYMENT.md`. No acceptance suite was rerun for the CSS correction.

## Production checks

- D1-backed health through the public HTTPS endpoint.
- Anonymous owner-data denial; owner sign-in and signed Secure/HttpOnly cookie; cookie-authorized reads; cross-origin cookie write denial; signout cookie clearing.
- Isolated synthetic device registration; incorrect device credential denial; maintenance/capacity initialization.
- Reading/log acknowledgements; repeat payload stored once; preserved unknown UTC; conflicting sample values and invalid measurements rejected.
- Concurrent uploads retain both readings.
- Desired settings revision update; stale revision conflict; device exchange returns the current desired configuration.
- CAL_START reference-condition confirmation; allowlisted command delivery; completion acknowledgement; terminal status regression rejected; expired queued commands withheld.
- Credential redaction in firmware logs; combined console/state polling; owner pause does not acknowledge unwritten readings; resume works.
- Authenticated CSV export.
- Aged fixture R2 write/readback and checksum; owner archive checksum/decompression; verified catalog; D1 source deleted only after verified archive.

The acceptance script removed only its own randomly named `synthetic-*` device, cascaded fixture rows and the exact synthetic R2 object key. It reran capacity maintenance afterward. At the end of that acceptance stage, the production database was provisioned for the real device and contained no physical readings. Subsequent real device ingestion is documented in [root verification](../../VERIFICATION.md).

## Interpretation

This confirms cloud/API/database/archive behavior with identified synthetic data. These backend checks do not verify ESP firmware serialization, compilation or upload; physical sensors; OLED; network loss on the actual device; TLS trust on the ESP32; calibration; unsafe command replay recovery; or continuous field operation. The separate 10 October firmware source compilation is recorded in [root verification](../../VERIFICATION.md); physical acceptance remains pending. The configured cron was deployed; the archive algorithm was invoked through the authenticated maintenance route during acceptance, so these checks alone do not prove recurring execution over time.

The realistic archive batch completed under this deployment, but this short probe does not establish sustained CPU/quota headroom across different data/load patterns. Check Cloudflare analytics and device gap counts during the first continuous field run. No independent database restore was performed; the export/recovery procedure is documented in `OPERATIONS.md`.

To rerun an authorized isolated acceptance probe:

```powershell
# Ensure Node is on PATH, or invoke the bundled node.exe directly.
node scripts/smoke.mjs https://coop-monitor-worker.coop-monitor-worker.workers.dev --full-archive
```

The script reads local credentials without printing them, creates an explicit synthetic fixture, performs bounded production mutations and cleans up that fixture. Reports remain in ignored `.local`.
