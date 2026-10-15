# Coop Monitor verification

## GitHub source synchronization checks: 15 October 2026

- Live `refs/heads/main` and local HEAD both resolved to `0c20ab8c779d97e1a2499a577bc5b0f4f9146691` before publication; 15 modified and 28 new scoped files contained the unpublished application/documentation work.
- All 82 Node tests passed. Syntax checks passed for every active Worker `src/*.js` and browser `public/*.js` file; `git diff --check` passed.
- The user authorized committing and pushing the scoped update. Unrelated sketches, shopping scripts, `IDEA.md`, generated outputs and ignored private data are excluded. Active firmware has no uncommitted changes.
- These are local source/test checks and live Git ref inspection, not fresh deployment, cloud data or physical-device acceptance. Push success must be verified separately against the live remote.

## Archive folders and bulk ZIP downloads: 13 October 2026 — deployed

- Replaced the flat archive chunk list with one expandable entry per manual archive ID, displaying label, date range, date archived and file/entry totals. Duplicate labels remain distinct; automatic archives group existing chunks by hour. File lists load in save order, with individual downloads, checkboxes, **Select all loaded files**, **Download selected** and **Download all files**. Whole-folder download follows every page rather than the displayed subset. Completed dates use job completion / automatic latest-save time; unfinished jobs show saved/start dates and retain **Continue archiving**.
- New private read-only routes `/api/archive-folders` and `/api/archive-files` page 50 folders / 100 files, respectively. Cursors are scoped to device and folder; unknown/cross-device folders and malformed cursors fail explicitly. Existing catalog/download routes, D1 schema, R2 originals, archive creation/verification/removal, ESP ingestion/acknowledgements, credentials, retention and cron are unchanged. ZIP creation occurs in the browser, storing original gzip bytes with unique part names, CRC32 and UTF-8 filenames. Every fetched file is checked against its catalog SHA-256; failed reads/hashes produce no partial ZIP. Reset/device/logout cancels a pending download.
- **82 Node tests passed** (74 existing + eight grouping/download tests). Coverage includes one 19-file/2,206-entry folder, duplicate labels, automatic hourly groups, unfinished empty jobs, 125 folders and 205 files across page boundaries, cursor binding, read-only/private/device-scoped access, all-file pagination, duplicate/repeated/failed pages, cancellation, ZIP headers/CRC/name validation, selected subsets and SHA-256 failure. **50 isolated workerd/D1/R2 checks passed**, including new CTE catalog/file queries and preserved firmware/archiving/retry behavior. Syntax and Git whitespace checks passed.
- Synthetic browser checks verified grouped metadata, 19 files inside one session, individual links, two checked files, select/clear of 100 loaded files, 100-to-105 continuation and **Download all** preparing 105 while only 100 were displayed. A one-shot file-list failure showed retry and recovered; corrupted gzip bytes failed SHA-256 with no ZIP. A 31-entry unfinished job resumed to one completed folder/file; the selected-download button stayed disabled with zero selected files. Literal `<coop>` labels rendered as text. Device switching cleared folders/selections and restored six collapsed entries. No page/CSP warnings/errors were observed. Desktop/mobile screenshots were reviewed; at 320 px the document width was 305 px and file controls/checksums wrapped; viewport override was reset.
- Independently opened the actual browser-created all-file (19 files / 2,206 synthetic entries) and selected-file (two files / 150+132 entries) ZIPs with Python `zipfile` and gzip/JSON decoding; CRC and contents passed. The same client helpers produced a separately validated 105-file ZIP containing all 105 original synthetic entries. Private test copies are in ignored `.local/archive-folders/`.
- Automatic approval review initially rejected the broader private-production baseline and publishing for lack of fresh authorization. After the user explicitly approved deployment and the targeted verification, published Worker **`d19d670b-57b4-4108-be5f-ed7ca5b35c32`**, previous `7bbc4775-3566-4c61-b5e8-130062fe35f8`, at the existing endpoint. Six changed/new assets were uploaded; **nine deployed SHA-256 asset hashes matched**. The deployed bindings, 30-day retention and 15-minute cron remain the same. No migration was required.
- Read-only production checks confirmed Home Testing Session appears once with correct label/range/archive date, **19 original files / 2,206 entries**, and matching original manifest fields. Its job/manifest hash was identical before/after. Full and selected-two-file ZIPs were made using the same verified browser helpers; independent Python ZIP CRC, compressed/original SHA-256, gzip/JSON, session metadata, per-file counts and duplicate-sample checks passed: **19 files / 2,206 unique entries** and **two files / 1,245 unique entries**. Public protocol-1 health and anonymous rejection passed; target files reject cross-device access (404) and malformed cursors (400).
- Verification retained/downloaded only Home Testing Session; catalog APIs return listing metadata, and paging stopped once its files were found. No snapshot, History, settings or calibration were read. No cloud data/device writes, firmware changes, migration or Git publication occurred. Authenticated production browser UI and fresh physical ingestion were not tested; synthetic browser behavior and exact live assets/APIs were verified separately. The refreshed localhost 8791 preview remains synthetic. Private before/after, ZIPs, file metadata and independent validation are in ignored `.local/archive-folders/`; the rejected broader helper remains unused.

## History date-range count: 13 October 2026 — deployed

- Added **data entries selected** below the History date picker, sharing the existing read-only Archives selection route. It counts the complete inclusive server-anchored range (up to 31 days), excluding archived entries/logs. Date edits update after 300 ms; History entry, device changes and range submission refresh it. It stays separate from loaded table rows and page size/order, preserves unsubmitted date edits as edits, and rejects stale replies after range/device changes or reset. Empty/invalid selections and failed requests show explicit states; count previews can change with ingestion/archiving.
- **74 Node tests passed** (67 existing + seven new). New tests cover whole-range/singular/empty counts, browser-local date conversion, invalid/31-day ranges, debounce, stale success/failure responses, reset cancellation, failed/invalid replies and recovery. An authenticated in-memory backend test checks an inclusive 301-entry count against complete 50-entry History pages in both orders, despite unrelated device UTC timestamps, and confirms read-only/private access. Syntax and Git whitespace checks passed.
- Synthetic browser checks verified 1,200 selected entries while 50 then 100 rows were loaded; page/order changes preserved the count. Unsubmitted edits updated it to 301 without changing the loaded table; one-entry, empty, cleared, reversed and oversized ranges behaved correctly. A one-shot count failure replaced the prior count, and **Load selected range** retried successfully. Device switching returned zero/1,200 appropriately. Archives and History both showed 1,200 for the same range. No page/CSP warning/error logs were observed. Desktop and 320 px screenshots were inspected; mobile document width was 305 px, count bounds 34–271 px, and viewport override was reset.
- Following explicit user authorization to verify/deploy, published Worker **`7bbc4775-3566-4c61-b5e8-130062fe35f8`**, previous `bc8c9f1d-bcab-4279-b527-e94dc2ce89f5`, at the existing endpoint. Uploaded `app.js`, `index.html` and new versioned `history-selection.js`; **seven deployed asset SHA-256 hashes matched**. **Eleven read-only API/preservation checks passed**. A live 24-hour selection returned **1,468 entries**, matching complete duplicate-free ascending and descending History (1,000 + 468 per order); invalid ranges returned 400, anonymous count access returned 401, and the empty recent minute matched History's zero entries.
- No backend source, schema/migration, credentials, firmware, cron or retention changes; no cloud data/device writes or Git publication. Desired/applied revision 3, 30-second sampling, calibration fingerprint 2300842445, firmware, upload-enabled state and latest-100 history hash matched before/after. The real device was already offline; no fresh physical ingestion or authenticated production browser UI acceptance was performed. Live API/assets were checked separately from synthetic browser behavior. Private evidence remains in ignored `.local/history-selection/`; the original localhost 8791 preview remains available.

