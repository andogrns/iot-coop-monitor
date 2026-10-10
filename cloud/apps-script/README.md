# Google Sheets ingestion

**Legacy backend:** this guide belongs to `codex/wifi-cloud` and `codex/quicktest`. The active `main` firmware uses [Cloudflare protocol v1](../coop-monitor-worker/README.md) and `dashboard.local.json`. The old Sheet, deployment and `cloud.local.json` remain available for historical firmware. Use this guide and its USB helpers from the corresponding historical branch; the current provisioning helper targets Cloudflare.

The private spreadsheet is [Coop Monitor — WiFi Cloud](https://docs.google.com/spreadsheets/d/1Pv_26gZrTQ3hHmFqBW2cFxugm8JXZ5-FyX_x4JqN9ro/edit).
The Apps Script project is [Coop Monitor — WiFi Cloud Upload](https://script.google.com/home/projects/1Tku2mbG-vDyCZpq0wCFpFHTmzkCRAC4CKpWX9oWROuEYx_Z13t4qePw4/edit).

`Code.gs` and `appsscript.json` are the source of the ingestion API. The
spreadsheet has `Readings` (API v1, 19 columns) and `QuickTests` (API v2,
29 columns), numeric measurements with units
in headings, and the `Asia/Jakarta` display timezone. `NA` means an unavailable
measurement. An unknown sample time remains blank; receipt time is a separate
server timestamp and never replaces sample time.

## One-time deployment

1. Paste `Code.gs` into the Apps Script editor. Enable the manifest in Project
   Settings and replace `appsscript.json` with this directory's manifest.
2. Add Script Properties `SPREADSHEET_ID` and `DEVICE_TOKEN`. The latter must be
   64 random lowercase hex digits. This device token authorizes ingestion only;
   it is not your Google password, Google API key, or a sheet-reader credential.
3. Choose **Deploy > New deployment > Web app**. Execute as **Me**, access
   **Anyone**. Google may require the account owner to authorize the script's
   Sheets permission. Keep the spreadsheet's sharing restricted to its owner.
4. Store the observed deployed `/exec` URL in the ignored
   `firmware/coop_monitor/cloud.local.json` as `endpoint_url`. Use the same
   `device_token` as the Script Property. No secrets belong in tracked files.
5. Configure the ESP32 with the visible USB helper described in the firmware
   README. No Windows background service is installed.

The created project already has the source, manifest, and Script Properties
installed. Version 2 is deployed at the existing URL and the ignored local config contains its
verified `/exec` URL and device token. Live authentication and duplicate retry
tests passed, with independent Sheet readback. See [verification results](../../VERIFICATION.md)
for the completed checks and pending hardware tests.

## API v1

POST JSON `{ "version": 1, "token": "<device token>", "records": [...] }`.
A request has 1–20 records and at most 32,768 characters. Record fields are
defined by `validRecord()` in `Code.gs` and the firmware's `payload()`.
Record IDs are `device_id:boot_id:sequence`; the sequence remains monotonic
across empty queues and the boot ID distinguishes separate boot sessions.
The API acknowledges IDs in the same order as the request only after rows have
been written. An HTTP 200 by itself is not an acknowledgement.

Authentication and validation happen before spreadsheet access. The script
holds a lock while finding IDs and writing new rows, so retries do not duplicate
records, including a retry after a write succeeded but its response was lost.
GET returns only the service name/version. It never returns private readings.

Google's Content Service redirects the response to `script.googleusercontent.com`.
The firmware follows only that HTTPS host, using GET without the token/body,
and validates certificates against public Google Trust Services roots. It waits
for NTP time before TLS requests. Failed requests remain queued; retry delays
increase to five minutes. Review Google's [Apps Script quotas](https://developers.google.com/apps-script/guides/services/quotas)
for the account and collection duration; this prototype does not promise
unlimited spreadsheet growth or upload availability.

Run `node cloud/apps-script/test_ingest.mjs` from the repository root for mock
platform tests. Mock tests do not prove that the Google deployment is running.

After deployment, `test_live_endpoint.ps1` reads the ignored local configuration,
tests an invalid token, then submits the same two synthetic test IDs twice. It
uses certificate-validated HTTPS and retrieves Google redirects with GET without
forwarding the token. Read the IDs back from the Sheet and verify exactly two
rows exist, with `test-000000000000` as their device ID; these are test data, not
sensor measurements. The helper fails if no real endpoint URL is configured.

## API v2: quick-test sessions

`codex/quicktest` sends all v1 record fields plus `elapsed_test_s`. Its request is
`{version:2, token, session, records}`. `session` has `id` (32 lowercase hex
digits), `duration_min` (15 or 30), `outcome` (Completed, Stopped, Interrupted or
Storage error), and `calibration` with numeric `baseline_mv`, `threshold_mv`,
`sd_mv`, `samples`, and `temperature_c`, `humidity_pct` (numbers or null).
Elapsed seconds must be nonnegative and below the planned duration.

The accepted calibration snapshot is frozen at arming; it is not a command to
restore/change calibration remotely. `QuickTests` uses exact `QUICK_HEADERS`
from `Code.gs`: the 19 original columns, then session ID, elapsed time, planned
duration, outcome and six calibration columns. Header mismatches reject writes.
Authentication, 1–20 batch size, acknowledgement and locked deduplication remain
the same. API v1 continues writing only to `Readings`.

For a fresh installation create both tabs, copy `HEADERS`/`QUICK_HEADERS` into
row 1, freeze that row, and format B:C as dates, measurement columns as numbers,
IDs as text. Set the spreadsheet timezone to Asia/Jakarta. To update this
existing endpoint while keeping the URL, choose **Deploy > Manage deployments >
Edit > New version**. Retain its permissions and Script Properties.

Run `test_live_endpoint.ps1 -QuickTest` for synthetic v2 tests and independently
read the returned IDs from `QuickTests`. Both v1 and v2 live tests passed on
4 October 2026; real ESP32 upload/recovery/button operation still needs testing.
