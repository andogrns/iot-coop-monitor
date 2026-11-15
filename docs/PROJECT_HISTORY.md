# Historical project context

> Frozen on 22 October 2026 before the current-stack documentation refresh. This preserves the previous project context and dated decisions. Words such as "current", "now" and "live" below refer to their original recorded dates, not the day this file is read. Use [current project context](../PROJECT_CONTEXT.md), [project handoff](PROJECT_HANDOFF.md) and [dated verification](../VERIFICATION.md) for ongoing work. This history grants no new operational authorization.

Reconstructed on **11 October 2026** from current local code/documentation, project-specific Codex memories, and available Codex conversations. This is a durable handoff for Hermes and Codex, not a live monitoring report. See [import provenance](../docs/CODEX_CONTEXT_IMPORT.md).

## Purpose and current architecture

Low-cost poultry-coop environmental monitoring and early warning. An ESP32-C3 reads MQ-135 relative gas response, temperature, humidity, and pressure; shows local OLED/USB readings; and exchanges telemetry, monitoring settings, and allowlisted commands with a private Cloudflare dashboard.

**MQ-135 is not a calibrated, ammonia-selective ppm meter.** Research and UI should describe relative gas response/air-quality changes and preliminary early-warning evaluation. Independent reference measurements are required for stronger concentration/accuracy claims.

| Area | Current local implementation |
|---|---|
| Firmware entry point | `firmware/coop_monitor/coop_monitor.ino` includes `dashboard_runtime.h` |
| Version/protocol | `dashboard_protocol.h`: `cloudflare-1.0.1`, protocol 1 |
| Device | `coop-monitor-01` |
| Cloud | Worker `coop-monitor-worker`, D1 `coop-monitor-db`, private R2 `coop-monitor-archives` |
| Dashboard | Overview, History, Console, Settings, Archives; vanilla HTML/CSS/JS |
| API | Authenticated `POST /api/device/exchange`; separate owner session/authentication |
| Default cadence | Sensor readings every 2 seconds; dashboard refresh every 4 seconds |
| Recent retention | `wrangler.jsonc` currently specifies 30 days; maintenance cron every 15 minutes |
| Local storage | Calibration, credentials, configuration, command receipts in NVS; measurements/logs buffered in RAM only |
| Update method | USB, existing 4 MB/no-OTA layout, erase-all disabled |

## Hardware and invariants

- ESP32-C3 **SuperMini**, not a classic ESP32 with GPIO34.
- MQ-135 heater/module power: stable 5 V/VBUS; analog AO passes through two 10 kOhm divider resistors to **GPIO3**; DO unused; shared ground.
- Combined AHT20/BMP280 board and SSD1306 128x64 OLED: 3V3, shared I2C **GPIO4 SDA / GPIO5 SCL**.
- MicroSD is unused. BOOT/GPIO9 has its normal bootloader role, not a field-session stop function.
- Ten-minute boot warm-up; calibration uses ten-minute stabilization and five-minute collection, at least 60 valid samples. Gas warnings remain guarded during warm-up/calibration/invalid conditions/ADC-high.
- Automatic threshold uses the higher of baseline +15% or baseline +3 standard deviations. Manual threshold is **10–2399 mV at the divided ADC input**, not a multiplier or ammonia ppm. Default warning confirmation is three consecutive samples.
- Keep the unchanged `coopcal` accepted calibration format/namespace. Calibration revision is a fingerprint, not an increasing counter.
- RAM capacity: 64 readings and 16 logs. Overflow drops oldest readings; reboot loses pending RAM data. No persistent offline measurement recovery is implemented in the active build.
- Cloud console contains bounded firmware logs/command outcomes, not every USB line or boot-ROM output. Device commands are allowlisted; no arbitrary shell, OTA, remote calibration import, or remote credential change.

## Decisions recovered from Codex