## History date consistency: 13 October 2026 — deployed

- Added a History-only formatter using explicit padded **DD/MM/YYYY**, preserving browser-local times, sampled/estimated timestamp selection and the estimated suffix. Other dashboard date displays remain as previously implemented. Updated the app asset version in `index.html`.
- JavaScript syntax, formatter checks for `03/02/2026`, `13/10/2026` and unknown timestamps, and Git whitespace checks passed. Synthetic localhost browser checks verified `13/10/2026` in newest/oldest recent views and a 72-entry selected range. The screenshot shows both date inputs and table using the same date order; no page/CSP warnings/errors were observed.
- Initial deployment was rejected before execution for lack of fresh authorization. After the user explicitly approved publishing this fix, refreshed the read-only baseline and deployed Worker **`bc8c9f1d-bcab-4279-b527-e94dc2ce89f5`**, previous `aee21cc5-7810-44d5-a934-f960a20b1364`, at the existing endpoint. Only `app.js` and `index.html` required static asset upload. **Six live asset hashes matched** and **eleven read-only API/preservation checks passed**. Latest 100 readings, desired/applied revision 3, calibration, firmware and upload-enabled state were preserved. No migration, cloud data/device writes, firmware changes or Git publication. Authenticated production browser UI and physical ingestion were not checked. Private before/after evidence is in ignored `.local/history-date-format/`; local preview at `http://127.0.0.1:8791/` remains available with synthetic data.

## History newest/oldest ordering: 13 October 2026 — deployed

- Added **Order** beside the History page-size control: **Newest first** (default) and **Oldest first**, working for recent retention and selected ranges with all five sizes. Changing order resets/reloads the loaded view rather than reversing only the already-loaded subset; next pages append in the chosen direction. Newest-first numbers descend from the loaded total, oldest-first numbers ascend from 1. Page size/range and current-page device/tab choices are preserved; unsubmitted date edits remain separate from the loaded range.
- Read-only entry pagination supports `order=asc/desc`, direction-bound cursors and backward compatibility for existing six-field descending cursors. Ascending/descending candidate queries include boot-window overlap before bounded tuple sorting. Legacy block/latest APIs, trends, CSV export, ingestion, archives and schema remain unchanged. No migration or cloud data/device writes were required.
- **67 Node tests passed**, including both orders at all five sizes, full 1,200-entry reconstruction, oldest-first overlapping boot/equal-time boundaries, inclusive ranges, invalid direction/cross-direction cursors and older descending cursor compatibility. **44 isolated workerd/D1/R2 checks passed**, including oldest-first counts/continuation/inclusive ranges and cross-direction rejection. Syntax and Git whitespace checks passed.
- Synthetic browser checks passed for both orders/all sizes, continuation/remaining entries and row numbering. Selected-range order changes preserved the loaded 301-entry interval despite an unsubmitted date edit; submitting the edit returned 31 entries. Empty-device/order retention, delayed stale-response rejection and a failed oldest-first next page retaining 50 rows then retrying to 100 unique rows passed. No page/CSP warnings/errors were observed. All three controls aligned at the bottom on desktop; document widths were 1265/305 px at 1280/320 px, with mobile controls wrapping without page overflow. Screenshots were inspected and viewport reset.
- Deployed Worker **`aee21cc5-7810-44d5-a934-f960a20b1364`**, previous `2a12ba13-95e3-40e2-8456-ba54232471ad`, at the existing endpoint with unchanged bindings, protocol, retention and cron. **Six asset SHA-256 hashes matched**, eleven API/preservation checks passed, and **44 read-only production ordering checks passed**. Both directions/all sizes returned exact first-page counts and duplicate-free ordered continuation; oldest prefixes matched legacy retained data, newest prefixes matched legacy latest data, and a complete 120-entry range matched the legacy API in both directions. Invalid order/page/cursors and anonymous reads were rejected; pre-control descending cursors worked.
- Real-device latest-100 hash, revision-3/30-second settings, calibration fingerprint 2300842445, firmware and pause state were preserved. The device was already offline, last exchange 13 October 08:16:23 Jakarta; this is not fresh physical ingestion acceptance. Authenticated production browser UI was not reviewed; local synthetic browser checks plus exact deployed assets/live APIs passed. No credential rotation, data mutations, real-device commands/settings/flash or Git staging/commit/push occurred. Private readbacks are in ignored `.local/history-order/{before,after,pagination}.json` and `versions-before.json`.

## History page-size dropdown: 13 October 2026 — deployed

- User requested 50–1,000 entries per page beside **Load next page**, with autonomous testing and deployment. Implemented options 50, 100 (default), 250, 500 and 1,000 at the bottom of History. Size changes reload the current latest/range selection, and next-page batches append in newest-first server-anchored order with existing row numbering. The selector stays available for empty/final pages and remains selected across device/tab changes. Unsubmitted date edits do not alter the loaded range.
- Added an optional read-only `pageSize` history query with entry-level cursors, frozen latest-window endpoints and device/range cursor validation. It splits minute blocks, includes exact date endpoints and overlapping boot windows, skips empty blocks and bounds projected D1 results to N+1. Legacy history block/latest requests, trends, CSV export, firmware ingestion, settings, archive behavior and schema remain unchanged; no migration was required.
- **65 Node tests passed** (60 prior + five entry-pagination regressions): all sizes over 1,200 entries, complete reconstruction without gaps/duplicates, equal timestamps across overlapping boots, exact boundaries, sparse/empty/future/expired blocks, frozen-window continuation, variable page size and invalid/scoped cursors. **36 isolated workerd/D1/R2 checks passed**, including seven new actual-D1 pagination checks and the prior exchange/archive suite. Syntax and Git whitespace checks passed.
- Synthetic browser checks used 1,200 seeded readings: each first page matched its selected size, additional pages appended the exact batch/remainder, chronological order and numbering were correct, final-page button hid, range reload preserved the loaded range despite unsubmitted input changes, a smaller range returned 31 entries, an empty device returned zero while keeping the selector, a failed next page preserved 50 rows and retry produced 100 unique rows, and a delayed old response could not replace the newer 500-entry choice. No page/CSP warning/error logs were observed. Document widths were 305/375/1265 px at viewports 320/390/1280; desktop button/select bottom edges aligned. Mobile/desktop screenshots were inspected, and the temporary viewport was reset.
- Published Worker **`2a12ba13-95e3-40e2-8456-ba54232471ad`** at the existing endpoint; prior version `0ce40449-3102-4c19-b53d-22dfd179bbc0`. All **six deployed asset hashes matched** and **22 read-only production pagination checks passed**: every size returned its exact count, first-page prefixes matched legacy latest readings, continuation froze endpoints without duplicates, a complete 120-entry selected range matched the legacy block API, anonymous access/oversized pages/malformed cursors were rejected. Eleven API/private/preservation checks also passed.
- Real-device latest-100 hash, desired/applied revision 3, 30-second sampling, calibration fingerprint 2300842445, firmware and upload-enabled state were unchanged. Device was already offline (last exchange 13 October 08:16:23 Jakarta). These read-only checks establish deployed pagination, not fresh physical ingestion. Authenticated production browser UI was not reviewed; synthetic browser behavior plus live exact-asset/API readback passed. No database/cloud data mutations, migration, real-device command/settings/flash, credential rotation or Git staging/commit/push occurred. Private evidence: `.local/history-page-size/{before,after,pagination}.json` and synthetic preview helper.

