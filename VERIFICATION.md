# Coop Monitor verification

## Overview spacing correction: 10 October 2026

- Added a scoped 16 px gap between the overview metrics grid and state/capacity grid. The stylesheet link includes its content hash to avoid the older cached CSS observed during review.
- Wrangler deployment completed as `a56bc274-6d03-4ebb-afc9-414cb0a842e5`. The actual owner dashboard was visually reviewed after refresh; its displayed row gap was 16 px and live telemetry remained visible. Screenshot: ignored `outputs/cloudflare/overview-spacing-fixed.jpg`. No test suite was added or run for this layout correction.

## Device connection investigation: 10 October 2026

- COM5 identified as ESP32 USB VID `303A`, PID `1001`; the serial port was opened only after the owner closed Serial Monitor. Read-only `NET STATUS`, `CONFIG SHOW` and `CAL SHOW` confirmed the installed Cloudflare runtime, configured Wi-Fi/endpoint/device token, applied monitoring revision 1 and a valid retained 150-sample calibration profile. Live sensor blocks showed AHT20/BMP280 readings and warm-up status.
- Authenticated backend readback found one startup heartbeat for boot `486d27cf7e048fe0723577cbddc07fe9`, at `2026-10-10T08:44:03.613Z`, with firmware `cloudflare-1.0.0`, `STARTING` and no sensor readings. Later snapshots remained stale; capacity/owner write pause was false. This proves one authenticated device exchange, not sustained ingestion.
- Device status was `CLOUD RETRY` despite Wi-Fi connectivity. A non-destructive USB `NET RECONNECT` did not restore uploads during observation. Sanitized Worker tails showed owner snapshot requests but no corresponding device retries in those observation windows; headers/credentials were omitted from tail output.
- Physical Serial observations showed sampling advancing every two seconds while the host read data, but long gaps after the port was closed. Core 3.3.11 HWCDC source uses a default 100 ms TX wait with up to 20 successive waits per write when the host stops consuming. The firmware wrote sample blocks before cloud publication and printed some network output while holding the shared mutex. This identifies a USB backpressure defect. The initial transport failure did not expose an HTTP/TLS code, so its precise contribution cannot be isolated retrospectively.
- The `cloudflare-1.0.1` fix configures nonblocking USB TX with bounded buffering, skips optional sample blocks without enough buffer space, publishes readings/OLED state before Serial output, removes status/announcement printing from the shared lock, and adds non-secret HTTP/TLS/Wi-Fi/heap/stack diagnostics. Connection/read timeouts increase to 15 seconds; certificate validation remains enabled. ESP32-C3 compilation passed: **1,289,117 / 2,097,152 application bytes (61%)**, **68,172 static RAM bytes (20%)**, 259,508 bytes remaining before runtime allocations. Output: ignored `outputs/cloudflare/connection-fix-build`.
- After explicit owner approval, a fresh calibration export was saved in ignored `outputs/cloudflare/backups/calibration_connection_fix_20261010_085855_UTC.txt`. Esptool identified a 4 MB ESP32-C3 and read all **4,194,304 bytes** to `flash_connection_fix_20261010_085927_UTC.bin`; SHA-256 **`7EAEF77F0A8484ABA19997979CF405391BA0B8EBCA44058082D1905091FF6595`**. The backup/hash are private ignored files; physical restore was not exercised.
- Arduino CLI uploaded the separately addressed bootloader, partition table, boot metadata and application with **erase-all disabled**, verified written hashes and reset the device. NVS at `0x9000` and the previous filesystem were outside the write/erase ranges. USB reported `cloudflare-1.0.1`; post-upload `CAL SHOW` exactly matched the pre-upload export: baseline **251.473 mV**, threshold **289.194 mV**, SD **1.709 mV**, **150 samples**. Existing Wi-Fi/device settings were configured and applied configuration remained revision 1.
- Real device ingestion resumed on boot `ddde40cf2307d80bc937f1a17555c604`: the first backend readback at `2026-10-10T09:01:52.056Z` was fresh, calibrated and `WARMUP`, with actual MQ/AHT/BMP measurements. Later history readback at `09:03:35Z` contained **58 real readings**, including successive uptimes 111782, 113776 and 115780 ms while the serial reader was closed. No readings/logs were dropped. A brief stale snapshot between successful exchanges recovered without intervention; this short observation is not a continuous-availability guarantee.
- At `2026-10-10T09:06:23.325Z`, history contained **140 consecutive readings** from sequence 1 through 140 with **no missing sequence IDs**. Adjacent sample intervals were **1,993–2,136 ms** over this short run; reported reading/log drop counts remained zero and backend state was fresh. The serial reader had been closed since approximately one minute after boot. Warm-up remained active as expected after the upload reset.
- The actual owner dashboard displayed these sensor values and firmware/calibration state. Sanitized Worker tails subsequently showed physical `POST /api/device/exchange` responses **HTTP 200**, outcome `ok`, with no exceptions. Request headers and credentials were omitted. Snapshots/history evidence is saved under ignored `outputs/cloudflare/`.
- No calibration, Wi-Fi credential, threshold or sampling setting was rewritten. Serial ports and temporary Worker tails are released after observation. Remaining device acceptance includes independent power-cycle persistence, warning/OLED observation, changed settings, each command, Wi-Fi outage/overflow/pause/recovery and a 24-hour run with measured account usage.

