# Cloudflare deployment record

Updated 13 October 2026, Asia/Jakarta. Archives now shows one expandable entry per session with label/range/archive date, individual files and all/selected ZIP downloads. All nine deployed asset hashes matched; live Home Testing Session metadata, original-file preservation and independently decoded ZIPs passed (19 files / 2,206 entries; selected two / 1,245). Earlier History range counts, DD/MM/YYYY dates, ordering and page sizes remain. No migration was needed. This rollout checked public assets/health and the named archive only; device/infrastructure values not explicitly rechecked retain their earlier verification date. Authenticated production browser UI and fresh physical acceptance were not tested.

| Item | Live value |
|---|---|
| Cloudflare account | `7865a0c25fe350bb4395009c91eb83d1` |
| Worker | `coop-monitor-worker` |
| Dashboard origin | `https://coop-monitor-worker.coop-monitor-worker.workers.dev` |
| Device exchange | `https://coop-monitor-worker.coop-monitor-worker.workers.dev/api/device/exchange` |
| Protocol | Version 1 |
| Active version | `d19d670b-57b4-4108-be5f-ed7ca5b35c32` (Archive folders and ZIP downloads) |
| D1 database | `coop-monitor-db` |
| D1 ID | `ea267d2d-f237-4374-9c72-d4fd6efb632c` |
| D1 location | APAC; queries served by primary in HKG during checks |
| Schema | Migrations 0001–0004; remote readback confirms no pending migration |
| Device | `coop-monitor-01`; desired/applied revision 3; 30-second sampling; stored settings preserved |
| R2 bucket | `coop-monitor-archives` |
| R2 location/class | APAC / Standard |
| R2 public access | `r2.dev` disabled; custom public domains list empty |
| R2 binding | `ARCHIVES`; no external S3/API keys required |
| R2 lifecycle | No automatic archive deletion configured |
| Schedule | `*/15 * * * *` (every 15 minutes, UTC) |
| Secrets installed | `ADMIN_TOKEN`, `SESSION_SECRET` |

## Access and provisioning

Owner sign-in uses `ownerKey` from `.credentials.local.json`, then an 8-hour signed HttpOnly/Secure cookie. Every owner data route checks authentication. This deployment uses its own owner sign-in; Cloudflare Access policies were not created. Public static login assets and health response do not contain device data or credentials.

The independent device token is registered as a SHA-256 hash in D1. `../../firmware/coop_monitor/dashboard.local.json` contains the exact device connection, ID and original token for local firmware provisioning. `.credentials.local.json`, `.secrets.production.json`, `.dev.vars`, `.local/*`, and the firmware provisioning file are confirmed Git-ignored. Secret values are omitted from this record.

## Completed

- 13 October archive folders: published `d19d670b-57b4-4108-be5f-ed7ca5b35c32` after fresh user authorization, 82 Node tests, 50 isolated Worker checks and synthetic browser checks. Nine live assets matched. Home Testing Session appeared once with correct label/range/archive date, 19 files and 2,206 entries; target job/manifests were unchanged. Full and selected-two-file ZIPs passed independent CRC, compressed/original SHA-256, gzip/JSON, count and duplicate checks; private/device/cursor access checks passed. No migration, cloud data/device writes, firmware or Git publication. Production verification read only public assets/health and the named archive; broader device-state preservation and authenticated production browser UI were not rechecked.

- 13 October History range count: published `7bbc4775-3566-4c61-b5e8-130062fe35f8` after explicit user authorization and 74 Node tests plus synthetic browser checks. The picker total uses the existing private read-only selection route and stays separate from loaded rows. Seven live asset hashes, eleven API/preservation checks and live count-to-complete-History comparison in both orders passed. No migration, backend/firmware change or cloud data/device writes; readings/settings/calibration were preserved.

- 13 October History date consistency: published `bc8c9f1d-bcab-4279-b527-e94dc2ce89f5` after explicit user approval. History dates display DD/MM/YYYY to match the picker; browser-local times and estimated labels remain. Local syntax/formatter/browser checks, six live asset hashes and eleven read-only API/preservation checks passed. No migration or cloud data/device writes; readings/settings/calibration were preserved.

- 13 October newest/oldest History order: both directions for recent retention and ranges, all page sizes, order-aware continuation/cursors and row numbering. Published `aee21cc5-7810-44d5-a934-f960a20b1364` after 67 Node tests, 44 isolated Worker checks and synthetic browser checks. Six asset hashes, 44 read-only production ordering checks and eleven API/preservation checks passed. No migration, cloud data writes, device operations or Git publication; existing readings/settings/calibration were preserved. See [verification](VERIFICATION.md).