**History date consistency — deployed, 13 October 2026:** The History table explicitly displays padded **DD/MM/YYYY** to match the date picker. Browser-local timezone/time formatting and estimated-time labels remain. After fresh user approval, version `bc8c9f1d-bcab-4279-b527-e94dc2ce89f5` was deployed. Local syntax/formatter/browser checks, six live asset hashes and eleven read-only API/preservation checks passed; readings/settings/calibration were unchanged.

1. **Cloud uploads replaced SD and QuickTest workflows.** Earlier offline experiments and power/battery plans are historical. The cloud migration assumed available power/internet, but the implementation must still report outage-related gaps honestly.
2. **Direct Cloudflare was selected after a Sites/other-hosting comparison.** Keep owner access private and device credentials separate; do not create replacement databases/buckets just because an old setup guide mentions doing so.
3. **Retain every sensor sample, then archive losslessly.** Older D1 minute blocks become compact gzip JSON in private R2; verified readback/checksum precedes source deletion. Console logs have separate short retention and are not sensor archives. Normal History does not query archived files.
4. **Avoid automatic paid upgrades; warn, then pause new writes near capacity.** Application budgets and billing notifications are not a provider-enforced zero-cost cap. Recheck provider allowances before financial/capacity advice; historical estimates are not guarantees.
5. **Computer capture is optional and manually controlled.** The user explicitly rejected an always-on/scheduled computer logger. The ESP should operate without an open Serial Monitor.
6. **Preserve essential-only Git scope.** Shopping/procurement scripts, diagnostic sketches, CAD/proposal outputs, local keys, and captures are not automatically part of a firmware/dashboard commit.
7. **Dashboard details are deliberate requirements.** History defaults to 100 recent readings (or fewer), newest first; its footer selects 50, 100, 250, 500 or 1,000 entries and newest/oldest first. Newest-first numbers count down from the loaded total; oldest-first numbers count up from 1. Calibration reference panels are read-only. Only the log-output area is black/white monospace, not the surrounding card.

## Verified evidence versus unresolved work

`VERIFICATION.md` records **10 October 2026** physical upload of `cloudflare-1.0.1`, matching calibration before/after, retained provisioning/configuration, actual cloud/dashboard readings, and a short run of 140 consecutive readings with Serial Monitor closed. The USB backpressure repair is part of 1.0.1.

These are historical observations, not today's device state. Codex later reported a stale/offline snapshot in its same-day capacity assessment. Do not infer continuous uptime from the earlier successful run.

The backend's recorded synthetic acceptance, physical observations, and deployment asset checks are separate evidence. During this context migration, six local SQLite history tests passed with the existing code. No device connection, cloud account access, deployment, calibration, or firmware upload was performed.

Outstanding device/field acceptance:

- Independent power-cycle persistence and physical OLED/warning guards.
- Changed settings and desired/applied revision convergence.
- Every supported command, expiry, restart, interrupted-command uncertainty/recovery.
- Wi-Fi loss/reconnect, RAM overflow, owner pause, and recovery/gap reporting.
- A 24-hour run plus measured account-wide capacity/resource usage.

## Open decisions / likely next work

### Archive folders and ZIP downloads — tested and deployed, 13 October 2026

The library now groups each manual archive ID into one expandable entry showing label, selected date range, archive date and saved file/entry totals. Duplicate labels stay separate. Automatic chunks group by their existing hour. Opening a folder lists files in save order with individual links, checkboxes, **Download all files**, **Download selected**, and **Select all loaded files**. All/selected downloads produce one ZIP containing unchanged `.json.gz` bytes after SHA-256 verification; all-file downloads follow every file page. Unfinished folders retain **Continue archiving**.

