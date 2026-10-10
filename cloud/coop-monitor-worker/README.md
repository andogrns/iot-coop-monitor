# Coop Monitor backend

Cloudflare Worker with a private owner dashboard, authenticated ESP32 device exchange, D1 recent history, remote settings/commands, and private R2 archives. Deployed 10 October 2026. Physical device `coop-monitor-01` now runs `cloudflare-1.0.1`; real sensor ingestion and dashboard display are verified. Extended device acceptance remains in [root verification](../../VERIFICATION.md).

## Open the dashboard

[Coop Monitor](https://coop-monitor-worker.coop-monitor-worker.workers.dev)

Sign in using `ownerKey` from the ignored `.credentials.local.json` beside this README. That key stays on this computer and the Worker secret store; it is not embedded in public assets. Owner sessions last 8 hours. Device tokens cannot open owner APIs.

Provisioned device: `coop-monitor-01`. The ignored `../../firmware/coop_monitor/dashboard.local.json` contains its ID, HTTPS exchange endpoint and device token. The connected device already has these settings. Use the [firmware guide](../../firmware/coop_monitor/README.md) for future USB updates or Wi-Fi changes. No new bucket or database is required.

## Resources created

| Resource | Configuration |
|---|---|
| Worker | `coop-monitor-worker` |
| D1 | `coop-monitor-db`, Asia Pacific |
| D1 ID | `ea267d2d-f237-4374-9c72-d4fd6efb632c` |
| R2 | `coop-monitor-archives`, Asia Pacific, Standard, private |
| Cron | Every 15 minutes |
| Owner secrets | `ADMIN_TOKEN`, `SESSION_SECRET` |

You do not need to create another database or bucket. R2 public access, custom domains, CORS, S3/API keys, and lifecycle deletion are unnecessary for the Worker binding.

## What is available

- Overview with last sample, stale-device state, desired/applied configuration, calibration/warm-up and capacity.
- History retains every two-second sample in compact minute blocks for 30 days; paginated range queries and CSV export.
- Console retains bounded 24-hour firmware logs and allowlisted command receipts/results.
- Settings use revision checks, server validation and separate device-applied status.
- Older readings move to compressed, checksum-verified private R2 chunks. Database source is removed only after complete readback verification. Archives have no automatic deletion policy.
- Warnings at 80% and data-write pause near 95% of application budgets. See operations for the limits of application estimates and account-wide billing.

## PowerShell commands

`cf.ps1` uses installed Node or the bundled runtime and sets PATH, addressing the earlier `node`/`pnpm` shell errors.

```powershell
Set-Location 'C:\Users\Ando\Documents\Ando\bleh\Enrichment 2\cloud\coop-monitor-worker'
.\cf.ps1 --version
.\cf.ps1 whoami
.\cf.ps1 d1 migrations list coop-monitor-db --remote
.\cf.ps1 deployments list
```

For local work:

```powershell
.\cf.ps1 d1 migrations apply coop-monitor-db --local
.\cf.ps1 d1 execute coop-monitor-db --local --file .local/provision-device.sql
.\cf.ps1 dev --port 8787 --test-scheduled
```

For an authorized redeployment after edits:

```powershell
.\cf.ps1 d1 migrations apply coop-monitor-db --remote
.\cf.ps1 deploy --secrets-file .secrets.production.json
```

Use `node scripts/prepare-credentials.mjs <Worker URL>` to regenerate derived provisioning files from existing credentials. Use `node scripts/smoke.mjs <Worker URL>` for deployment acceptance with an isolated synthetic device and explicit fixture cleanup. Keep `.local` reports/backups private. See `OPERATIONS.md` before changing credentials or restoring data.

## Documentation

- `DEPLOYMENT.md`: live account/resource names and deployment version.
- `VERIFICATION.md`: actual acceptance evidence and hardware boundaries.
- `FIRMWARE_HANDOFF.md`: device payload, retries, settings and command rules.
- `API.md`: owner endpoints and pagination.
- `OPERATIONS.md`: budgets, retention, backups and credential rotation.
