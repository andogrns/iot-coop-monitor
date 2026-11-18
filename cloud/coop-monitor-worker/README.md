# Coop Monitor backend

Source/documentation reviewed **18 November 2026 (Asia/Jakarta)**. Cloudflare Worker with a private Signal owner dashboard, authenticated ESP32 exchange, D1 recent history, settings/commands, private R2 archives, Overview trend views and owner-set gas-warning alerts (Discord). See the [stack architecture](../../docs/STACK_ARCHITECTURE.md), [project handoff](../../docs/PROJECT_HANDOFF.md) and [operations handoff](../../docs/OPERATIONS_HANDOFF.md).

The latest recorded rollout is **18 November 2026**, Worker `84bbab7f-8749-4e3e-9472-c33f847a48e4` (gas-warning alert settings; the Overview side-by-side and all-in-one views came in `3af342f6` the same day). No migration since `0004`. Source firmware is `cloudflare-1.2.0`; the SD Console commands require 1.2.0 or newer. Local Node tests: 139/139 on 18 November. This refresh made only a public `/health` and asset-hash check; it did not sign in, read credentials or query the device. Authenticated dashboard acceptance, real Discord delivery and field-network History persistence remain unverified. The earlier multipart CSV export rollout (`ae9536c7`, 1 November) is in the [deployment record](DEPLOYMENT.md); see also [root verification](../../VERIFICATION.md).

On 22 October, `npm test` passed **82 local tests** with Node v24.19.0 (`node:sqlite` required). `node scripts/local-runtime-smoke.mjs` passed **50 isolated Worker checks** using installed Wrangler/esbuild/Miniflare, synthetic credentials and local D1/R2. Neither command reads production credentials. The [12 October audit](../../docs/BACKEND_AUDIT_2026-10-12.md) records compatible deployed fixes and firmware-sensitive findings that remain unresolved.

## Open the dashboard

The implemented **Signal** dashboard provides selectable metric tiles and **1h, 6h, 12h or 24h** recent trends. A slider/pointer inspects exact loaded readings; display reduction retains extrema and does not modify stored samples. Empty windows stay empty even when older readings are available in History. Full calibration and capacity information remains in expandable details.

Trend ranges load all required existing history pages (60 minute blocks per request), then update at most once per minute while Overview is visible, overlapping two minutes to catch recent retries. **Refresh trend** reloads the complete window, including older late arrivals. Switching ranges also loads the complete selected window; metric switching is local. These reads add dashboard requests and D1 reads. A 24-hour load at a steady cadence generally uses about 24–25 pages; boot overlaps can add pages. Requests are bounded at 120 pages/100,000 incoming readings and show an error rather than a partial graph. No extra backend endpoint or scheduled job is installed.

