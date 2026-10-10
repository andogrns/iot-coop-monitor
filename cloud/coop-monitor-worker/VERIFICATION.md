# Backend acceptance — 10 October 2026

## Actual execution

Wrangler 4.148.0, bundled Node 24.19.0, Windows PowerShell. The isolated acceptance script uses real HTTP requests and real D1/R2 bindings; it does not substitute an in-memory implementation for the deployed storage.

| Environment | Result | Evidence |
|---|---|---|
| Local Wrangler/workerd, local D1/R2 | 31 checks passed at 07:12:20 UTC | `.local/local-acceptance.json` |
| Deployed HTTPS Worker, remote D1/R2, final version | 32 checks passed at 07:25:34 UTC (14:25:34 Jakarta) | `.local/production-acceptance.json` |
| Deployed archive fixture | 900 readings, 30 blocks, gzip 12,973 bytes, checksum verified after R2 readback and owner download | Production acceptance report |
| Resource readback | D1 APAC, registered `coop-monitor-01`; secrets installed; cron deployed; R2 Standard/APAC with public access disabled | Wrangler/API metadata reads |
| Credential exclusion | All 5 relevant local secret/provisioning/report paths matched Git ignore rules | `git check-ignore` |

Active Worker version: `46c5362c-39a0-4472-ba44-7f00fadbe996`.

## Production checks

- D1-backed health through the public HTTPS endpoint.
- Anonymous owner-data denial; owner sign-in and signed Secure/HttpOnly cookie; cookie-authorized reads; cross-origin cookie write denial; signout cookie clearing.
- Isolated synthetic device registration; incorrect device credential denial; maintenance/capacity initialization.
- Reading/log acknowledgements; repeat payload stored once; preserved unknown UTC; conflicting sample values and invalid measurements rejected.
- Concurrent uploads retain both readings.
- Desired settings revision update; stale revision conflict; device exchange returns the current desired configuration.
- CAL_START reference-condition confirmation; allowlisted command delivery; completion acknowledgement; terminal status regression rejected; expired queued commands withheld.
- Credential redaction in firmware logs; combined console/state polling; owner pause does not acknowledge unwritten readings; resume works.
- Authenticated CSV export.
- Aged fixture R2 write/readback and checksum; owner archive checksum/decompression; verified catalog; D1 source deleted only after verified archive.

The acceptance script removed only its own randomly named `synthetic-*` device, cascaded fixture rows and the exact synthetic R2 object key. It reran capacity maintenance afterward. The production database is provisioned for the real device and contains no physical device readings yet.

## Interpretation

This confirms cloud/API/database/archive behavior with identified synthetic data. These backend checks do not verify ESP firmware serialization, compilation or upload; physical sensors; OLED; network loss on the actual device; TLS trust on the ESP32; calibration; unsafe command replay recovery; or continuous field operation. The separate 10 October firmware source compilation is recorded in [root verification](../../VERIFICATION.md); physical acceptance remains pending. The configured cron was deployed; the archive algorithm was invoked through the authenticated maintenance route during acceptance, so these checks alone do not prove recurring execution over time.

The realistic archive batch completed under this deployment, but this short probe does not establish sustained CPU/quota headroom across different data/load patterns. Check Cloudflare analytics and device gap counts during the first continuous field run. No independent database restore was performed; the export/recovery procedure is documented in `OPERATIONS.md`.

To rerun an authorized isolated acceptance probe:

```powershell
# Ensure Node is on PATH, or invoke the bundled node.exe directly.
node scripts/smoke.mjs https://coop-monitor-worker.coop-monitor-worker.workers.dev --full-archive
```

The script reads local credentials without printing them, creates an explicit synthetic fixture, performs bounded production mutations and cleans up that fixture. Reports remain in ignored `.local`.