## Cloudflare firmware source: 10 October 2026

- The active monitor now uses Cloudflare protocol v1 at the deployed `/api/device/exchange` endpoint. Source was prepared on `codex/cloudflare-firmware` from `codex/quicktest` for the requested publication to `main`. Historical branch refs and the original SD commit remain available.
- Readable Serial, sensor/OLED integration, the accepted calibration format/namespace and warning guards are preserved. Settings, logs, command receipts/recovery and a separate HTTPS task are integrated. Measurements/logs use bounded RAM, and the new runtime does not mount/format legacy flash measurement storage.
- Final ESP32-C3 Arduino compilation passed with ESP32 core **3.3.11**, board `esp32:esp32:nologo_esp32c3_super_mini`, USB CDC enabled, no OTA, supplied `partitions.csv` and erase-all off. Application: **1,286,925 / 2,097,152 bytes (61%)**. Static globals: **67,956 / 327,680 bytes (20%)**, leaving **259,724 bytes** before task stacks, heap, JSON and TLS runtime allocations. Output: ignored `outputs/cloudflare/build`. This is compilation, not a measured runtime RAM result.
- The live HTTPS endpoint presented an authorized Let's Encrypt YE2 chain through ISRG roots during the host inspection. Public ISRG Root X1/X2 were obtained from official Let's Encrypt URLs and checked against SHA-256 fingerprints; GTS trust roots are retained for issuer rotation. Firmware uses CA and hostname validation with no insecure fallback. This does not establish an ESP32 TLS handshake.
- Provisioning now reads the separate ignored `dashboard.local.json`; Wi-Fi settings use secure prompts and credentials are not printed. The upload helper adds legacy pending-data checks and a full 4 MB flash backup/SHA-256 before an erase-all-off upload. Neither helper was executed against a COM port during this source update.
- PowerShell parsing passed for the build, upload and provisioning helpers. Git index whitespace review passed. All 67 indexed files were compared locally against actual owner/device/session/legacy secret values; no matches were found. Local credential files, backups and generated builds are Git-ignored. This source review did not open a serial port or perform physical recovery.
- No new tests were added or run for this firmware update. Earlier legacy tests below do not establish Cloudflare firmware behavior. The source build and review do not prove sensor timing, warning behavior, NVS persistence/recovery, command execution or network handling on the physical board.

**Subsequent physical recovery:** the connection investigation above completed the approved upload, retained provisioning/calibration, real sensor ingestion and dashboard display. Independent power-cycle persistence, warning/OLED observation, changed settings, each command, interrupted-command/restart recovery, Wi-Fi outage, RAM overflow, owner pause and a 24-hour run remain. See the [current firmware guide](firmware/coop_monitor/README.md).