## Approved manual archive deployment: 13 October 2026

- After preview approval and explicit deployment authorization, saved a private D1 SQL backup under ignored `cloud/coop-monitor-worker/.local/manual-deploy-2026-10-13/`, applied only pending migration `0004_manual_archives.sql`, and published Worker **`0ce40449-3102-4c19-b53d-22dfd179bbc0`**. Previous version: `8d50edc6-b376-44dd-bd48-dd06a29c9d40`. Remote readback confirms no pending migrations. Endpoint, protocol 1, D1/R2 bindings, retention, cron and firmware remained unchanged.
- All **six deployed asset SHA-256 hashes matched** local files. Eleven production read/preservation checks passed: desired/applied configuration, calibration, firmware, upload pause, latest-100 history hash, health/protocol, anonymous rejection, private range selection and manual catalog. A real-device 24-hour range count returned 1,468 entries at the initial post-deploy readback. No real-data archive was created.
- **22 synthetic production checks passed** using a new disposable device: protocol-1 acknowledgements; exact selection count; private access, stale count and foreign-origin rejection; secure owner session; labeled chunk save; catalog label/range; R2 download and compressed/original checksum; full tuple/metadata reconstruction; outside-range retention; resumable/idempotent completion; archived retry acknowledgement without reinsertion; changed-value conflict; empty final selection; state preservation; logout. Cleanup removed the exact synthetic R2 object, manifests, job and device rows, then verified the fixture device was absent. No real-device commands/configuration were written.
- Real-device latest 100 readings were hash-identical before/after. Stored desired/applied revision **3**, **30-second** sampling, automatic threshold/three warnings, calibration fingerprint **2300842445**, firmware `cloudflare-1.0.1` and upload-enabled state were preserved. Capacity was unpaused. The real device was already offline with last exchange **13 October 08:16:23 Jakarta**; production synthetic acceptance does not verify fresh physical ESP ingestion.
- Prior local verification remains **60 Node tests**, **29 isolated Worker checks** and synthetic browser checks below. Public production login loaded, but authenticated browser UI was not reviewed in this rollout because no browser session was present; authenticated production API and asset readback passed. No credential rotation, firmware flash, Git staging/commit/push or real readings moved. Private evidence: `before.json`, `after.json`, `synthetic.json` and `pre-deploy.sql` in the ignored rollout folder.

## Manual range archives: 13 October 2026 — local only

- Implemented owner-only range selection counts and resumable labeled manual archives, plus the **Environment Readings** Overview heading. Migration `0004_manual_archives.sql` was applied only to synthetic in-memory/isolated D1 fixtures. It adds jobs, manifest associations and archived sample fingerprints; no firmware/protocol, credentials, settings, retention or cron change.
- **60 Node/SQLite tests passed** (46 prior + 14 manual-archive tests). Coverage includes inclusive boundaries, multiple boots, estimated versus device UTC, counts, labels, partial-block preservation, 30-block chunk continuation, gzip reconstruction/checksums, repeated completion, upload/readback/checksum/manifest failures, concurrent ingestion rollback, capacity/leases, authorization/origin checks and safe provider errors. Integration tests verify archived retries remain acknowledged without reinsertion, conflicting values still fail, archived identities count toward the existing minute limit, and completion can resume after capacity-report failure.
- **29 isolated workerd/Miniflare checks passed**, including D1 migration/JSON tuple selection, manual gzip/R2 verification/download, catalog labels/ranges, preserved state/counters and archived retry/conflict behavior. Workerd required execution outside the Windows filesystem sandbox to open its temporary SQLite files. Fixtures prohibit outbound network and read no provisioning credentials.
- Local browser checks with synthetic SQLite/R2 data verified automatic count changes, label-required/empty-range disabled creation, a four-entry archive, literal `<coop>` label rendering, failed checksum readback retaining source, persisted progress after reload and **Continue archiving** completing 191 remaining entries in three chunks. Device switching correctly cleared the catalog/count. Overview heading and final versioned assets were read back. No page/CSP error or warning logs were observed; measured document widths stayed within viewports at 1280, 320 and 390 px. Desktop screenshots were visually inspected; the viewport override was reset.
- Syntax checks and Git whitespace checks passed. No cloud account access, deployment, remote migration, real data archiving, device commands/flash, Git staging, commit or push occurred. A production rollout still requires authorization, backup and migration 0004. These synthetic checks do not establish physical-device or production acceptance; existing orphan/capacity reconciliation limitations remain documented.

## Approved Signal dashboard deployment: 12 October 2026

- User selected Signal and authorized deployment with 1h, 6h, 12h and 24h trend ranges. Final Worker version: `8d50edc6-b376-44dd-bd48-dd06a29c9d40`; existing workers.dev endpoint and all backend bindings/configuration retained. Only dashboard assets changed; no schema, firmware, credentials, device settings or command writes.
- All **46 Node tests passed**, including eight trend tests covering full ranges/pagination, overlapping incremental updates, identity deduplication, cancelled/out-of-order requests, failures without partial publication, gaps/reboots/null values, spike-preserving rendering and server-anchored times. JavaScript syntax and Wrangler dry-run packaging passed.
- Isolated Edge browser checks passed for all four ranges with populated synthetic data, metric switching without extra requests, sample inspector, newest 100 history rows, desired/applied revision separation, logs' black child background, archives, failures, empty data, device switching and expired authentication. No JavaScript/CSP errors; widths 1280, 1024, 800, 390 and 320 px had no page overflow. Light/dark desktop and mobile screenshots were inspected.
- Final production readback at 18:40 Jakarta matched all five asset SHA-256 hashes. Health and anonymous rejection passed. Authenticated browser navigation, all trend ranges, latest-100 History, Settings, Console, Archives and mobile layout passed without device writes. Desired/applied revision 2, five-second sampling, calibration fingerprint 1004728304, firmware `cloudflare-1.0.1`, upload pause flag and latest-100 history hash matched the pre-deployment snapshot.
- The real device remained offline (last exchange 11 October 16:21:28 Jakarta). All four live trailing windows correctly returned zero readings; populated live-device trends and fresh ingestion were not validated. Local evidence, prior asset copies and private readback are in ignored `cloud/coop-monitor-worker/.local/signal-redesign/`. No commit/push occurred.