Added owner-only read routes `/api/archive-folders` (50 folders/page) and `/api/archive-files` (100 files/page), with device/folder-bound cursors, using existing tables. No schema/ingestion/retention change. **82 Node tests**, **50 isolated Worker checks**, synthetic browser desktop/mobile checks and independent ZIP/gzip validation passed. After fresh user approval, published Worker **`d19d670b-57b4-4108-be5f-ed7ca5b35c32`**, superseding `7bbc4775-3566-4c61-b5e8-130062fe35f8`. All **nine deployed asset hashes** matched. Live Home Testing Session appeared once with correct metadata, 19 files and 2,206 entries; its job/original manifests matched the pre-deploy hash. Full and selected-two-file ZIPs independently passed CRC, compressed/original SHA-256, gzip/JSON, metadata and duplicate-sample checks (2,206 / 1,245 entries). Private access/device isolation/invalid cursor checks passed.

Production verification was limited to public assets/health and the named archive. No snapshot, History, settings or calibration were read, and no cloud data/device writes, migration, firmware or Git publication occurred. Authenticated production browser UI and fresh physical ingestion were not tested; synthetic browser behavior plus live APIs/assets were verified separately. Ignored `.local/archive-folders/` contains evidence. The broader `readback.mjs` was rejected before execution and remains unused; use the approved `public-readback.mjs` / target-only `verify-live.mjs` instead. Localhost 8791 remains a synthetic preview.

### History range count — tested and deployed, 13 October 2026

History now shows the total selected data entries below its From/To picker, using the same read-only selection count as Archives. Date edits debounce for 300 ms; History entry, device changes and range submission refresh the count. The count covers the complete inclusive range, independent of loaded rows/page size/order, and does not load a changed range into the table until submission. Empty/invalid ranges and request failures are explicit; old responses cannot replace a newer selection. Counts preview entries currently in D1, excluding archived data/logs, and can change with ingestion/archiving.

Version **`7bbc4775-3566-4c61-b5e8-130062fe35f8`** supersedes the date-format rollout. **74 Node tests**, synthetic desktop/mobile browser checks, seven live asset hashes and eleven API/preservation checks passed. The live 24-hour total of **1,468 entries** matched complete duplicate-free History pagination in both orders; invalid and anonymous count requests were rejected. No backend/schema/firmware change or cloud data/device writes. Stored settings/calibration/latest readings were preserved. See verification records and ignored `.local/history-selection/` evidence.

### History ordering — tested and deployed, 13 October 2026

Added **Order: Newest first / Oldest first** beside the page-size dropdown, defaulting to newest first. Both the recent-retention view and selected ranges paginate from the chosen end. Changing order reloads the loaded view, preserves unsubmitted date edits as edits, and keeps the current page size; next batches append in that direction. Numbering counts down for newest first and up for oldest first. Choices remain across device/tab changes in the current open page; refresh restores defaults.

Entry cursors now bind the order, with prior six-field descending cursors still supported. The ascending query includes overlapping boot windows around its final candidate before bounded tuple sorting. No migration/ingestion/export/trend changes were required. Deployed Worker **`aee21cc5-7810-44d5-a934-f960a20b1364`** supersedes the page-size version below. **67 Node tests**, **44 isolated Worker checks**, synthetic desktop/mobile browser tests, **44 read-only production ordering checks**, six asset hashes and eleven API/preservation checks passed. Latest-100 real readings/settings/calibration/firmware/pause state stayed unchanged; device remained offline. Authenticated production browser UI and fresh physical ingestion remain untested in this rollout. Evidence: ignored `.local/history-order/` and verification records; no cloud data writes, firmware or Git publication.

### History page size — tested and deployed, 13 October 2026

The user requested autonomous testing/deployment while away. The History footer now places **Entries per page** beside **Load next page**, with 50, 100 (default), 250, 500 and 1,000 options. Changing size reloads the active latest/range view; unsubmitted date edits do not change that loaded range. Next pages append another batch, preserve newest-first server-anchored order and renumber loaded rows. The choice remains for the browser session and device/tab changes. Empty/final pages hide the next button while keeping the selector available.

