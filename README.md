# IoT Coop Monitor

ESP32-C3 poultry-coop environmental monitoring and preliminary early warning using MQ-135 and a combined AHT20/BMP280 module. **MQ-135 measures relative gas response, not calibrated ammonia ppm.**

Documentation refreshed **18 November 2026 (Asia/Jakarta)** against local source, local Git state and a public read-only check of the live Worker. Active stack: Arduino C++ firmware `cloudflare-1.2.0` → Wi-Fi/verified HTTPS protocol 1 → Cloudflare Worker → D1 recent history/private R2 archives → the Signal owner dashboard (Overview with trend views, History, Console, Settings with gas-warning alerts, Archives).

Default sampling is every 2 seconds (configurable 2–60); device exchange normally runs about every 2 seconds independently; dashboard snapshots refresh every 4 seconds. Searchable retention is configured to 30 days, with archive maintenance every 15 minutes. These are source settings, not today's device/cloud readback.

Firmware retains USB diagnostics, calibration and warning guards. Pending measurements/logs use bounded RAM and can be lost on overflow or reboot. Firmware 1.1.0 and later also write them to a microSD backup (flushed about every 15 minutes, read back and verified). Nothing backfills that SD copy to the cloud yet. Calibration, provisioning, settings and command receipts persist in NVS. Routine monitoring needs power and internet; it does not require an open Serial Monitor or computer logger.

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

Latest recorded evidence: 18 November Worker rollouts (`3af342f6`, then `84bbab7f`) with public health and asset-hash checks; 15 November firmware 1.2.0 installed and checked over Serial; 4 November replacement-sensor and closed-lid tests, each 180 consecutive readings with zero retries/final failures (last applied interval five seconds, revision 4; replacement MQ calibration still missing). The planned 5 November field run has no recorded start, end or verified History rows, and the newest coop reading in the backend is from 10 November. This refresh did not sign in, read credentials or touch the device. Historical results and remaining acceptance are in [verification](VERIFICATION.md) and the [project handoff](docs/PROJECT_HANDOFF.md).

## Historical implementations

The recorded `codex/quicktest` and `codex/wifi-cloud` workflows used offline field sessions/manual Google Sheets upload and continuous Apps Script uploading respectively. Commit `09aff6a` preserves the original MicroSD monitor. Historical data/source remain separate from the active Cloudflare runtime. SHT31 and the Apps Script workflows are not current integrated-monitor requirements. The microSD backup (firmware 1.1.0 and later) is active code; see the [firmware guide](firmware/coop_monitor/README.md).