## Dashboard design proposals: 12 October 2026

- Created three separate interactive demo layouts (Fieldroom, Signal, Field Journal) in the thread's visualization directory; the source path is recorded in `PROJECT_CONTEXT.md`. They are proposals awaiting selection.
- Isolated headless Edge checks passed for all three: section navigation, metric/range changes, desired/applied revision separation, simulated command completion, history paging and empty-range filtering, and archive expansion. No page JavaScript errors were observed. Product containers had no horizontal overflow at tested browser widths 1080, 736, 390 and 320 px. Desktop screenshots of all three layouts were visually inspected.
- Data and device actions are synthetic/local. No active dashboard source, backend, cloud account, deployment or physical device was changed or validated by these preview checks.

## Authorized compatible backend deployment: 12 October 2026

- Following the user's instruction to deploy fixes that preserve ESP firmware integration, published Worker **`c57d5a65-0e42-483c-a2dd-04433b0858c3`** at the existing endpoint, retaining the D1/R2 bindings, protocol 1, retention and cron. Prior deployed version: `8a7b1e95-5fa9-4151-9223-8e796188c70b`. No firmware-sensitive deferred fix was included.
- Saved a private production D1 SQL backup in ignored `.local/audit-deploy-2026-10-12/`, then applied the sole pending migration, `0003_archive_catalog_index.sql`. Remote index/migration readback passed. D1 export/migration can briefly interrupt queries; the real device was already offline beforehand.
- All 38 Node tests passed again and Wrangler deployment dry run succeeded. After publishing, all four public asset SHA-256 hashes matched local files. Only `app.js` and new `csv.js` were uploaded; pre-existing HTML/CSS already matched production.
- Nine production checks passed on a generated synthetic device: registration, protocol-1 acknowledgement, retry acknowledgement, storage exactly once, conflicting-value rejection, wrong credential rejection, log acknowledgement/redaction, and desired-config schema. Removed the synthetic fixture and verified only the real device remained. No real or synthetic device commands were queued.
- Production health/private access, malformed JSON rejection, log pagination, archive catalog, CSV, secure owner-cookie login/readback, cross-origin logout rejection and same-origin logout passed. Real-device latest-100 history was identical before/after. Private evidence: `before.json`, `after.json`, `synthetic.json`, `session-and-preservation.json` and paired history captures under the ignored rollout directory.
- Real-device state was already stale before deployment and remained stale afterward: last exchange **11 October 2026 at 16:21:28 Jakarta**, firmware `cloudflare-1.0.1`, desired/applied revision **2**, sampling **5 seconds**, automatic threshold, three warning samples, calibration fingerprint **1004728304**. Stored settings/calibration and upload-enabled state were preserved; capacity was not paused. These are server readbacks, not fresh physical-device evidence. Verify new ingestion when the ESP32 reconnects.
- No credential rotation, firmware flash, real-device configuration/command, commit or push occurred. See [updated full audit](docs/BACKEND_AUDIT_2026-10-12.md). This deployment supersedes the initial local-only status in the audit entry below.

## Backend security/efficiency audit: 12 October 2026

- Local changes harden diagnostic/secret handling, login throttling, JSON/session validation, CSV exports and log cursors; reduce history query payloads; add an archive catalog index; and release maintenance leases after capacity/report failures. See [full audit and deferred findings](docs/BACKEND_AUDIT_2026-10-12.md).
- Node v24.19.0: **38/38 tests passed** using disposable SQLite databases and an R2 fixture, including the six existing history tests. Coverage includes firmware-v1 retries, calibration/state/config fields, desired/applied separation, command acknowledgements, pauses, optimistic rollback, authentication/CSRF, archive fault injection and CSV hardening. These are host tests, not sensor or field evidence.
- **20/20 isolated workerd/Miniflare checks passed** against the bundled Worker, local D1 and local R2: actual concurrent exchange transactions, cookie authentication, command receipts, pauses, gzip verification, archive download/checksum and source deletion. Workerd initially could not open temporary SQLite files inside the Windows sandbox; the authorized local-only run outside it passed. Synthetic credentials only, no Wrangler config/private credentials loaded, Worker outbound requests disabled. No production resources were accessed.
- Separate local diagnostics confirmed two stored readings for a reused sequence moved across minute windows; 11 active commands after simultaneous submissions into nine queue slots; no request-count increase from a paused exchange; and a request-budget pause with no warning flag. These firmware-sensitive behaviors were reported and left unchanged. They are reproduction fixtures, not evidence that the current device has encountered them.
- The catalog query plan changed from a device/hour index plus temporary sort to a device/key range index without the sort. The additive migration ran only in disposable test databases. JavaScript syntax checks (12 files), Worker bundling and Git whitespace checks passed.
- No firmware source/build/upload, device command, calibration change, account access, remote migration/deployment, commit or push occurred. Existing unrelated edits were preserved. Production rollout and physical integration remain separate, unauthorized work.

## V5a Top USB enclosure: 11 October 2026

- After review of the 2D top-USB proposal, the user authorized the 3D model, renders and printing-guide update. Separate outputs are in `outputs/coop_case_v5a_top_usb/`: 170 x 110 x 69 mm body, centered 130 x 65 x 15 mm bank, 135 x 20 mm nominal top bay, top wall aperture 122.5 x 17 mm, left ESP USB and left drawer removal. The old left bank opening is closed; the rear stays flat and closed. All 123 files in the preservation baseline remained hash-identical, including original V5/V5a artifacts.
- Blender 5.2.2 LTS reopened the native scene: exactly four printable, closed, consistently wound, single-component meshes; correct assembled bounds; all six actual assembled part-pair Boolean intersection volumes were zero. Rear-plane rays (72), top shell rays (15), blind pilot floors and assembled connector-corridor rays (60) passed. Each upper/lower unreleased latch independently intersected its catch during a 1 mm withdrawal. These are geometry checks, not release-force tests.
- Source-stock checks passed six component envelopes, enlarged pockets, provisional connector corridors and screw-head clearance. Continuous released drawer/bank translation over -175..0 mm passed 949 critical positions/intervals, checked separately against case/shelf/lid. The release model translates arms/hooks/pads inward 0.9 mm; it is not a deformation simulation.
- Fresh-directory execution of parameter preparation, clearance checks, mesh construction and hole finishing reproduced both parameter JSONs and all eleven delivered main/coupon STLs byte-for-byte. Reports are bound to parameter/STL/scene hashes as applicable; rebuild preparation invalidates downstream success reports. Evidence: `rebuild_verification.json`, `validation.json`, `clearance_verification.json`, `blender_validation.json` and `round_hole_verification.json` in the variant folder.
- Eight refreshed Blender views and an annotated overview were generated; the overview was visually inspected. Preview component envelopes are excluded from the saved printable Blender scene. The updated printing guide distinguishes the 17 mm shell aperture from the 15 mm provisional assembled corridor (Z=8..23), gives the 178 x 118 mm brim-only footprint, and identifies changed upper-boss/guide supports and service steps.
- Fresh inherited-profile reference slicing completed all eleven files with no warning/error/repair messages in captured output. Software estimate: 370.27 g for four main jobs and 14.51 g for seven separate coupons. Reference machine/profile only; no printer was operated and no G-code is packaged. Old V5a filament-saving claims do not apply to this variant.
- Physical connector fit is **not verified**: actual port centers/plug/bend are unmeasured, port face is 32.5 mm behind the outer top wall, and a left-end port may need lateral routing. Bank lift/tilt over the low stop, off-axis drawer loads with the interrupted upper guide, ungusseted upper-boss strength, supports, fatigue, ingress, mounting load and thermal behavior all remain physical acceptance tasks. No firmware/cloud/device actions were performed.

