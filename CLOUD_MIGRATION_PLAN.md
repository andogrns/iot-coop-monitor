# Cloud migration: implementation and workspace map

Prepared 8 October; source/documentation reviewed **22 October 2026 (Asia/Jakarta)**. This is the implemented migration/workspace map. The 10 October physical upload of `cloudflare-1.0.1`, retained calibration/provisioning, actual ingestion/dashboard readings and Serial-closed operation are dated observations, not today's installed firmware or uptime. Latest recorded backend rollout is 13 October; see [verification](VERIFICATION.md) and [deployment record](cloud/coop-monitor-worker/DEPLOYMENT.md).

For ongoing work, start with [project context](PROJECT_CONTEXT.md), [stack architecture](docs/STACK_ARCHITECTURE.md), [project handoff](docs/PROJECT_HANDOFF.md) and [operations handoff](docs/OPERATIONS_HANDOFF.md). No production/device access was performed for this refresh.

## Operating choices

| Item | Current implementation |
|---|---|
| Sampling | Every 2 seconds by default; configurable 2–60 seconds; last stored 13 October setting was 30 seconds, not refreshed here |
| Dashboard refresh | Every 4 seconds |
| Recent history | Full-resolution D1 minute blocks, 30 days |
| Older readings | Private compressed R2 archives; checksum/readback before source deletion |
| Archive retention | No automatic archive deletion configured |
| Local measurements | Bounded RAM; no SD or persistent flash measurement queue |
| Persistent device data | Calibration, Wi-Fi/device credentials, monitoring configuration and command receipts in NVS |
| Remote operation | Allowed commands, bounded firmware logs, desired/applied settings revisions |
| USB updates | 4 MB ESP32-C3, existing no-OTA partitions, erase-all disabled |
| Access | Private owner session; separate device token |
| Capacity | Storage/estimated-write warning near 80%; pause near 95% also considers estimated requests; request-only pause can lack a warning |
| Spending | No automatic paid upgrade; application guards are not a provider billing cap |

The user selected direct Cloudflare Workers after the original Sites proposal. Only Cloudflare is deployed for this implementation. A computer is needed for initial provisioning and USB updates, not routine data capture.

## Hardware and sensing

Retain the ESP32-C3 SuperMini, MQ-135, two 10 kOhm divider resistors, AHT20/BMP280 combined board. Retain GPIO3 MQ analog input and shared GPIO4 SDA / GPIO5 SCL. MQ heater uses stable 5 V; sensor logic uses 3.3 V; grounds are shared. See [WIRING.md](firmware/coop_monitor/WIRING.md).

MicroSD and its GPIO10/6/7/1 wires are unused. GPIO9/BOOT resumes its normal bootloader role and has no field-session stop action. No new sensor, relay, fan, RTC, battery system or enclosure redesign is included.

The sensing loop retains ten-minute boot warm-up, clean-air calibration, readable Serial output, ADC-high checks and invalid-sensor handling. Manual thresholds retain the warning guards. MQ-135 remains relative gas response, not validated ammonia ppm.

## Firmware implementation

The active sketch includes `dashboard_runtime.h`; legacy flash queue and QuickTest runtimes are outside its execution path. Network exchange uses its own task and validates TLS hostname/certificates against public root certificates. Wi-Fi credentials are reused from `coopnet`; the old Apps Script URL/token are not reused. Cloudflare access settings use `coopcloud`, monitoring configuration `coopcfg`, command receipts `coopcmd`, and the existing calibration namespace `coopcal` is unchanged.

RAM holds 64 readings and 16 logs. Exchanges send up to 12 readings/6 logs/5 command results. IDs, payloads and original timestamps remain immutable on retry. Oldest records are dropped on overflow and reported per boot; reboot loses RAM data. Unknown original UTC remains null and history separately identifies estimated time. NTP is required before TLS uploads.

Monitoring configuration is validated and persisted only on change. Desired and applied revisions are distinct. Calibration sampling temporarily stays at two seconds even when the desired normal interval is longer.

Supported commands: `CAL_SHOW`, `CAL_EXPORT`, `CAL_START`, `CAL_CANCEL`, `NET_STATUS`, `NET_RECONNECT`, `CONFIG_SHOW`, `RESTART`, `HELP`. Calibration start requires confirmed physical reference conditions. Durable receipts and server acknowledgement precede execution. Reboot recovery reports uncertainty and refuses unsafe replay; a confirmed software-reset restart completes on the new boot. No remote credential update, calibration import, shell or OTA is provided.

Upload pauses preserve local sensing/warnings and usually use 60-second exchanges, temporarily faster for command receipts. The current backend does not persist fresh device state/data during a pause. Dashboard freshness can therefore lapse; stored history is preserved. A hard provider quota can also block control traffic.

## Workspace map