Optional `pageSize` on the existing history endpoint uses individual-entry cursors with a frozen latest window and range/device validation. Candidate blocks include boot-window overlap before bounded JSON projection; legacy `limit` block pagination/latest-100 requests, trends, exports, ingestion and schema are unchanged. Worker **`2a12ba13-95e3-40e2-8456-ba54232471ad`** supersedes the manual-archive version below. All **65 Node tests**, **36 isolated Worker checks**, synthetic browser checks at 320/390/1280 px, **22 read-only production pagination checks**, six asset hashes and eleven API/preservation checks passed. No migration, real-data writes, commands, firmware/Git publication or credential changes occurred. Device state/latest-100 hash was preserved; fresh physical ingestion and authenticated production browser UI were not tested. Evidence remains in ignored `.local/history-page-size/`; see verification records.

### Manual range archives — approved and deployed, 13 October 2026

Archives now has From/To date-time pickers (browser timezone, inclusive endpoints, up to 31 days), an automatically counted selection of individual History entries and a required label of up to 80 characters. Manual jobs save verified private gzip chunks and move only the selected tuples out of History; progress and **Continue archiving** survive page interruption. Labels/ranges remain in the library and archive document. Overview's heading is now **Environment Readings**.

New migration `0004_manual_archives.sql` adds the job catalog, manifest association and per-block archived sample fingerprints. Fingerprints keep identical firmware retries acknowledged without reinsertion, retain value-conflict detection and the existing 32-sample minute limit; outside-range data, device state and counters remain. Automatic retention/cron/protocol/firmware/configuration are unchanged. Source revision checks and the shared maintenance lease protect concurrent archiving/ingestion; failed chunks retain source entries. The final saved count can differ when data arrives or automatic retention runs after preview.

After the user approved the preview and requested deployment, a private D1 backup preceded remote migration 0004 and Worker **`0ce40449-3102-4c19-b53d-22dfd179bbc0`** publishing at the existing endpoint. All six deployed asset hashes, owner/private API readback and **22 synthetic production checks** passed; the disposable device, database rows and exact R2 test object were removed. Latest 100 real readings, desired/applied revision **3**, **30-second** sampling, calibration fingerprint **2300842445**, firmware and upload-enabled state matched before/after. These current stored values supersede the 12 October snapshot below; this rollout did not change them. The real device was already offline, last exchange **13 October at 08:16:23 Jakarta**. Fresh physical ingestion remains pending. No real readings were manually archived, device commands/settings/flash or Git publication occurred. See the 13 October verification entry and API/operations documentation. Normal History still does not search archived files.

### Signal dashboard — approved and deployed, 12 October 2026

Created local interactive proposals named **Fieldroom** (sidebar and spacious cards), **Signal** (compact top navigation and telemetry layout), and **Field Journal** (notebook typography and vertical metric rail). All use explicit demo data and simulated actions, preserve relative MQ-135 wording, read-only calibration, black/white log output, and desired/applied revision separation. Source: `C:/Users/Ando/.codex/visualizations/2026/10/12/01a12fcd-abd1-7a81-acea-5a8d27f0e814/coop-dashboard-designs.html`.

The user selected **Signal**, requested **1h / 6h / 12h / 24h** trend ranges, and explicitly authorized deployment. The responsive dashboard is deployed as Worker **`8d50edc6-b376-44dd-bd48-dd06a29c9d40`** at the existing endpoint. Metric tiles select MQ mV, temperature, humidity or pressure; the gas ratio remains visible below MQ. Full calibration/capacity details remain accessible in expandable panels. The prototypes above remain preserved as proposals; the active dashboard uses real authenticated data.

`public/trends.js` pages the existing history API, uses server-anchored times, preserves extrema when reducing display points, and breaks lines at missing metric values, boot changes and timing gaps. Initial/range/manual refresh loads the whole window; minute updates overlap the most recent two minutes. Very late arrivals outside that overlap require **Refresh trend** to reload the full window. It does not change sampling, backend API, schema, firmware, quotas or retention. See the README and verification records for request/validation limits.