## Firmware log-area appearance correction: 10 October 2026

- Restored the Firmware logs card's original green background and heading/helper colors. Only the log output now has a pure black background and white monospace text, with inset padding. Updated the stylesheet content hash. This supersedes the whole-card styling below.
- Synthetic browser review confirmed card background `rgb(24, 36, 29)`, heading `rgb(231, 239, 233)`, helper text `rgb(175, 190, 180)`, log background `rgb(0, 0, 0)` and log text `rgb(255, 255, 255)`. Screenshot: ignored `outputs/cloudflare/firmware-log-area-preview.jpg`. Git whitespace review passed.
- Deployment completed as `8a7b1e95-5fa9-4151-9223-8e796188c70b`; public dashboard assets returned HTTP 200 and matched local SHA-256. The implementation correction changed only scoped CSS and its cache hash.

## Firmware logs console appearance: 10 October 2026

- Scoped the Firmware logs card on Console to a pure black background and white heading, explanatory text and log output, with an explicit monospace font for logs. Updated the stylesheet content hash.
- Synthetic browser review confirmed computed background `rgb(0, 0, 0)` and text `rgb(255, 255, 255)`, with visible sample logs. Screenshot: ignored `outputs/cloudflare/firmware-console-style-preview.jpg`. Git whitespace review passed.
- Deployment completed as `233e4ca1-e25f-48ab-932f-71641de2c0fa`; public assets returned HTTP 200 and matched local SHA-256. Only dashboard panel markup and CSS changed.

## Selected-range numbering and button alignment: 10 October 2026

- Both latest and selected-range History views now use one renderer: readings appear newest first by displayed sample time and row numbers descend from the loaded count to 1. Additional range pages fetch older blocks with `order=desc`, then re-sort and renumber the complete loaded table. The API's default ascending order and CSV retrieval remain available.
- Scoped History-form CSS aligns the From, To and Load selected range controls with equal 46 px heights and matching top/bottom edges on desktop. On mobile, the controls stack at full width. The stylesheet URL has the updated content hash.
- All six SQLite history tests passed, including descending range pagination without duplicate/missing samples and the existing ascending API behavior. Synthetic browser review confirmed 100 down to 1 by default, 900 down to 1 after loading a range, and 1,200 down to 1 after the next page, with descending timestamps and 1,200 unique sample times. Desktop controls shared exact top/bottom coordinates; a 390 px mobile viewport showed full-width controls without page overflow. Browser error/warning logs were empty. Screenshot: ignored `outputs/cloudflare/history-range-alignment-preview.jpg`.
- JavaScript syntax, Git whitespace and Worker deployment dry run passed. Deployment completed as `fde1e049-dffe-4e1d-812c-f2cc59b4739e`; public assets returned HTTP 200 and matched local SHA-256. No production history was read and no database schema, credentials, firmware, monitoring settings or device commands were changed.

## Bottom-up History numbering: 10 October 2026

- Corrected the newest-first latest-readings view to number from the loaded count at the top down to 1 at the bottom (100, 99, ... 1 for a full default view). Ascending custom-range queries retain chronological numbering and page continuity.
- JavaScript syntax and Git whitespace checks passed. Synthetic browser review confirmed all 100 row numbers descend consecutively, with top 100 and bottom 1. Screenshot: ignored `outputs/cloudflare/history-descending-numbers-preview.jpg`.
- Deployment completed as `a63b11c6-625b-453b-a7ea-8761192205f0`; public dashboard assets returned HTTP 200 and matched local SHA-256. Only dashboard row-number rendering changed.

## History row numbers: 10 October 2026

- Added a `No.` column immediately before Time, starting at 1 for each loaded history view and continuing from the existing loaded-row count when another range page is appended. New range loads, History re-entry and device changes reset numbering.
- JavaScript syntax and Git whitespace checks passed. Synthetic browser review confirmed eight table columns and consecutive numbers 1–100. Screenshot: ignored `outputs/cloudflare/history-number-column-preview.jpg`.
- Deployment completed as `9c6fd23d-3d1b-4d48-aafb-79affb5a2166`; public assets returned HTTP 200 and matched local SHA-256. Only dashboard table markup/rendering changed; no backend, database, credentials, firmware or device settings were modified.

## History tab loads latest 100 readings: 10 October 2026

- Opening History, reopening it or switching its selected device now loads the latest 100 individual retained readings, newest first. Fewer available readings produce a smaller result. The existing From/To range query, minute-block pagination and selected-range CSV export are retained. In-flight history responses are discarded when superseded or after device changes.
- Added owner-authenticated `/api/history?mode=latest&limit=100` using the existing route and schema. It skips empty blocks, includes overlapping boot windows before sorting by server-anchored sample time, and returns a reading count rather than a minute-block count. No additional API permission or schema change is introduced.
- All five `node --test scripts/history.test.mjs` tests passed using actual in-memory SQLite: dense/offline history, sparse windows, overlapping boots, empty/small results with retention/count validation, and existing range pagination. Browser preview using the actual history function and synthetic SQLite rows confirmed 100 rows on entry, 150 on a selected range, 100 on reopening and 0 after selecting an empty device. Browser error/warning logs were empty. Preview screenshot: ignored `outputs/cloudflare/history-latest-preview.jpg`.
- JavaScript syntax, Git whitespace and Wrangler deployment dry-run checks passed. Deployment completed as `ef71f71c-91a4-46e8-a7a7-70b796874df6`; public dashboard assets returned HTTP 200 and matched local SHA-256. These checks did not read private production history or modify firmware, credentials, device settings, commands or database schema.

## Dashboard calibration reference: 10 October 2026