## Cloudflare backend deployment: 10 October 2026

The original backend acceptance used Worker version `46c5362c-39a0-4472-ba44-7f00fadbe996`, with D1 `coop-monitor-db`, private R2 `coop-monitor-archives` and registered device `coop-monitor-01`. The later overview spacing deployment is recorded above. The earlier backend work passed **32 live acceptance checks** using identified synthetic data, including authentication, duplicate retries, settings/commands, pause/resume, export and verified archive/retention. Its final fixture contained 900 readings in 30 minute blocks; gzip readback/checksum passed and the fixtures were cleaned up. See [backend evidence](cloud/coop-monitor-worker/VERIFICATION.md) and [deployment details](cloud/coop-monitor-worker/DEPLOYMENT.md).

These were backend checks from the deployment stage, not newly run firmware tests. No backend redeployment, physical flash, calibration, real sensor ingestion or independent database restore was performed during the firmware source publication.

## Historical Wi-Fi / QuickTest evidence

The dated results below describe older firmware and Apps Script deployments. References to the previous `main` SD implementation and branch creation describe those dates; the current `main` source is Cloudflare. Preserve the evidence without interpreting it as current physical acceptance.

## Quick-test branch: 4 October 2026

- User-provided device Serial output after explicit `QUEUE INIT EMPTY` reports
  `@QUEUE,INITIALIZED`, `queue=ready`, `metadata=ready`, 4,194,304 chip bytes,
  1,966,080 filesystem bytes with 24,576 used (1,941,504 free), and 552 NVS free
  entries. This confirms physical filesystem provisioning and an empty session
  checkpoint on the installed device. Calibration and network settings remain
  missing in that output; record persistence and physical uploads are not yet
  established. Successful initialization now clears the stale startup
  `FLASH QUEUE ERROR` status text.

- Windows PowerShell 5.1 helper fix: default configuration paths are resolved
  in the script body instead of parameter defaults. The reported empty
  `PSScriptRoot`/`Join-Path` failure was reproduced before the change. Startup
  afterward reached the Wi-Fi prompt using the default config from both the
  project folder and a different working directory; explicit missing-config
  handling also passed. These checks used noninteractive mode and an invalid
  test port, so they did not open COM5 or write device settings. The live
  endpoint helper's matching default-path issue was corrected too.

- `codex/quicktest` was created from `codex/wifi-cloud` commit `60356cd`.
  `main` and `codex/wifi-cloud` remain separate; unrelated test sketches/files
  were left untouched.
- Firmware adds next-boot arming for 15/30 minutes, two-second local recording,
  BOOT hold/Serial early stop, manual upload, closed-session restart protection,
  calibration snapshots and isolated `/quicktest` storage. No field records are
  discarded on overflow; it stops and reports Storage error.
- Physical **read-only** COM5 probe identified ESP32-C3 revision v0.4, embedded
  **4 MB XMC flash**, manufacturer 0x46 / device 0x4016. `CAL EXPORT` returned
  `@CAL,MISSING,mq135-01`; calibration must be completed before arming. No new
  firmware was uploaded, flash erased, or calibration written by these probes.
- Record size is 128 bytes; compiled host session/adapter tests measured
  **450 records / 57,600 bytes** for 15 minutes and **900 / 115,200 bytes** for
  30 minutes. Two calibration profiles occupy 64 payload bytes; two session
  checkpoints occupy 256 payload bytes, including calibration snapshots.
  The partition table allocates 1,966,080 bytes LittleFS and 20,480 bytes NVS.
  Physical filesystem/NVS overhead is additional; arming checks actual free
  LittleFS space (131,200/188,800 bytes minimum) and successful NVS persistence.
- Final ESP32-C3 Arduino compilation (core 3.3.11, USB CDC, supplied no-OTA
  partitions, erase-all off) passed: **1,288,179 / 2,097,152 application bytes
  (61%)**, **39,836 static RAM bytes**, 287,844 bytes remaining before runtime
  allocations/task stacks. The build did not upload the device.