All 46 Node tests, isolated browser interaction/CSP checks at 320–1280 px, and deployment packaging passed. All five live asset hashes matched. Authenticated production browser checks passed for all sections and trend ranges; device settings, calibration, firmware, pause state and latest 100 readings were unchanged. The device was still offline, last exchange **11 October 16:21:28 Jakarta**, so all four trailing trend windows were empty; populated charts were verified with synthetic local data only. No device commands, firmware flash, schema migration, Git commit or push occurred.

### Backend audit — compatible fixes deployed, 12 October 2026

The [backend audit](../docs/BACKEND_AUDIT_2026-10-12.md) records fixes for diagnostic/secret disclosure, login-map reset, malformed owner payloads, session configuration, CSV export, log cursors, history query projection, archive catalog indexing and maintenance lease release. All 38 Node tests and 20 isolated workerd/Miniflare checks passed. After the user explicitly instructed deployment, a private D1 backup was saved, migration `0003_archive_catalog_index.sql` applied, and Worker version `c57d5a65-0e42-483c-a2dd-04433b0858c3` deployed at the existing endpoint. Four asset hashes matched, nine production synthetic checks passed with fixture cleanup, owner-session checks passed, and the latest 100 real readings were unchanged. No firmware, credentials, real-device settings or commands were changed; no Git publication occurred.

The real device was already offline before deployment (last exchange 11 October at 16:21:28 Jakarta). Its stored desired/applied revision is 2, sampling interval is **5 seconds**, calibration fingerprint is 1004728304 and firmware is `cloudflare-1.0.1`. The two-second value above remains the default, not the currently saved setting. Fresh physical ingestion after deployment remains to be checked when the ESP reconnects.

Firmware-sensitive findings were reported and intentionally left unchanged: cross-minute sequence deduplication, command/log admission races, incomplete capacity accounting/request warnings, archive boundary overlap, accepted/running command lifecycle, and boot-clock drift recovery. Distributed abuse protection and orphan/capacity reconciliation also need review. Preserve protocol 1, existing IDs/acknowledgements, desired/applied settings, cadence and NVS. See the audit for evidence, residual limits and rollout steps; these are proposed follow-ups, not approved changes.

### Four-week study and seven-day retention — discussion only

In the **10 October 2026** archive conversation, the user stated a **four-week data-collection period** and considered archiving data older than seven days so real archiving happens during the study. The user explicitly requested **no changes yet**.

The recommendation was seven-day **searchable retention**, while keeping the 15-minute maintenance schedule; not one archive job per week. That change has **not** been implemented here: current configuration remains 30 days. Obtain a new decision before changing it. If selected, validate archive reconstruction, download/backup weekly data, combine archived rows with the final D1 export, and check identity/count/timestamp coverage for duplicates/gaps. Study start/end dates are not confirmed by this handoff.

### Enclosure — V5a is the preserved separate variant

Current local artifacts exist in `outputs/coop_case_v5a/`, with `V5a.blend`, printable STLs, `Printing setup.md`, coupons, and a separate `outputs/V5a_package.zip`. Original V5 remains in `outputs/coop_case_v5/`.

V5a is the 170 x 90 x 69 mm stacked power/electronics concept with separate shelf, accessible drawer, flat closed rear, and both USB connections on the left. Do not confuse it with the separate provisional 170 x 90 x 60 mm compact 2D concept. Measured bank/breadboard dimensions supersede earlier online estimates; other module/connector envelopes require physical confirmation.

The user required 2D review before 3D geometry and explicit preservation of previous versions. Printable Blender exports must exclude preview components. Reference slicing/material-saving claims do not establish actual print success, fit, latch durability, adhesive mounting on brick, load capacity, or thermal/sensor behavior. Print/test the supplied coupons and inspect the actual hardware before production fabrication.