| File or area | Responsibility/status |
|---|---|
| `README.md`, `firmware/README.md` | Active Cloudflare overview; historical workflows identified separately |
| `firmware/coop_monitor/README.md` | Build, USB cutover, provisioning, settings, commands, losses and acceptance |
| `firmware/coop_monitor/WIRING.md` | Current pin table and SD-free diagram |
| `firmware/coop_monitor/coop_monitor.ino` | Sensor/calibration integration and shared remote handlers |
| `firmware/coop_monitor/dashboard_protocol.h` | Configuration, record/receipt types, CRC and bounded RAM rings |
| `firmware/coop_monitor/dashboard_runtime.h` | Secure exchange, settings/NVS, acknowledgements, commands and Wi-Fi task |
| `firmware/coop_monitor/cloudflare_roots.h`, `refresh_tls_roots.mjs` | Public TLS trust roots and reproducible root refresh |
| `firmware/coop_monitor/dashboard.example.json` | Safe provisioning template |
| `firmware/coop_monitor/dashboard.local.json` | Ignored actual provisioning input; never committed |
| `firmware/coop_monitor/partitions.csv` | Preserved 4 MB layout; no OTA |
| `firmware/coop_monitor/build_wifi_cloud.ps1` | Build without uploading; ignored `outputs/cloudflare/build` |
| `firmware/coop_monitor/upload_wifi_cloud.ps1` | Chip/calibration checks, pending-data guards, full flash backup, erase-all-off upload |
| `firmware/coop_monitor/configure_network.ps1` | Secure Wi-Fi prompt and protocol-v1 USB provisioning |
| Legacy queue/session headers and tests | Retained; not active Cloudflare runtime or its verification |
| Computer capture helpers | Retained optional manually controlled Serial capture |
| SD transfer tools | Retained for historical SD firmware |
| `cloud/apps-script/` | Preserved legacy backend and data workflow; existing deployment/Sheets unchanged |
| `cloud/coop-monitor-worker/src/` | Protocol/auth, D1 storage, archives/retention/capacity |
| `cloud/coop-monitor-worker/public/` | Signal Overview/History/Console/Settings/Archives, trends, selection counts and verified ZIP downloads |
| `cloud/coop-monitor-worker/migrations/` | Versioned D1 schema |
| `cloud/coop-monitor-worker/wrangler.jsonc`, `cf.ps1` | Deployed bindings/cron and Windows runtime wrapper |
| Backend `API.md`, `OPERATIONS.md`, `DEPLOYMENT.md`, `VERIFICATION.md`, `FIRMWARE_HANDOFF.md` | Actual routes, operating procedures, deployment evidence and firmware contract |
| Root `VERIFICATION.md` | Dated firmware/backend evidence with physical limitations |
| `.gitignore` | Local keys, backups, generated builds, runtime caches and capture outputs excluded |

Backend HTTP routes use `POST /api/device/exchange`, owner `GET /api/snapshot`, `/api/history`, `/api/export`, `/api/logs`, revisioned configuration, commands and authenticated archive routes. See the authoritative [API list](cloud/coop-monitor-worker/API.md).

No new firmware test suite was added or run during this source update. Earlier backend acceptance and legacy host tests are recorded separately. Firmware compilation and the subsequent approved physical connection investigation are documented in root verification.

## Deployment and data preservation

The source-configured Worker is [coop-monitor-worker](https://coop-monitor-worker.coop-monitor-worker.workers.dev/) with D1 `coop-monitor-db`, private R2 `coop-monitor-archives`, a 15-minute scheduled maintenance trigger, owner secrets and device `coop-monitor-01`. Reuse existing resources. Recorded rollout/resource observations are in the deployment record; present production state was not queried on 22 October.

Owner and device credentials remain separate and Git-ignored. The Worker uses the R2 binding directly; public bucket access and external S3 keys are unnecessary. Read [operations](cloud/coop-monitor-worker/OPERATIONS.md) for capacity estimates, manual owner pause, export/restore and credential rotation. Independent exports are still needed for recovery beyond the same hosting account.

The new runtime does not mount, format or delete the old LittleFS records. Before physical cutover, upload/export pending legacy records and back up calibration. The upload helper saves a full flash image and SHA-256 before writing. Retaining bytes does not make old readings available in the new dashboard; the new firmware cannot ingest the legacy queue.

Historically, the migration source was prepared on `codex/cloudflare-firmware` from `codex/quicktest` for publication to `main`. The 22 October local inspection found branch `main`, HEAD `b4e5d30`; no remote check, commit or push was performed during this documentation refresh. `codex/wifi-cloud`/`codex/quicktest` refer to historical workflows; original SD source remains at `09aff6a`. Unrelated diagnostic/procurement/CAD/proposal files remain outside the active application scope.

## Remaining physical acceptance

1. Completed: identified installed Cloudflare firmware and saved matching calibration/full 4 MB flash backups before repair.
2. Completed: uploaded `cloudflare-1.0.1` with erase-all disabled, retained existing provisioning and left the previous filesystem untouched.
3. Completed after upload/reset: matching calibration and settings revision 1. Still repeat after an independent power cycle.
4. Completed: actual sensor history, HTTPS ingestion, dashboard display and two-second sampling with the serial reader closed. Still observe warm-up/warning guards.
5. Apply monitoring settings and inspect desired/applied revisions and resulting warning/sampling behavior.
6. Exercise allowed commands, calibration outcomes, expiry, restart recovery and explicit uncertainty after interrupted operations.
7. Exercise Wi-Fi loss/reconnect, RAM overflow and owner pause; inspect reported gaps and stale-state behavior.
8. Observe a 24-hour physical run and measure account-wide request/write/storage/CPU usage. Compilation and synthetic traffic do not establish continuous field reliability or free-capacity headroom.

Backend acceptance already exercised authenticated access, retries/configuration/commands, exports, verified R2 archive creation and controlled retention with synthetic fixtures. Those fixtures were removed afterward. The later physical connection repair uploaded firmware and verified real sensor ingestion; it retained the accepted calibration and did not start a new calibration or establish extended field reliability.