- Session tests passed for calibration snapshot persistence, arm-on-next-boot,
  closed-session reboot, early stop, BOOT release/hold timing, millis rollover,
  interrupted-session recovery, checkpoint CRC/write faults, acknowledged
  prefixes, full-queue refusal and preservation of legacy cloud queue files.
  Existing queue faults, real adapter with a host filesystem stand-in, and
  reading formatter regressions passed. These are simulations, not physical
  LittleFS power-cut tests or measured sensor timing.
- Apps Script source v1/v2 passed mock tests for authentication, field and
  calibration validation, typed values, unknown/NTP time, separate tabs,
  locks, duplicate retries and server failure after committed writes.
- Private `QuickTests` tab has 29 verified headings, frozen header, typed
  date/numeric formats, filter and calibration/time notes; Jakarta timezone
  retained. Drive metadata confirms owner-only permissions, `shared: false`.
- Apps Script editor readback matched local `Code.gs`. The existing deployment
  was updated to **version 2**, retaining URL, token, execute-as-owner and
  Anyone access. API v1 still writes to `Readings`; v2 writes to `QuickTests`.
- Live certificate-validated v2 test rejected a wrong token and acknowledged
  the same two synthetic IDs twice. Independent `QuickTests!A1:AC5` readback
  found exactly two rows for boot `4e1bbaff999241b6b4e8701d8e47bdd2`, with session
  `65c66e3aca064ad29387f74b50f62f48`, elapsed 0/2 seconds, outcome Stopped,
  duration 30, and numeric calibration 1000/1150/12 mV, 150 samples, 29 C, 65 %RH.
  Unknown sample time remained blank and server receipt time was separate.
  Original API v1 live retry/authentication test also passed, with two independently
  read-back rows for boot `e98204fd780a4b679afe23f7f3800f1e` in `Readings`.
  These four synthetic rows were cleared after verification, preserving formats.
  Final readback of both tabs contains only their headers; the ready QuickTests
  layout was inspected in the browser and captured in ignored outputs.

**Still requires the flashed device:** calibration and power-cycle persistence,
BOOT early stop, timer/sensor timing,
physical interrupted-write recovery and real device HTTPS/Sheet ingestion.
Flash-chip capacity identification and host/server tests do not prove these.
The field rehearsal and eight-step guide is retained on `codex/quicktest`.
The following results describe the earlier cloud branch.

## Earlier Wi-Fi cloud implementation: 2 October 2026

- Branch `codex/wifi-cloud` was created from `main`. Only the integrated monitor,
  its cloud support/setup/tests, root README and ignore rules were changed.
  `main` retains the SD firmware.
- Actual Arduino compile using ESP32 core 3.3.11, board
  `esp32:esp32:nologo_esp32c3_super_mini`, USB CDC enabled, no OTA, erase-all off,
  and the supplied custom partition table passed: **1,278,751 bytes** of the
  2,097,152-byte application partition (60%). Globals use **39,580 bytes**;
  288,100 bytes remain before runtime allocations and task stacks.
- Packed record size was measured by the compiled shared implementation:
  128 bytes; capacity 4,096; logical payload 524,288 bytes. Periodic-only
  retention is 34 hours 8 minutes. The host adapter held 4,096 recent records
  after 10,000 appends, reclaimed retired segments, and used no more than
  65 record segments (up to 63 retired records of extra segment space).
- Shared queue state-machine fault injection passed: reboot, empty-queue
  sequence persistence, overflow, lost acknowledgement, committed append with
  lost write response, failed checkpoints, metadata fallback and CRC faults.
- The actual `FlashStorage` adapter passed against a host FS stand-in: short
  append-tail recovery, oldest-first batches, overflow/reclamation, failed
  metadata replacement, corruption refusal, and no formatting on mount failure.
  This exercises adapter code, not LittleFS internals or real flash electronics.
- Existing extracted Serial/CSV formatter regression checks passed: units,
  unavailable measurements, status labels, incomplete blocks and compatibility.
