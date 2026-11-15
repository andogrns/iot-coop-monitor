# IoT Coop Monitor

ESP32-C3 poultry-coop environmental monitoring and preliminary early warning using MQ-135, a combined AHT20/BMP280 module and an SSD1306 OLED. **MQ-135 measures relative gas response, not calibrated ammonia ppm.**

Documentation refreshed **5 November 2026 (Asia/Jakarta)** against local source. Active stack: Arduino C++ firmware `cloudflare-1.0.4` → Wi-Fi/verified HTTPS protocol 1 → Cloudflare Worker → D1 recent history/private R2 archives → the Signal owner dashboard.

Default sampling is every 2 seconds (configurable 2–60); device exchange normally runs about every 2 seconds independently; dashboard snapshots refresh every 4 seconds. Searchable retention is configured to 30 days, with archive maintenance every 15 minutes. These are source settings, not today's device/cloud readback.

Firmware retains USB diagnostics, calibration and warning guards. OLED output is currently disabled and the display was intentionally disconnected in the last recorded bench test. Pending measurements/logs use bounded RAM and can be lost on overflow or reboot. Calibration, provisioning, settings and command receipts persist in NVS. Routine monitoring needs power and internet; it does not require an open Serial Monitor or computer logger.

## Documentation and handoff

| Read | Purpose |
|---|---|
| [Project context](PROJECT_CONTEXT.md) | Session starting point; decisions, defaults, dated observations and open work |
| [Stack architecture](docs/STACK_ARCHITECTURE.md) | Hardware → firmware → protocol → Worker → storage → dashboard, with source map |
| [Project handoff](docs/PROJECT_HANDOFF.md) | Developer onboarding, local validation, invariants and acceptance backlog |
| [Field launch handoff](docs/FIELD_RUN_2026-11-05.md) | Planned seven-day Wi-Fi run; installation, preflight and daily export checklist |
| [Operations handoff](docs/OPERATIONS_HANDOFF.md) | Operator checks, incident triage, data preservation and transfer checklist |
| [Firmware guide](firmware/coop_monitor/README.md) and [wiring](firmware/coop_monitor/WIRING.md) | Build, USB update, provisioning, calibration and hardware |
| [Backend guide](cloud/coop-monitor-worker/README.md) | Dashboard capabilities and local toolchain |
| [API](cloud/coop-monitor-worker/API.md) and [device contract](cloud/coop-monitor-worker/FIRMWARE_HANDOFF.md) | Routes, pagination, retries, commands and settings |
| [Cloud operations](cloud/coop-monitor-worker/OPERATIONS.md) | Capacity estimates, archival, backup/recovery and credentials |
| [Verification](VERIFICATION.md) and [deployment record](cloud/coop-monitor-worker/DEPLOYMENT.md) | Dated evidence; historical results are not current uptime |
| [Migration map](CLOUD_MIGRATION_PLAN.md) and [project history](docs/PROJECT_HISTORY.md) | Implementation migration and preserved earlier decisions |

Configured dashboard: [Coop Monitor](https://coop-monitor-worker.coop-monitor-worker.workers.dev/). Owner sign-in and device provisioning use separate private credentials. Their file roles are documented in the [operations handoff](docs/OPERATIONS_HANDOFF.md); credentials are excluded from Git.

## Verification boundary

Latest recorded evidence: 1 November multipart-CSV Worker rollout; 3 November firmware 1.0.4 upload; 4 November replacement-sensor and closed-lid tests, each 180 consecutive readings with zero retries/final failures. The last applied interval was five seconds, revision 4; replacement MQ calibration remains missing. The planned 5 November field launch and fresh persisted uploads remain unverified. This documentation-only refresh performed no runtime, production or device checks; historical test results and remaining acceptance are in [verification](VERIFICATION.md) and the [project handoff](docs/PROJECT_HANDOFF.md).

## Historical implementations

The recorded `codex/quicktest` and `codex/wifi-cloud` workflows used offline field sessions/manual Google Sheets upload and continuous Apps Script uploading respectively. Commit `09aff6a` preserves the original MicroSD monitor. Historical data/source remain separate from the active Cloudflare runtime. SHT31, SD logging and those Apps Script workflows are not current integrated-monitor requirements.
