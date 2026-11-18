# Coop Monitor project handoff

Refreshed **18 November 2026 (Asia/Jakarta)** for the next developer or coding agent. Start with [project context](../PROJECT_CONTEXT.md), [shared rules](../AGENTS.md) and [stack architecture](STACK_ARCHITECTURE.md). The companion [operations handoff](OPERATIONS_HANDOFF.md) covers operator transfer and incident handling.

## Baseline and evidence

| Item | Handoff baseline |
|---|---|
| Local source | Branch `main`: the 18 November Worker commit and this documentation commit, not pushed (`git log` has hashes). `origin/main` was `221dd07` (15 Nov) at the last fetch |
| Working tree | Still uncommitted: Week 1 notebook (`Week 1 Readings/Plots/week1_analysis.ipynb`), its builder `build_nb.py` and `docs/SESSION_HANDOFF_2026-11-17.md` |
| Remote Git | `git fetch` on 18 November: `origin/main` = `221dd07`, unchanged; nothing pushed |
| Firmware source | `cloudflare-1.2.0` (commit `14027c0`, 15 Nov), protocol 1, ESP32-C3 SuperMini, USB-only updates |
| Configured backend | Worker `coop-monitor-worker`, D1 `coop-monitor-db`, private R2 `coop-monitor-archives`; retention 30 days; crons every 15 minutes (maintenance) and every 5 minutes (gas alerts) |
| Last recorded rollout | 18 November, Worker `84bbab7f-8749-4e3e-9472-c33f847a48e4` (gas-warning alert settings; Overview trend views in `3af342f6` the same day); migrations 0001–0004, none added since; [dated record](../cloud/coop-monitor-worker/DEPLOYMENT.md) |
| Last recorded physical checks | 4 November: replacement AHT/BMP and closed-lid tests, each 180 consecutive readings / 15 minutes with zero retries/final failures; OLED disconnected, Wi-Fi intentionally off |
| Last recorded device state | 15 November: `cloudflare-1.2.0` installed by USB and checked over Serial. Last full settings readback 4 November: revision 4, five-second sampling, mq135-02 calibration missing; 100 kHz bus, OLED disabled. Backend holds no coop readings after 10 November |
| Local checks | 18 November: 139/139 backend Node tests with the bundled Node 24.22.1; firmware compilation not run in this refresh. Older results: see [verification](../VERIFICATION.md) |

On 18 November the public `/health` endpoint and five dashboard asset hashes were checked. Installed firmware, device connectivity, provider usage and physical condition were not inspected. Recorded state is dated evidence, not proof of present device operation. No credentials, connected accounts or private captures were read to produce this handoff.

## First development session

1. Read the context/rules, inspect actual Git status and relevant source, and preserve unrelated work. If Git reports dubious ownership, use the command-scoped exception below.
2. Identify the layer being changed. Use the source map below and keep active Cloudflare code separate from historical Apps Script/QuickTest support; the microSD backup is active firmware code since 1.1.0.
3. Record the proposed behavior and compatibility impact before changing ingestion identity, acknowledgements, pause/timing, command lifecycle, calibration/NVS, retention or partitions.
4. Implement within the current authorization and run appropriate local checks. Production deployment, cloud writes, device actions and Git publication require authorization covering those actions.
5. Update context/architecture/contracts when behavior changes, and add dated results with their evidence layer. Do not call a local test a physical or production pass.

From repository root:

```powershell
git -c safe.directory='C:/Users/Ando/Documents/Ando/bleh/Enrichment 2' status --short --branch
node --version
node --test cloud/coop-monitor-worker/scripts/*.test.mjs
node cloud/coop-monitor-worker/scripts/local-runtime-smoke.mjs
```

Node must support `node:sqlite`; the 22 October run used v24.19.0. The isolated smoke script uses installed Wrangler/esbuild/Miniflare, synthetic credentials, local D1/R2 and disabled outbound service; it does not load production credentials or Wrangler remote bindings. The pinned dependency is Wrangler 4.148.0 in the backend package/lockfile. For a fresh checkout, install backend dependencies with `pnpm install --frozen-lockfile` from `cloud/coop-monitor-worker/`; do not upgrade the lockfile as an onboarding side effect.