- 13 October History page size: options 50/100/250/500/1,000, exact-entry pagination in latest/range views, automatic reload on size change and older-batch continuation. Published `2a12ba13-95e3-40e2-8456-ba54232471ad` after 65 Node tests, 36 isolated Worker checks and synthetic browser checks. Six asset hashes, 22 read-only live pagination checks and eleven API/preservation checks passed. Existing readings/settings/calibration were unchanged. No migration, cloud data writes, device operations or Git publication; see [verification](VERIFICATION.md).

- 13 October approved manual archives: private D1 backup, migration `0004_manual_archives.sql`, Worker `0ce40449-3102-4c19-b53d-22dfd179bbc0`, six asset hash matches, eleven owner/private API and preservation checks, 22 synthetic production checks and fixture cleanup. Latest 100 real readings/settings/calibration/firmware/pause state were unchanged. No real readings manually archived, device command/settings/flash or Git publication. Local browser checks passed previously; authenticated production browser UI and fresh ESP ingestion remain unverified. See [verification](VERIFICATION.md).

- 12 October approved Signal dashboard: top navigation, selectable metric tiles, responsive light/dark layout, calibration/capacity details, and **1h / 6h / 12h / 24h** trends via existing authenticated history pagination. Final version `8d50edc6-b376-44dd-bd48-dd06a29c9d40` preserves the earlier audit backend. All 46 Node tests, synthetic browser/CSP checks and packaging passed; five asset hashes and production owner-session navigation/range checks passed. Device revision/settings/calibration/firmware/pause state and latest 100 readings matched before/after. The real device remained offline and the four recent windows were empty. No device writes, schema migration, firmware flash or Git publication.

- 12 October authorized rollout: private D1 backup, additive archive index, compatible security/efficiency fixes and shared CSV helper. Version `c57d5a65-0e42-483c-a2dd-04433b0858c3`; previous version `8a7b1e95-5fa9-4151-9223-8e796188c70b`. Live synthetic retry/conflict/authentication/log-redaction checks passed with fixture removal; owner-session and asset readback checks passed. Real-device latest-100 history, calibration fingerprint and revision-2 five-second settings were unchanged. See [audit report](../../docs/BACKEND_AUDIT_2026-10-12.md). Deferred firmware-sensitive changes were not included.

- D1 created, two migrations applied, real device registered with default monitoring configuration.
- R2 activated by owner, bucket created and private access verified.
- Worker, dashboard assets, secrets, D1/R2 bindings and scheduled trigger deployed.
- Public TLS health, private API access, device protocol, configuration/commands, pause/resume, CSV, and R2 checksum/readback retention accepted using synthetic fixtures.
- Final synthetic fixture contained 900 readings across 30 minute blocks; compressed archive was 12,973 bytes. Fixture object/device/rows were removed afterward.
- Normal terminal wrapper `cf.ps1` prepared to resolve the earlier missing Node PATH issue.
- Physical `coop-monitor-01` firmware updated to `cloudflare-1.0.1` after verified flash/calibration backups; real HTTPS ingestion, applied revision 1 and continued uploads with Serial Monitor closed confirmed. See [root verification](../../VERIFICATION.md) for this separate device investigation.
- Overview spacing correction deployed: 16 px between the metrics and state/capacity rows, with a content-versioned stylesheet URL so cached clients load the new CSS on refresh. The live overview was visually reviewed; screenshot saved in ignored `outputs/cloudflare/overview-spacing-fixed.jpg`.
- Current-calibration panels deployed in Overview and Settings. Only the three dashboard assets changed; the Worker backend, firmware, credentials and database schema are unchanged. Public asset SHA-256 readback matched the local files. Browser review used synthetic sample data for normal, missing, offline and changed-calibration states; authenticated production telemetry was not fetched during this update.
- History now loads the newest 100 individual readings on entry and device change. The authenticated history route supports `mode=latest` with a reading count; custom ranges retain existing pagination/export behavior. Five in-memory SQLite tests and synthetic browser checks passed; no database migration or device change was required.
- Selected ranges now request descending history pages and share a newest-first, bottom-up-numbered table renderer with the default view. More pages preserve chronological ordering and renumber all loaded rows. The range button aligns with the date inputs on desktop and stacks at full width on mobile. Six SQLite tests and a two-page, 1,200-reading synthetic browser review passed. Public assets matched local SHA-256 after deployment.

No paid Workers upgrade, custom domain, extra storage product, S3 key, firmware erase/flash, or existing Apps Script/Sheets change was needed for this backend task. R2 remains metered outside included capacity; application guards and usage monitoring are described in `OPERATIONS.md`.

See `VERIFICATION.md` for backend evidence, [root verification](../../VERIFICATION.md) for the firmware compilation, and `FIRMWARE_HANDOFF.md` / the [firmware guide](../../firmware/coop_monitor/README.md) for USB cutover and device acceptance.
