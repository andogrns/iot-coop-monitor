# Operations and storage

## Included-capacity target

One device uploading every 2 seconds creates about 43,200 daily exchanges. A dashboard open all day at 4-second refresh adds 21,600 snapshots. Typical ingestion updates one `WITHOUT ROWID` reading window per exchange, with extra writes at minute/boot boundaries and for logs/commands. There is no mutable timestamp index rewritten on every sample. Every sample is retained in the minute block; this is lossless grouping, not averaging.

Capacity maintenance runs every 15 minutes. It reads the D1 `size_after` metadata, current-day minute counters and archive manifests using bounded/device-scoped queries. Estimates reserve 5,000 D1 writes/day and 21,600 Worker requests/day for housekeeping and owner access. At 80% a warning appears; at 95% of a 500 MB database, 10 GB archive storage, daily write budget or request budget new data writes pause. Missing capacity data or a check older than one hour pauses uploads. Firmware must honor the returned 60-second pause cadence.

These are application guards, not an account-wide billing cap. Other applications, manual bucket writes, unbounded owner downloads, attacks, retries, and Cloudflare accounting can differ. Workers/D1 Free provider limits can reject requests before a guard responds; R2 bills included-capacity overages. A paid Workers upgrade was not requested. Monitor the Cloudflare account usage and R2 billing dashboard, especially during the first field run. The request reserve assumes one dashboard; Console combines logs, commands and state in the same snapshot request. History/export, user actions and additional tabs add requests. No automatic upgrade exists.

Published limits checked 10 October 2026: [Workers Free](https://developers.cloudflare.com/workers/platform/limits/) 100,000 requests/day and 10 ms CPU per request/cron; [D1 Free](https://developers.cloudflare.com/d1/platform/pricing/) 100,000 rows written/day and 5 million rows read/day; [R2 Standard](https://developers.cloudflare.com/r2/pricing/) includes 10 GB-month storage, 1 million Class A and 10 million Class B operations monthly. Index changes count toward D1 writes. Actual full blocks and realistic loads need observation under the CPU limit.

## Retention and archive format

Cron every 15 minutes:

1. Take a 3-minute lease to prevent overlapping maintenance.
2. Prune at most 200 expired logs; mark queued commands expired; prune unused older boot anchors.
3. Pick oldest device/hour outside the rolling 30-day range; read at most 30 minute blocks.
4. Serialize compact tuples with the explicit `sampleFields` mapping, anchor, boot ID, state and receipt timestamps.
5. Gzip into `v1/<device>/<YYYY-MM-DD>/<HH>/<original-sha256>.json.gz`.
6. Write through private `ARCHIVES`, read back the complete object, compare SHA-256.
7. Insert verified manifest and delete only unchanged source block revisions in one D1 transaction.

Failed R2 write/readback retains D1 source. Capacity at 95% stops archival and retains D1 data. Real archives are never automatically deleted. Hourly groups can have several chunks; if there is backlog, retention exceeds 30 days until maintenance catches up. At most 2,976 archive attempts/month at the 15-minute schedule, before explicit owner runs/retries. Downloads require owner authentication and a verified manifest. An unverified orphan from an interrupted job is not served; inspect such objects manually before removal.

Manifest includes device/hour, sample/block counts, compressed size, compressed and original SHA-256, verification time and format version. Decode gzip, verify both hashes, then map `samples` tuples with `sampleFields`. Preserve null original UTC; calculate estimated UTC as `anchorMs + uptimeMs`. Keep the archive catalog and raw originals when doing analysis.

## Backup and recovery

From this directory, use `cf.ps1`; it finds installed Node or the bundled runtime and fixes PATH for Wrangler.

```powershell
.\cf.ps1 d1 export coop-monitor-db --remote --output .local\coop-monitor-backup.sql
.\cf.ps1 d1 migrations list coop-monitor-db --remote
.\cf.ps1 deployments list
.\cf.ps1 r2 bucket info coop-monitor-archives
.\cf.ps1 r2 bucket dev-url get coop-monitor-archives
```

Keep backups and `.credentials.local.json` in private storage. A D1 SQL backup includes device token hashes and command/measurement data. R2 objects live separately; archive copies should retain object keys/manifests/checksums. For recovery provision a separate D1 database and verify a backup restore there before changing the binding; do not import over a live database without a reviewed backup/recovery step. Wrangler deployments support code rollback; a code rollback does not undo schema changes.

## Credentials

`.credentials.local.json`: owner key, device token and session secret. `.secrets.production.json`: only Worker owner/session secrets. `.dev.vars`: local secrets. `firmware/coop_monitor/dashboard.local.json`: only device connection. All are Git-ignored. `prepare-credentials.mjs` reuses existing secrets and regenerates derived files; it does not rotate credentials.

To rotate an owner key, generate a new private key and update the Worker secret; rotate SESSION_SECRET to invalidate all existing cookies. To rotate the device key, replace its SHA-256 hash in D1 and reprovision firmware. Preserve a recovery copy; a random change in only one side disconnects the device. Never embed the owner key in dashboard assets.