Syntax checks for the changed JavaScript files and `git diff --check` complement the tests. For firmware changes, compile without uploading:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File './firmware/coop_monitor/build_wifi_cloud.ps1'
```

The build helper uses Arduino IDE's CLI or `-ArduinoCli` with an explicit path; install the board/libraries listed in the [firmware guide](../firmware/coop_monitor/README.md). The November repair build used ESP32 core 3.3.12 (October used 3.3.11). Compilation is not flashing or hardware acceptance. No firmware compilation was needed for this documentation-only refresh.

The local Wrangler version check is:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File './cloud/coop-monitor-worker/cf.ps1' --version
```

Windows blocked the same invocation without `-ExecutionPolicy Bypass` during the 22 October refresh. This override applies only to that helper process; do not change global policy. `cf.ps1` finds installed Node or this machine's documented bundled fallback; verify paths rather than copying another machine's runtime path. Version inspection is not deployment authorization.

## Source and contract map

| Responsibility | Read/edit here |
|---|---|
| Sampling, sensors, OLED, calibration and local warning guards | [coop_monitor.ino](../firmware/coop_monitor/coop_monitor.ino) |
| Checked sensor acquisition / deferred OLED transport | [aht20_reader.h](../firmware/coop_monitor/aht20_reader.h), [bmp280_reader.h](../firmware/coop_monitor/bmp280_reader.h), [oled_transport.h](../firmware/coop_monitor/oled_transport.h) |
| Field preflight / gate / regression | [preflight_field_run.ps1](../firmware/coop_monitor/preflight_field_run.ps1), [field_readiness.ps1](../firmware/coop_monitor/field_readiness.ps1), [test_field_readiness.ps1](../firmware/coop_monitor/test_field_readiness.ps1) |
| Version, endpoint, monitoring/record types, capacities and CRC | [dashboard_protocol.h](../firmware/coop_monitor/dashboard_protocol.h) |
| HTTPS, NTP, NVS settings/receipts, retries, command dispatch and network task | [dashboard_runtime.h](../firmware/coop_monitor/dashboard_runtime.h) |
| Firmware build/update/provisioning | [firmware README](../firmware/coop_monitor/README.md), build/upload/configure helpers alongside it |
| Routes, request bounds and access control | [app.js](../cloud/coop-monitor-worker/src/app.js), [auth.js](../cloud/coop-monitor-worker/src/auth.js), [protocol.js](../cloud/coop-monitor-worker/src/protocol.js) |
| D1 exchange, settings/commands, history and cursors | [storage.js](../cloud/coop-monitor-worker/src/storage.js), [history-pages.js](../cloud/coop-monitor-worker/src/history-pages.js) |
| Retention, capacity, manual jobs, archive folders | [archive.js](../cloud/coop-monitor-worker/src/archive.js), [manual-archive.js](../cloud/coop-monitor-worker/src/manual-archive.js), [archive-folders.js](../cloud/coop-monitor-worker/src/archive-folders.js) |
| Signal UI | [public assets](../cloud/coop-monitor-worker/public); app, trends, history-selection, history-export, manual/archive-library and ZIP modules |
| Schema / deployment bindings | [migrations](../cloud/coop-monitor-worker/migrations), [wrangler.jsonc](../cloud/coop-monitor-worker/wrangler.jsonc) |
| Wire/owner contracts and operational procedures | [device handoff](../cloud/coop-monitor-worker/FIRMWARE_HANDOFF.md), [API](../cloud/coop-monitor-worker/API.md), [operations](../cloud/coop-monitor-worker/OPERATIONS.md) |

## Required compatibility boundaries

Preserve relative-response wording; MQ-135 is not a calibrated ammonia ppm instrument. Keep GPIO3 divider input and GPIO4/5 I2C mapping, ten-minute warm-up, calibration validity and ADC-high guards. Manual thresholds do not bypass guards.