- Added read-only current-calibration panels to Overview and Settings using the existing snapshot data. They show baseline, automatic/active threshold (mV and baseline multiplier), standard deviation, sample count, reference temperature/humidity, calibration revision and last-report time. The active threshold is shown only when the last reading matches the reported boot, calibration revision and applied configuration revision. Missing calibration and offline reports have explicit states.
- JavaScript syntax and Git whitespace checks passed. Wrangler deployment dry run passed. Browser review with clearly labeled synthetic data confirmed Overview/Settings rendering, no valid calibration, offline values and an active threshold awaiting a matching reading after calibration changes. Browser error/warning logs were empty. Sample preview: ignored `outputs/cloudflare/calibration-settings-preview.jpg`.
- Deployment completed as `31415bfa-f4ee-462a-ad87-e09cc03544b1`. Public `index.html`, `app.js` and `style.css` each returned HTTP 200 and matched local SHA-256. The stylesheet URL includes its updated content hash. No firmware, backend, database, credentials, commands or monitoring settings were changed. Authenticated production snapshot retrieval was rejected by automatic approval review, so this update does not claim visual verification against current physical-device data.

## Overview spacing correction: 10 October 2026

- Added a scoped 16 px gap between the overview metrics grid and state/capacity grid. The stylesheet link includes its content hash to avoid the older cached CSS observed during review.
- Wrangler deployment completed as `a56bc274-6d03-4ebb-afc9-414cb0a842e5`. The actual owner dashboard was visually reviewed after refresh; its displayed row gap was 16 px and live telemetry remained visible. Screenshot: ignored `outputs/cloudflare/overview-spacing-fixed.jpg`. No test suite was added or run for this layout correction.

## Device connection investigation: 10 October 2026

- COM5 identified as ESP32 USB VID `303A`, PID `1001`; the serial port was opened only after the owner closed Serial Monitor. Read-only `NET STATUS`, `CONFIG SHOW` and `CAL SHOW` confirmed the installed Cloudflare runtime, configured Wi-Fi/endpoint/device token, applied monitoring revision 1 and a valid retained 150-sample calibration profile. Live sensor blocks showed AHT20/BMP280 readings and warm-up status.
- Authenticated backend readback found one startup heartbeat for boot `486d27cf7e048fe0723577cbddc07fe9`, at `2026-10-10T08:44:03.613Z`, with firmware `cloudflare-1.0.0`, `STARTING` and no sensor readings. Later snapshots remained stale; capacity/owner write pause was false. This proves one authenticated device exchange, not sustained ingestion.
- Device status was `CLOUD RETRY` despite Wi-Fi connectivity. A non-destructive USB `NET RECONNECT` did not restore uploads during observation. Sanitized Worker tails showed owner snapshot requests but no corresponding device retries in those observation windows; headers/credentials were omitted from tail output.
- Physical Serial observations showed sampling advancing every two seconds while the host read data, but long gaps after the port was closed. Core 3.3.11 HWCDC source uses a default 100 ms TX wait with up to 20 successive waits per write when the host stops consuming. The firmware wrote sample blocks before cloud publication and printed some network output while holding the shared mutex. This identifies a USB backpressure defect. The initial transport failure did not expose an HTTP/TLS code, so its precise contribution cannot be isolated retrospectively.
- The `cloudflare-1.0.1` fix configures nonblocking USB TX with bounded buffering, skips optional sample blocks without enough buffer space, publishes readings/OLED state before Serial output, removes status/announcement printing from the shared lock, and adds non-secret HTTP/TLS/Wi-Fi/heap/stack diagnostics. Connection/read timeouts increase to 15 seconds; certificate validation remains enabled. ESP32-C3 compilation passed: **1,289,117 / 2,097,152 application bytes (61%)**, **68,172 static RAM bytes (20%)**, 259,508 bytes remaining before runtime allocations. Output: ignored `outputs/cloudflare/connection-fix-build`.
- After explicit owner approval, a fresh calibration export was saved in ignored `outputs/cloudflare/backups/calibration_connection_fix_20261010_085855_UTC.txt`. Esptool identified a 4 MB ESP32-C3 and read all **4,194,304 bytes** to `flash_connection_fix_20261010_085927_UTC.bin`; SHA-256 **`7EAEF77F0A8484ABA19997979CF405391BA0B8EBCA44058082D1905091FF6595`**. The backup/hash are private ignored files; physical restore was not exercised.
- Arduino CLI uploaded the separately addressed bootloader, partition table, boot metadata and application with **erase-all disabled**, verified written hashes and reset the device. NVS at `0x9000` and the previous filesystem were outside the write/erase ranges. USB reported `cloudflare-1.0.1`; post-upload `CAL SHOW` exactly matched the pre-upload export: baseline **251.473 mV**, threshold **289.194 mV**, SD **1.709 mV**, **150 samples**. Existing Wi-Fi/device settings were configured and applied configuration remained revision 1.
- Real device ingestion resumed on boot `ddde40cf2307d80bc937f1a17555c604`: the first backend readback at `2026-10-10T09:01:52.056Z` was fresh, calibrated and `WARMUP`, with actual MQ/AHT/BMP measurements. Later history readback at `09:03:35Z` contained **58 real readings**, including successive uptimes 111782, 113776 and 115780 ms while the serial reader was closed. No readings/logs were dropped. A brief stale snapshot between successful exchanges recovered without intervention; this short observation is not a continuous-availability guarantee.
- At `2026-10-10T09:06:23.325Z`, history contained **140 consecutive readings** from sequence 1 through 140 with **no missing sequence IDs**. Adjacent sample intervals were **1,993–2,136 ms** over this short run; reported reading/log drop counts remained zero and backend state was fresh. The serial reader had been closed since approximately one minute after boot. Warm-up remained active as expected after the upload reset.
- The actual owner dashboard displayed these sensor values and firmware/calibration state. Sanitized Worker tails subsequently showed physical `POST /api/device/exchange` responses **HTTP 200**, outcome `ok`, with no exceptions. Request headers and credentials were omitted. Snapshots/history evidence is saved under ignored `outputs/cloudflare/`.
- No calibration, Wi-Fi credential, threshold or sampling setting was rewritten. Serial ports and temporary Worker tails are released after observation. Remaining device acceptance includes independent power-cycle persistence, warning/OLED observation, changed settings, each command, Wi-Fi outage/overflow/pause/recovery and a 24-hour run with measured account usage.

## Cloudflare firmware source: 10 October 2026

