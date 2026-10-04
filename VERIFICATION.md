# Wi-Fi cloud verification — 2026-10-02

## Quick-test branch: 4 October 2026

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
  partitions, erase-all off) passed: **1,288,133 / 2,097,152 application bytes
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

**Still requires the flashed device:** actual queue mount/free-space readback,
calibration and power-cycle persistence, BOOT early stop, timer/sensor timing,
physical interrupted-write recovery and real device HTTPS/Sheet ingestion.
Flash-chip capacity identification and host/server tests do not prove these.
Follow the [field rehearsal and eight-step guide](firmware/coop_monitor/README.md)
before unattended use. The following results describe the earlier cloud branch.

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