**Top-USB revision — implemented separately after 2D review, 11 October 2026:** The user confirmed ports on the 130 mm long edge, allowed resizing, and requested the 3D/render/printing-guide update. `outputs/coop_case_v5a_top_usb/` contains `V5a_Top_USB.blend`, four main STLs, seven regenerated coupons, revised renders and `Printing setup.md`. Body: 170 x 110 x 69 mm; centered bank at (20, 12.5, 7); nominal top bay 135 x 20 mm. Actual top wall opening: X=30..152.5, Z=6..23 (122.5 x 17 mm), narrowed at the left to preserve the drawer latch root. The checked assembled connector corridor is Z=8..23 (15 mm), not the full shell cutout. ESP USB stays left; bank unplugs at top before leftward drawer removal. Rear remains flat/closed. Original V5/V5a and the reviewed 2D proposal are preserved.

The reopened Blender scene has exactly four printable meshes, no preview component meshes, correct assembled bounds, and zero-volume intersections for all six assembled part pairs. Separate source/final-mesh checks verify both unreleased latches; 949 critical positions/intervals cover released drawer travel. A fresh-folder rebuild reproduced all eleven STLs byte-for-byte. All eleven reference slices completed without warning/error/repair messages; estimates are 370.27 g main jobs and 14.51 g coupon jobs, not measured print weights. These new estimates supersede the old V5a saving claim only for this larger variant.

**Still unverified:** actual port centers, plug body/bend and hand access (port face is 32.5 mm behind outer top wall); 1 mm bank stop versus lift/tilt; interrupted upper guide under rocking loads; ungusseted upper shelf bosses; print/support removal, latch force/fatigue, ingress, mounting load and thermal behavior. The 20 mm bay remains a provisional allowance. Do not treat CAD/slicing as physical acceptance. See the variant guide and dated verification. The original `outputs/coop_case_v5a/coop_case_v5a_2d_layout.png` is the updated proposal sheet, while its neighbouring original Blender/STLs intentionally remain the preserved shorter design; use the new variant folder for fabrication inputs.

### Research proposal

Local drafts/reference checks exist in `outputs/research_proposal/`; there is also historical work on a Drive-hosted DOCX. Do not assume local and cloud copies are identical or access the account without current permission.

Recovered proposal decisions: match the supplied formal BINUS-style example; use recent literature within five years at the time of research; Research Question 2 focuses on the direction/strength of correlations among MQ-135 response, temperature, and relative humidity, with corresponding correlation analysis. Suggested replacement titles were not confirmed as selected. Confirm the current document/version before editing.

## Current checkout at import

**Git publication preparation — 15 October 2026:** Live GitHub `main` was verified at `0c20ab8c779d97e1a2499a577bc5b0f4f9146691`, matching local HEAD before publication. The user authorized committing and pushing the accumulated active application, migrations, tests and shared documentation (43 files). All 82 local Node tests, active backend/browser JavaScript syntax checks and diff whitespace checks passed. Unrelated diagnostic sketches, procurement scripts, `IDEA.md`, generated outputs and private files remain outside this publication. This is source synchronization, not a new cloud deployment or physical-device check; confirm the push result against the live remote.

Branch: `main`. The checkout already had dashboard/history/calibration/style/documentation edits and an untracked history test, plus unrelated diagnostic and procurement files. They were left intact. Nothing was committed or pushed by this migration. Local `origin/main` is only a last-fetched ref; the prior Codex cross-check could not establish live GitHub state.

## Where to look next

- [Shared agent rules](../AGENTS.md)
- [Firmware setup, calibration, operations and acceptance](../firmware/coop_monitor/README.md)
- [Wiring](../firmware/coop_monitor/WIRING.md)
- [Implementation map](../CLOUD_MIGRATION_PLAN.md)
- [Dated verification](../VERIFICATION.md)
- [Backend guide](../cloud/coop-monitor-worker/README.md)
- [API contract](../cloud/coop-monitor-worker/API.md)
- [Cloud operations](../cloud/coop-monitor-worker/OPERATIONS.md)
- [Firmware/backend handoff](../cloud/coop-monitor-worker/FIRMWARE_HANDOFF.md)

Update this document after substantive changes. Store durable project decisions here; keep actual test/deployment/device evidence dated in verification documents. Private Codex/Hermes stores remain separate; this is a selective handoff, not automatic ongoing synchronization.