- The active monitor now uses Cloudflare protocol v1 at the deployed `/api/device/exchange` endpoint. Source was prepared on `codex/cloudflare-firmware` from `codex/quicktest` for the requested publication to `main`. Historical branch refs and the original SD commit remain available.
- Readable Serial, sensor/OLED integration, the accepted calibration format/namespace and warning guards are preserved. Settings, logs, command receipts/recovery and a separate HTTPS task are integrated. Measurements/logs use bounded RAM, and the new runtime does not mount/format legacy flash measurement storage.
- Final ESP32-C3 Arduino compilation passed with ESP32 core **3.3.11**, board `esp32:esp32:nologo_esp32c3_super_mini`, USB CDC enabled, no OTA, supplied `partitions.csv` and erase-all off. Application: **1,286,925 / 2,097,152 bytes (61%)**. Static globals: **67,956 / 327,680 bytes (20%)**, leaving **259,724 bytes** before task stacks, heap, JSON and TLS runtime allocations. Output: ignored `outputs/cloudflare/build`. This is compilation, not a measured runtime RAM result.
- The live HTTPS endpoint presented an authorized Let's Encrypt YE2 chain through ISRG roots during the host inspection. Public ISRG Root X1/X2 were obtained from official Let's Encrypt URLs and checked against SHA-256 fingerprints; GTS trust roots are retained for issuer rotation. Firmware uses CA and hostname validation with no insecure fallback. This does not establish an ESP32 TLS handshake.
- Provisioning now reads the separate ignored `dashboard.local.json`; Wi-Fi settings use secure prompts and credentials are not printed. The upload helper adds legacy pending-data checks and a full 4 MB flash backup/SHA-256 before an erase-all-off upload. Neither helper was executed against a COM port during this source update.
- PowerShell parsing passed for the build, upload and provisioning helpers. Git index whitespace review passed. All 67 indexed files were compared locally against actual owner/device/session/legacy secret values; no matches were found. Local credential files, backups and generated builds are Git-ignored. This source review did not open a serial port or perform physical recovery.
- No new tests were added or run for this firmware update. Earlier legacy tests below do not establish Cloudflare firmware behavior. The source build and review do not prove sensor timing, warning behavior, NVS persistence/recovery, command execution or network handling on the physical board.

**Subsequent physical recovery:** the connection investigation above completed the approved upload, retained provisioning/calibration, real sensor ingestion and dashboard display. Independent power-cycle persistence, warning/OLED observation, changed settings, each command, interrupted-command/restart recovery, Wi-Fi outage, RAM overflow, owner pause and a 24-hour run remain. See the [current firmware guide](firmware/coop_monitor/README.md).

## Cloudflare backend deployment: 10 October 2026

The original backend acceptance used Worker version `46c5362c-39a0-4472-ba44-7f00fadbe996`, with D1 `coop-monitor-db`, private R2 `coop-monitor-archives` and registered device `coop-monitor-01`. The later overview spacing deployment is recorded above. The earlier backend work passed **32 live acceptance checks** using identified synthetic data, including authentication, duplicate retries, settings/commands, pause/resume, export and verified archive/retention. Its final fixture contained 900 readings in 30 minute blocks; gzip readback/checksum passed and the fixtures were cleaned up. See [backend evidence](cloud/coop-monitor-worker/VERIFICATION.md) and [deployment details](cloud/coop-monitor-worker/DEPLOYMENT.md).

These were backend checks from the deployment stage, not newly run firmware tests. No backend redeployment, physical flash, calibration, real sensor ingestion or independent database restore was performed during the firmware source publication.

## Historical Wi-Fi / QuickTest evidence

The dated results below describe older firmware and Apps Script deployments. References to the previous `main` SD implementation and branch creation describe those dates; the current `main` source is Cloudflare. Preserve the evidence without interpreting it as current physical acceptance.

## Quick-test branch: 4 October 2026

- User-provided device Serial output after explicit `QUEUE INIT EMPTY` reports
  `@QUEUE,INITIALIZED`, `queue=ready`, `metadata=ready`, 4,194,304 chip bytes,
  1,966,080 filesystem bytes with 24,576 used (1,941,504 free), and 552 NVS free
  entries. This confirms physical filesystem provisioning and an empty session
  checkpoint on the installed device. Calibration and network settings remain
  missing in that output; record persistence and physical uploads are not yet
  established. Successful initialization now clears the stale startup
  `FLASH QUEUE ERROR` status text.

- Windows PowerShell 5.1 helper fix: default configuration paths are resolved
  in the script body instead of parameter defaults. The reported empty
  `PSScriptRoot`/`Join-Path` failure was reproduced before the change. Startup
  afterward reached the Wi-Fi prompt using the default config from both the
  project folder and a different working directory; explicit missing-config
  handling also passed. These checks used noninteractive mode and an invalid
  test port, so they did not open COM5 or write device settings. The live
  endpoint helper's matching default-path issue was corrected too.

- `codex/quicktest` was created from `codex/wifi-cloud` commit `60356cd`.
  `main` and `codex/wifi-cloud` remain separate; unrelated test sketches/files
  were left untouched.
- Firmware adds next-boot arming for 15/30 minutes, two-second local recording,
  BOOT hold/Serial early stop, manual upload, closed-session restart protection,
  calibration snapshots and isolated `/quicktest` storage. No field records are
  discarded on overflow; it stops and reports Storage error.
- Physical **read-only** COM5 probe identified ESP32-C3 revision v0.4, embedded
  **4 MB XMC flash**, manufacturer 0x46 / device 0x4016. `CAL EXPORT` returned
  `@CAL,MISSING,mq135-01`; calibration must be completed before arming. No new
  firmware was uploaded, flash erased, or calibration written by these probes.
- Record size is 128 bytes; compiled host session/adapter tests measured
  **450 records / 57,600 bytes** for 15 minutes and **900 / 115,200 bytes** for
  30 minutes. Two calibration profiles occupy 64 payload bytes; two session
  checkpoints occupy 256 payload bytes, including calibration snapshots.
  The partition table allocates 1,966,080 bytes LittleFS and 20,480 bytes NVS.
  Physical filesystem/NVS overhead is additional; arming checks actual free
  LittleFS space (131,200/188,800 bytes minimum) and successful NVS persistence.
- Final ESP32-C3 Arduino compilation (core 3.3.11, USB CDC, supplied no-OTA
  partitions, erase-all off) passed: **1,288,179 / 2,097,152 application bytes
  (61%)**, **39,836 static RAM bytes**, 287,844 bytes remaining before runtime
  allocations/task stacks. The build did not upload the device.
- Session tests passed for calibration snapshot persistence, arm-on-next-boot,
  closed-session reboot, early stop, BOOT release/hold timing, millis rollover,
  interrupted-session recovery, checkpoint CRC/write faults, acknowledged
  prefixes, full-queue refusal and preservation of legacy cloud queue files.
  Existing queue faults, real adapter with a host filesystem stand-in, and
  reading formatter regressions passed. These are simulations, not physical
  LittleFS power-cut tests or measured sensor timing.
- Apps Script source v1/v2 passed mock tests for authentication, field and
  calibration validation, typed values, unknown/NTP time, separate tabs,
  locks, duplicate retries and server failure after committed writes.
- Private `QuickTests` tab has 29 verified headings, frozen header, typed
  date/numeric formats, filter and calibration/time notes; Jakarta timezone
  retained. Drive metadata confirms owner-only permissions, `shared: false`.
- Apps Script editor readback matched local `Code.gs`. The existing deployment
  was updated to **version 2**, retaining URL, token, execute-as-owner and
  Anyone access. API v1 still writes to `Readings`; v2 writes to `QuickTests`.
