# Cloudflare deployment record

Updated 10 October 2026, Asia/Jakarta. Backend deployed and synthetic production acceptance passed. Physical ESP32 firmware `cloudflare-1.0.1` is now installed, with retained calibration/provisioning and real sensor readings verified in the backend/dashboard. Extended device acceptance remains. The firmware repair did not change the deployed Worker version.

| Item | Live value |
|---|---|
| Cloudflare account | `7865a0c25fe350bb4395009c91eb83d1` |
| Worker | `coop-monitor-worker` |
| Dashboard origin | `https://coop-monitor-worker.coop-monitor-worker.workers.dev` |
| Device exchange | `https://coop-monitor-worker.coop-monitor-worker.workers.dev/api/device/exchange` |
| Protocol | Version 1 |
| Active version | `a56bc274-6d03-4ebb-afc9-414cb0a842e5` |
| D1 database | `coop-monitor-db` |
| D1 ID | `ea267d2d-f237-4374-9c72-d4fd6efb632c` |
| D1 location | APAC; queries served by primary in HKG during checks |
| Schema | Migrations `0001_create_devices.sql`, `0002_backend.sql`; no pending remote migrations |
| Device | `coop-monitor-01`, label `Coop monitor 01`, desired settings revision 1 |
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

- D1 created, two migrations applied, real device registered with default monitoring configuration.
- R2 activated by owner, bucket created and private access verified.
- Worker, dashboard assets, secrets, D1/R2 bindings and scheduled trigger deployed.
- Public TLS health, private API access, device protocol, configuration/commands, pause/resume, CSV, and R2 checksum/readback retention accepted using synthetic fixtures.
- Final synthetic fixture contained 900 readings across 30 minute blocks; compressed archive was 12,973 bytes. Fixture object/device/rows were removed afterward.
- Normal terminal wrapper `cf.ps1` prepared to resolve the earlier missing Node PATH issue.
- Physical `coop-monitor-01` firmware updated to `cloudflare-1.0.1` after verified flash/calibration backups; real HTTPS ingestion, applied revision 1 and continued uploads with Serial Monitor closed confirmed. See [root verification](../../VERIFICATION.md) for this separate device investigation.
- Overview spacing correction deployed: 16 px between the metrics and state/capacity rows, with a content-versioned stylesheet URL so cached clients load the new CSS on refresh. The live overview was visually reviewed; screenshot saved in ignored `outputs/cloudflare/overview-spacing-fixed.jpg`.

No paid Workers upgrade, custom domain, extra storage product, S3 key, firmware erase/flash, or existing Apps Script/Sheets change was needed for this backend task. R2 remains metered outside included capacity; application guards and usage monitoring are described in `OPERATIONS.md`.

See `VERIFICATION.md` for backend evidence, [root verification](../../VERIFICATION.md) for the firmware compilation, and `FIRMWARE_HANDOFF.md` / the [firmware guide](../../firmware/coop_monitor/README.md) for USB cutover and device acceptance.