[Coop Monitor](https://coop-monitor-worker.coop-monitor-worker.workers.dev)

Sign in using `ownerKey` from the ignored `.credentials.local.json` beside this README. That key stays on this computer and the Worker secret store; it is not embedded in public assets. Owner sessions last 8 hours. Device tokens cannot open owner APIs.

Configured device: `coop-monitor-01`. The ignored `../../firmware/coop_monitor/dashboard.local.json` is its ID/HTTPS endpoint/token provisioning file; it was not read during this refresh. Provisioning was recorded previously, but present device settings require authorized readback. Use the [firmware guide](../../firmware/coop_monitor/README.md) for USB updates or Wi-Fi changes. Reuse the existing bucket/database.

## Configured resources

Names/bindings are source-confirmed; region/private-access observations retain the dates in [DEPLOYMENT.md](DEPLOYMENT.md).

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

- Overview with last sample, stale-device state, desired/applied configuration, calibration/warm-up and capacity. Overview and Settings include a current-calibration reference panel: baseline, automatic and active warning thresholds (mV and baseline multiplier), standard deviation, sample count, reference temperature/humidity, revision and last-report time. Offline values are labeled; the active threshold waits for a reading matching the device's boot, calibration and applied settings.
- History retains every sensor sample in compact minute blocks for 30 days. The footer's **Entries per page** dropdown offers 50, 100 (default), 250, 500 and 1,000; **Order** selects newest first (default) or oldest first. Opening History loads that many recent entries from the selected end of the retention window; selected ranges support both directions too. Changing size or order reloads the current view, and **Load next page** appends the next batch. Newest-first rows count down from the loaded total; oldest-first rows count up from 1. From/To filters and CSV export remain available. Read-only entry pagination preserves the existing block API used by trends and exports and requires no migration.
- Console retains bounded 24-hour firmware logs and allowlisted command receipts/results.
- Settings use revision checks, server validation and separate device-applied status.
- Older readings move to compressed, checksum-verified private R2 chunks. Database source is removed only after complete readback verification. Archives have no automatic deletion policy.
- Archives also provides From/To pickers, an automatically refreshed selected-entry count and a required label. **Create archive** moves only the chosen readings after verified storage; large ranges become multiple files inside one folder-style entry. Each entry shows its label, range and archive date. Open it for individual files, **Download all files** or checkbox selection plus **Download selected**. Bulk downloads produce one ZIP containing the original `.json.gz` files, verified against their stored SHA-256; ZIP creation happens in the browser. **Download all** follows every file page, while **Select all loaded files** selects the visible batch. Duplicate labels remain separate archive IDs; automatic files are grouped by hour. Keep the page open while archiving runs, or open an unfinished folder and use **Continue archiving** after interruption. Ranges use the History timeline and browser timezone, inclusive endpoints, up to 31 days. Manually archived sample fingerprints preserve firmware retry/conflict behavior until normal retention clears the blocks.
- Storage/estimated-write warnings near 80%; data-write pauses near 95% also include estimated requests. A request-only pause can lack an earlier warning. See operations/audit for incomplete accounting and account-wide billing limits.

## PowerShell commands

`cf.ps1` uses installed Node or the bundled runtime and sets PATH. Wrangler is pinned at 4.148.0. If Windows blocks scripts, invoke a helper with `powershell.exe -NoProfile -ExecutionPolicy Bypass -File './cf.ps1' --version` (or the authorized arguments); the override is process-only. Do not change global execution policy. Account commands below require authorized account access; the version check is local.

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

The manual-archive feature requires migration `0004_manual_archives.sql` before publishing its Worker/assets. It adds the job catalog, manifest association and reading fingerprints; it does not change firmware, credentials or configured retention. Back up D1 using the operations guide before the authorized migration.

```powershell
.\cf.ps1 d1 migrations apply coop-monitor-db --remote
.\cf.ps1 deploy --secrets-file .secrets.production.json
```

For authorized provisioning/deployment, `node scripts/prepare-credentials.mjs <Worker URL>` regenerates derived files from existing credentials; it does not rotate them. `node scripts/smoke.mjs <Worker URL>` is **production-writing acceptance**, using a disposable synthetic device and explicit fixture cleanup. It is distinct from the local-only `local-runtime-smoke.mjs`; do not run it merely to refresh documentation. Keep `.local` reports/backups private. See [OPERATIONS.md](OPERATIONS.md) before credentials or restore work.

## Documentation

- [Project context](../../PROJECT_CONTEXT.md), [stack architecture](../../docs/STACK_ARCHITECTURE.md), [project handoff](../../docs/PROJECT_HANDOFF.md), [operations handoff](../../docs/OPERATIONS_HANDOFF.md): current source setup and transfer guides.
- `DEPLOYMENT.md`: dated account/resource observations and recorded deployment version.
- `VERIFICATION.md`: actual acceptance evidence and hardware boundaries.
- `FIRMWARE_HANDOFF.md`: device payload, retries, settings and command rules.
- `API.md`: owner endpoints and pagination.
- `OPERATIONS.md`: budgets, retention, backups and credential rotation.