- Actual Apps Script source passed Node platform-mock tests: token rejection,
  malformed/out-of-range records, batches/IDs, typed dates/numbers, unknown time,
  lock contention, deduplication and a committed write whose response was lost.
- PowerShell helper syntax and Git whitespace checks passed. Local config/token
  is ignored by Git; the partition CSV is explicitly retained.

Run `firmware/coop_monitor/test_wifi_cloud.ps1` to repeat host checks;
`build_wifi_cloud.ps1` performs the actual embedded compile without uploading.

## Google resources verified

- Native private Sheet [Coop Monitor — WiFi Cloud](https://docs.google.com/spreadsheets/d/1Pv_26gZrTQ3hHmFqBW2cFxugm8JXZ5-FyX_x4JqN9ro/edit)
  exists, with the `Readings` tab, all 19 unit-bearing headings, frozen first
  row, typed formats, filter and `Asia/Jakarta` timezone.
- Drive metadata readback confirmed native Google Sheets MIME type,
  `shared: false` and owner-only permissions. Header readback matched Apps
  Script's schema exactly. Native layout was inspected in Google Sheets.
- Apps Script [Coop Monitor — WiFi Cloud Upload](https://script.google.com/home/projects/1Tku2mbG-vDyCZpq0wCFpFHTmzkCRAC4CKpWX9oWROuEYx_Z13t4qePw4/edit)
  was created. Installed editor source was read back and matched `Code.gs`.
  The manifest and spreadsheet ID/device token Script Properties were saved.
- After account authorization, deployment version 1 was confirmed in Manage
  deployments: execute as the owner, access Anyone. Its actual `/exec` URL was
  saved in ignored local device settings; it is not a reader of private data.
- `test_live_endpoint.ps1` passed against that actual deployment using
  certificate-validated HTTPS: a wrong token was rejected with `UNAUTHORIZED`,
  and two submissions of the same two synthetic IDs returned matching
  acknowledgements. Google's redirect response was retrieved via GET without
  replaying the request token/body.
- Independent Sheet readback confirmed exactly two rows for those IDs, numeric
  measurements, `NA` for an unavailable baseline ratio, blank unknown sampled
  time, the synchronized sampled time, and a separate server receipt time.
  Receipt was displayed as 2026-10-02 12:31:48 in Jakarta; the synchronized test
  sample showed 12:31:42. Owner-only sharing was reconfirmed after deployment.
- The two synthetic rows were cleared after verification; final Sheet readback
  contains only the original headers. Test screenshots are saved in ignored
  `outputs/wifi_cloud_01a0fad4/`. These were server tests, not sensor readings.

## Physical verification still required

The ESP32 was not connected during this implementation; COM enumeration found
only Bluetooth serial ports. No firmware was uploaded and no physical readings
were sent to Google Sheets. Compilation does not verify the installed flash size.

Use the upload helper to verify actual 4 MB flash and back up `CAL EXPORT` before
changing partitions. Then confirm `CAL SHOW` agrees, explicitly initialize only
a known empty LittleFS volume, configure networking, and read back a sensor row
from the private Sheet.

| Check | Required device/cloud evidence |
|---|---|
| Normal uploads | Real sensor IDs acknowledged and rows read back from Sheets |
| Wrong Wi-Fi credentials | Queue grows; two-second samples and warnings continue |
| Wrong device token | Server rejects; device retains pending IDs |
| Internet/NTP outage | Offline samples have unknown time; queue survives restart |
| Lost acknowledgement | Retry produces one row per ID and eventually retires it |
| Restart/power interruption | Committed records survive; short tails detected; no automatic format |
| Queue overflow | Newest 4,096 pending records retained; persistent discarded count rises |
| Monitoring during upload failure | Physical sample timing and OLED warning priority observed |
| Firmware change | Flash backup preserved; calibration values match after upload |

The 4,096-record capacity is verified in compiled host tests. Actual filesystem
space, flash durability/power-cut behavior, radio/power stability, wall-clock
sampling timing under load, calibration persistence on a device and real device
ingestion remain separate, uncompleted checks. Live Google ingestion has been
verified using synthetic records only.