Preserve `coopcal` and the replacement module's separate `mq02_*` calibration keys; do not reuse the old module profile. Preserve configuration/receipt CRC formats, all NVS/partition offsets, no-OTA layout and erase-all-off upload. Before an authorized upload, follow calibration/legacy-data preservation and full-flash backup in the firmware guide. Full flash may contain secrets. Never format the legacy filesystem to repair networking.

Keep protocol 1 and exact endpoint compatibility, verified TLS, immutable device/boot/sequence/uptime/payload on retry, record-specific retirement and desired/applied revisions. Preserve command receipts across reset; `uncertain` must remain possible when execution cannot be proved. A cloud save/queued command is not device completion.

No always-on/scheduled Serial capture; optional capture stays manually started/stopped. Only one process can own the actual COM port. No token/SSID/password/flash-backup values in handoffs, screenshots, logs or commits. Paths and secret roles can be documented without reading contents.

## Prioritized unfinished work

| Area | Next work | Completion evidence |
|---|---|---|
| Field launch priority | Follow [5 November procedure](FIELD_RUN_2026-11-05.md); retain replacement sensors, firmware 1.0.4 and disabled OLED | Actual field start, fresh accepted exchanges and advancing persisted History on final standalone power |
| MQ qualification | Complete conditioning and obtain an accepted clean-air profile for mq135-02 | Recorded conditioning history and replacement profile; raw-only limitation until accepted |
| Physical continuity | Recheck fresh telemetry and installed version; independent power cycle; compare calibration/provisioning | Timestamped physical observation plus backend readback; retained calibration and settings |
| Warning/settings | Keep OLED deferred; verify warm-up/invalid/calibration guards; exercise chosen interval/threshold settings | Desired/applied convergence, measured cadence and guarded warning behavior |
| Commands | Exercise each allowed command, expiry, reconnect, restart and interrupted recovery | Receipts and actual handler outcome; uncertainty recorded where completion cannot be proved |
| Outages/pause | Wi-Fi loss/reconnect, buffer overflow, owner pause and resume | Pending/drop counts, boot/sequence coverage and explicit unrecoverable gaps |
| Field study | Planned seven-day collection with daily coverage/export checks; measured account usage and actual start/end | Exported coverage/reliability/resource report; no assumption of free-capacity headroom |
| Backend design | Review deferred audit findings below | Approved design, regression/runtime tests, rollout and physical compatibility evidence as applicable |

The [12 October audit](BACKEND_AUDIT_2026-10-12.md) remains the detailed evidence for cross-minute duplicate identities, command/log admission races, incomplete capacity/request accounting, automatic archive cutoff overlap, unbounded accepted/running command recovery, boot-clock drift rejection, per-isolate abuse limits and orphan reconciliation. Those findings were not repaired or re-reproduced during this documentation refresh. Green tests do not close those findings.

Seven-day searchable retention remains a proposal; current configuration is 30 days. A seven-day standalone Wi-Fi run was planned for 5 November; actual start/end timestamps remain unrecorded. At the last applied five seconds, RAM holds about 320 seconds and nominal seven-day coverage is 120,960 readings, not measured coverage. Final study analysis must combine D1 and R2, retain original timestamps/nulls and calibration/configuration context, and check duplicate identities, counts and gaps.

Enclosure/proposal handoff is in [project history](PROJECT_HISTORY.md): use the separate V5a Top USB fabrication variant, preserve older geometry and require 2D approval for new revisions. Coupon/slicer evidence is not physical acceptance. Confirm the selected proposal and literature cutoff before editing research text.

## Completion and transfer record

For the next change, record: date/timezone, source commit/worktree scope, requested authorization, behavior changed, checks and exact pass/failure scope, deployment version/migrations if actually applied, device/boot/configuration observations if actually measured, retained backups and unresolved work. Assign the incoming firmware, cloud and study operator roles with the project owner; this handoff does not invent assignees or deadlines.

Keep secrets/backups outside Git and transfer access privately. Update [PROJECT_CONTEXT.md](../PROJECT_CONTEXT.md) for durable decisions and [VERIFICATION.md](../VERIFICATION.md) for evidence. The [historical context](PROJECT_HISTORY.md) preserves earlier decisions without making them current operational permission.
