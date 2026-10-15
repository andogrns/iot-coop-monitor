# Coop Monitor backend

Security/efficiency audit: [12 October 2026 report](../../docs/BACKEND_AUDIT_2026-10-12.md). Compatible fixes and the additive archive catalog index are **deployed** as Worker `c57d5a65-0e42-483c-a2dd-04433b0858c3`. Nine production synthetic checks passed and the fixture was removed. The real ESP32 was already offline before rollout; fresh physical ingestion remains pending. Run `npm test` (Node with `node:sqlite`) for 38 local tests; `node scripts/local-runtime-smoke.mjs` runs 20 isolated Worker checks with the installed Wrangler toolchain and synthetic local-only data. Neither local test command reads production credentials. Firmware-sensitive findings remain pending review.

Cloudflare Worker with a private owner dashboard, authenticated ESP32 device exchange, D1 recent history, remote settings/commands, and private R2 archives. Deployed 10 October 2026. Physical device `coop-monitor-01` now runs `cloudflare-1.0.1`; real sensor ingestion and dashboard display are verified. Extended device acceptance remains in [root verification](../../VERIFICATION.md).

## Open the dashboard

The approved **Signal** redesign is deployed as `8d50edc6-b376-44dd-bd48-dd06a29c9d40` (12 October 2026), retaining the audit backend above. Select a metric tile and **1h, 6h, 12h or 24h** to view recent trends. A slider/pointer inspects exact loaded readings; display reduction retains extrema and does not modify stored samples. Empty windows stay empty even when older readings are available in History. Full calibration and capacity information remains in expandable details.

Trend ranges load all required existing history pages (60 minute blocks per request), then update at most once per minute while Overview is visible, overlapping two minutes to catch recent retries. **Refresh trend** reloads the complete window, including any older late arrivals. Switching ranges also loads the complete selected window; metric switching is local. These reads add to dashboard requests and D1 reads. A 24-hour load at a steady cadence generally uses about 24–25 pages; boot overlaps can add pages. Requests are bounded at 120 pages/100,000 incoming readings and show an error rather than a partial graph. No extra backend endpoint or scheduled job is installed. Run `npm test` for the current **46** local tests.

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

- Overview with last sample, stale-device state, desired/applied configuration, calibration/warm-up and capacity. Overview and Settings include a current-calibration reference panel: baseline, automatic and active warning thresholds (mV and baseline multiplier), standard deviation, sample count, reference temperature/humidity, revision and last-report time. Offline values are labeled; the active threshold waits for a reading matching the device's boot, calibration and applied settings.
- History retains every sensor sample in compact minute blocks for 30 days. The footer's **Entries per page** dropdown offers 50, 100 (default), 250, 500 and 1,000; **Order** selects newest first (default) or oldest first. Opening History loads that many recent entries from the selected end of the retention window; selected ranges support both directions too. Changing size or order reloads the current view, and **Load next page** appends the next batch. Newest-first rows count down from the loaded total; oldest-first rows count up from 1. From/To filters and CSV export remain available. Read-only entry pagination preserves the existing block API used by trends and exports and requires no migration.
- Console retains bounded 24-hour firmware logs and allowlisted command receipts/results.
- Settings use revision checks, server validation and separate device-applied status.
- Older readings move to compressed, checksum-verified private R2 chunks. Database source is removed only after complete readback verification. Archives have no automatic deletion policy.
- Archives also provides From/To pickers, an automatically refreshed selected-entry count and a required label. **Create archive** moves only the chosen readings after verified storage; large ranges become multiple files inside one folder-style entry. Each entry shows its label, range and archive date. Open it for individual files, **Download all files** or checkbox selection plus **Download selected**. Bulk downloads produce one ZIP containing the original `.json.gz` files, verified against their stored SHA-256; ZIP creation happens in the browser. **Download all** follows every file page, while **Select all loaded files** selects the visible batch. Duplicate labels remain separate archive IDs; automatic files are grouped by hour. Keep the page open while archiving runs, or open an unfinished folder and use **Continue archiving** after interruption. Ranges use the History timeline and browser timezone, inclusive endpoints, up to 31 days. Manually archived sample fingerprints preserve firmware retry/conflict behavior until normal retention clears the blocks.
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

The manual-archive feature requires migration `0004_manual_archives.sql` before publishing its Worker/assets. It adds the job catalog, manifest association and reading fingerprints; it does not change firmware, credentials or configured retention. Back up D1 using the operations guide before the authorized migration.

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