- Live certificate-validated v2 test rejected a wrong token and acknowledged
  the same two synthetic IDs twice. Independent `QuickTests!A1:AC5` readback
  found exactly two rows for boot `4e1bbaff999241b6b4e8701d8e47bdd2`, with session
  `65c66e3aca064ad29387f74b50f62f48`, elapsed 0/2 seconds, outcome Stopped,
  duration 30, and numeric calibration 1000/1150/12 mV, 150 samples, 29 C, 65 %RH.
  Unknown sample time remained blank and server receipt time was separate.
  Original API v1 live retry/authentication test also passed, with two independently
  read-back rows for boot `e98204fd780a4b679afe23f7f3800f1e` in `Readings`.
  These four synthetic rows were cleared after verification, preserving formats.
  Final readback of both tabs contains only their headers; the ready QuickTests
  layout was inspected in the browser and captured in ignored outputs.

**Still requires the flashed device:** calibration and power-cycle persistence,
BOOT early stop, timer/sensor timing,
physical interrupted-write recovery and real device HTTPS/Sheet ingestion.
Flash-chip capacity identification and host/server tests do not prove these.
The field rehearsal and eight-step guide is retained on `codex/quicktest`.
The following results describe the earlier cloud branch.

## Earlier Wi-Fi cloud implementation: 2 October 2026

- Branch `codex/wifi-cloud` was created from `main`. Only the integrated monitor,
  its cloud support/setup/tests, root README and ignore rules were changed.
  `main` retains the SD firmware.
- Actual Arduino compile using ESP32 core 3.3.11, board
  `esp32:esp32:nologo_esp32c3_super_mini`, USB CDC enabled, no OTA, erase-all off,
  and the supplied custom partition table passed: **1,278,751 bytes** of the
  2,097,152-byte application partition (60%). Globals use **39,580 bytes**;
  288,100 bytes remain before runtime allocations and task stacks.
- Packed record size was measured by the compiled shared implementation:
  128 bytes; capacity 4,096; logical payload 524,288 bytes. Periodic-only
  retention is 34 hours 8 minutes. The host adapter held 4,096 recent records
  after 10,000 appends, reclaimed retired segments, and used no more than
  65 record segments (up to 63 retired records of extra segment space).
- Shared queue state-machine fault injection passed: reboot, empty-queue
  sequence persistence, overflow, lost acknowledgement, committed append with
  lost write response, failed checkpoints, metadata fallback and CRC faults.
- The actual `FlashStorage` adapter passed against a host FS stand-in: short
  append-tail recovery, oldest-first batches, overflow/reclamation, failed
  metadata replacement, corruption refusal, and no formatting on mount failure.
  This exercises adapter code, not LittleFS internals or real flash electronics.
- Existing extracted Serial/CSV formatter regression checks passed: units,
  unavailable measurements, status labels, incomplete blocks and compatibility.
- Actual Apps Script source passed Node platform-mock tests: token rejection,
  malformed/out-of-range records, batches/IDs, typed dates/numbers, unknown time,
  lock contention, deduplication and a committed write whose response was lost.
- PowerShell helper syntax and Git whitespace checks passed. Local config/token
  is ignored by Git; the partition CSV is explicitly retained.

Run `firmware/coop_monitor/test_wifi_cloud.ps1` to repeat host checks;
`build_wifi_cloud.ps1` performs the actual embedded compile without uploading.

## Google resources verified

- Native private Sheet [Coop Monitor — WiFi Cloud](https://docs.google.com/spreadsheets/d/1Pv_26gZrTQ3hHmFqBW2cFxugm8JXZ5-FyX_x4JqN9ro/edit)
  exists, with the `Readings` tab, all 19 unit-bearing headings, frozen first
  row, typed formats, filter and `Asia/Jakarta` timezone.
- Drive metadata readback confirmed native Google Sheets MIME type,
  `shared: false` and owner-only permissions. Header readback matched Apps
  Script's schema exactly. Native layout was inspected in Google Sheets.
- Apps Script [Coop Monitor — WiFi Cloud Upload](https://script.google.com/home/projects/1Tku2mbG-vDyCZpq0wCFpFHTmzkCRAC4CKpWX9oWROuEYx_Z13t4qePw4/edit)
  was created. Installed editor source was read back and matched `Code.gs`.
  The manifest and spreadsheet ID/device token Script Properties were saved.
- After account authorization, deployment version 1 was confirmed in Manage
  deployments: execute as the owner, access Anyone. Its actual `/exec` URL was
  saved in ignored local device settings; it is not a reader of private data.
- `test_live_endpoint.ps1` passed against that actual deployment using
  certificate-validated HTTPS: a wrong token was rejected with `UNAUTHORIZED`,
  and two submissions of the same two synthetic IDs returned matching
  acknowledgements. Google's redirect response was retrieved via GET without
  replaying the request token/body.
- Independent Sheet readback confirmed exactly two rows for those IDs, numeric
  measurements, `NA` for an unavailable baseline ratio, blank unknown sampled
  time, the synchronized sampled time, and a separate server receipt time.
  Receipt was displayed as 2026-10-02 12:31:48 in Jakarta; the synchronized test
  sample showed 12:31:42. Owner-only sharing was reconfirmed after deployment.
- The two synthetic rows were cleared after verification; final Sheet readback
  contains only the original headers. Test screenshots are saved in ignored
  `outputs/wifi_cloud_01a0fad4/`. These were server tests, not sensor readings.

## Physical verification still required

The ESP32 was not connected during this implementation; COM enumeration found
only Bluetooth serial ports. No firmware was uploaded and no physical readings
were sent to Google Sheets. Compilation does not verify the installed flash size.

Use the upload helper to verify actual 4 MB flash and back up `CAL EXPORT` before
changing partitions. Then confirm `CAL SHOW` agrees, explicitly initialize only
a known empty LittleFS volume, configure networking, and read back a sensor row
from the private Sheet.

| Check | Required device/cloud evidence |
|---|---|
| Normal uploads | Real sensor IDs acknowledged and rows read back from Sheets |
| Wrong Wi-Fi credentials | Queue grows; two-second samples and warnings continue |
| Wrong device token | Server rejects; device retains pending IDs |
| Internet/NTP outage | Offline samples have unknown time; queue survives restart |
| Lost acknowledgement | Retry produces one row per ID and eventually retires it |
| Restart/power interruption | Committed records survive; short tails detected; no automatic format |
| Queue overflow | Newest 4,096 pending records retained; persistent discarded count rises |
| Monitoring during upload failure | Physical sample timing and OLED warning priority observed |
| Firmware change | Flash backup preserved; calibration values match after upload |

The 4,096-record capacity is verified in compiled host tests. Actual filesystem
space, flash durability/power-cut behavior, radio/power stability, wall-clock
sampling timing under load, calibration persistence on a device and real device
ingestion remain separate, uncompleted checks. Live Google ingestion has been
verified using synthetic records only.
