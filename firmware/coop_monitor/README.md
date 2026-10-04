# Offline quick test, then Google Sheets upload

**`codex/quicktest`** records every two seconds for 15 or 30 minutes. It is based
on `codex/wifi-cloud`; Wi-Fi stays off until `TEST UPLOAD`. `main` retains SD
logging and `codex/wifi-cloud` retains continuous cloud logging. Upload this
branch's **`coop_monitor.ino`**, with its headers and `partitions.csv`.

MQ-135 readings are relative gas response, not validated ammonia ppm. Calibration,
warning thresholds, OLED measurements and readable Serial output are preserved.
No computer or network is needed at the site.

## Before the trip

Close Serial Monitor and any logger: only one process may own COM5. Build/upload:

```powershell
.\firmware\coop_monitor\upload_wifi_cloud.ps1 -Port COM5
```

The helper identifies a 4 MB ESP32-C3, backs up `CAL EXPORT` to ignored
`outputs/wifi-cloud/backups`, and uploads with erase-all disabled. A missing
calibration export means no accepted profile existed. A Git branch change does
not change the device's installed firmware.

Arduino IDE: ESP32-C3 Super Mini, USB CDC enabled, 4 MB, no OTA, erase-all off.
Keep the supplied custom partition table with the sketch. Install the ESP32
core and Adafruit AHTX0, BMP280, SSD1306, GFX, BusIO and Unified Sensor libraries.
Serial Monitor: **115200 baud, Newline**. Check `CAL SHOW`, `QUEUE STATUS` and
`TEST STATUS`. Only for a **known empty/new filesystem**, send `QUEUE INIT EMPTY`
once if LittleFS is unprovisioned. This can erase an unmountable volume; never
use it to repair a volume containing readings. No error automatically formats.

Rehearse before relying on the field session: calibrate, arm, power-cycle, record
briefly, hold BOOT to stop, power-cycle again, check saved/pending counts, upload,
and read actual sensor rows from Sheets. Compile/server tests do not replace this.

## Tomorrow's eight steps (5 October 2026)

1. **Campus:** power by USB, open Serial Monitor, and check live readings and
   `TEST STATUS`. Upload any previous pending session before arming another.
   `TEST STOP` disarms an old armed session if you need to recalibrate.
2. **Calibrate:** put the MQ-135 in representative clean air, away from exhaust
   and cleaning vapours. Send `CAL START`; allow **10 minutes stabilization +
   5 minutes collection**. Wait for `@CAL,SAVED`, run `CAL SHOW` / `CAL EXPORT`,
   and save the complete `@CAL,DATA,...` line on the computer. Do not proceed
   on missing/failed calibration. Failed/cancelled runs preserve the old profile.
   A new MQ-135 needs more than 48 hours initial conditioning; this short
   procedure cannot replace conditioning.
3. **Arm and travel:** send `TEST ARM 30` (or `TEST ARM 15` for a fixed 15-minute
   limit), then `TEST STATUS`. Confirm **Armed**, correct duration,
   `metadata=ready`, `pending=0`. Power off and travel. The accepted calibration
   is frozen with this session; recording starts only on the **next boot**.
   Avoid another reboot during travel.
4. **Site:** power from USB/power bank, confirm OLED `REC` countdown and rising
   saved count, then leave it 15–30 minutes. To end early, **hold BOOT for at
   least two seconds while running**, then release. `TEST STOP` does the same
   over Serial. Use BOOT, not RST; do not hold BOOT at power-on/reset because
   GPIO9 low selects the ESP32-C3 downloader. Recording stops automatically at
   the selected limit; later monitoring does not add field records.
5. **Retrieve:** if returning early, stop with BOOT before unplugging. The OLED
   shows Stopped/Completed and saved count when no priority gas/ADC warning is
   displayed. You may power off for travel. Unexpected power loss recovers the
   committed samples as **Interrupted**, and never resumes recording automatically.
6. **Campus hotspot:** enable internet and **2.4 GHz** compatibility on the phone.
   Power by USB; run `CAL SHOW` and `TEST STATUS`. Completed/stopped/interrupted
   sessions remain closed on reboot. If network settings are needed, close
   Serial Monitor, run the helper below, then reopen Serial Monitor:

   ```powershell
   .\firmware\coop_monitor\configure_network.ps1 -Port COM5
   ```

   It prompts for the hotspot password securely, reads endpoint/token from
   ignored `cloud.local.json`, then releases COM5. Settings persist; configuring
   them does not connect or upload. `NET STATUS` should show configured settings.
7. **Upload:** send `TEST UPLOAD`. Keep USB/hotspot on until `pending=0` and
   `UPLOAD COMPLETE`. A full 900-record session uses 45 batches; allow several
   minutes. Wrong credentials/internet/HTTPS failures retain records and retry
   with increasing delays. `TEST UPLOAD CANCEL` cancels future attempts; an
   in-flight batch may finish. `TEST UPLOAD` resumes remaining records.
8. **Review:** open the private [QuickTests tab](https://docs.google.com/spreadsheets/d/1Pv_26gZrTQ3hHmFqBW2cFxugm8JXZ5-FyX_x4JqN9ro/edit#gid=1663671244).
   Filter by Session ID. Review elapsed test time, raw MQ response, baseline
   ratio, temperature, humidity, status and calibration columns. The first
   **10 minutes after cold boot** remain Warming up: readings are retained,
   gas warnings are gated. A 15-minute run has roughly five minutes after warm-up.

Offline samples retain **unknown UTC**; Sampled at stays blank. Received at
(Jakarta) is the later campus receipt time, not the site's sampling time.
Use **Elapsed test time (s)** to review the field sequence.

## Verified flash budget

Read-only `esptool flash-id` on COM5, 4 October 2026, identified an ESP32-C3 with
**4 MB embedded XMC flash**. The supplied no-OTA layout keeps NVS at the same
offset/size as the previous SD/cloud sketches:

| Allocation | Bytes | Purpose |
|---|---:|---|
| Application | 2,097,152 | Firmware |
| LittleFS | 1,966,080 | Queue, filesystem metadata and recovery workspace |
| NVS | 20,480 | Calibration, settings, session checkpoints |
| Logical queue | 524,288 | 4,096 x 128-byte records |
| 15-minute readings | 57,600 | Up to 450 records |
| 30-minute readings | 115,200 | Up to 900 records |
| Calibration payload | 64 | Two existing 32-byte profiles |
| Session checkpoint payload | 256 | Two 128-byte checkpoints, each includes calibration snapshot |

NVS entries and filesystem metadata add overhead. Arming requires a successful
NVS checkpoint and **131,200 free filesystem bytes for 15 minutes** or **188,800
for 30 minutes**: readings + up to 63 retired records + 64 KiB reserve. The
runtime check refuses insufficient space. `TEST STATUS` reports actual mounted
space and NVS free entries. Host tests measured exactly 450/900 packed records;
physical filesystem recovery and session operation still require device tests.

Calibration is local in `coopcal`; Wi-Fi/cloud settings use `coopnet`; session
checkpoints use `cooptest`. Calibration survives power-off. Its accepted snapshot
also uploads with each field row, but Sheets does not automatically restore the
device profile. Keep `CAL EXPORT` as backup. For the same sensor/pin/divider,
replace `@CAL,DATA,` with `CAL IMPORT,` and send the remaining fields unchanged.
Calibration changes are blocked while Armed/Recording. Calibration-period sensor
readings are not part of the field session.

## Storage and networking

Only one unuploaded session is allowed; pending records block rearming. Records
have CRC, device/boot/sequence ID, session ID, elapsed time, sensor values/status
and UTC when known. Alternating CRC-protected NVS checkpoints recover state;
an interrupted append preserves its committed prefix. Complete-record corruption
or invalid checkpoints stop storage and report errors without formatting.

Quick-test files use `/quicktest`, preserving the cloud branch's `/queue` and
metadata. The 4,096-record limit exceeds a 900-record session. If full unexpectedly,
recording stops with Storage error and **preserves existing pending readings**;
this branch does not discard oldest records. Host tests verify legacy queue isolation.

Wi-Fi/HTTPS runs in a separate task, enabled only for manual upload of a closed
session. Oldest records upload in batches of 20, and retire only after matching
acknowledged IDs. Failed/lost responses retry; Apps Script deduplicates under a
lock. Certificates are validated; Google's acknowledgement redirect is followed
only to `script.googleusercontent.com` via GET without replaying credentials.
The Sheet stays private; the endpoint serves no stored readings. Secrets are
masked in output and ignored by Git. No background computer service is installed.

## Wiring and controls

Remove MicroSD; existing sensor wiring is unchanged:

| Pin | ESP32-C3 connection |
|---|---|
| MQ-135 VCC / GND | 5 V / VBUS and GND |
| MQ-135 AO | 10 kOhm to GPIO3; another 10 kOhm from GPIO3 to GND |
| MQ-135 DO | Unconnected |
| AHT20/BMP280 and OLED VCC / GND | 3V3 / GND |
| AHT20/BMP280 and OLED SDA / SCL | GPIO4 / GPIO5 |
| Existing BOOT button | GPIO9, active low |

Use a stable USB supply that powers the MQ heater, display and ESP32; check the
power bank remains on throughout the run. Gas/ADC warnings keep OLED priority.
Otherwise the status line alternates sensor status and session/countdown/upload
progress, Wi-Fi offline, clock wait or upload error with pending count. Serial
reports the specific upload errors.

| Command | Action |
|---|---|
| `TEST ARM 15` / `TEST ARM 30` | Arm next boot; accepted calibration and empty healthy queue required |
| `TEST STATUS` | State/ID, duration, elapsed/saved/pending, flash and NVS usage |
| `TEST STOP` | Stop recording or disarm |
| `TEST UPLOAD` / `TEST UPLOAD CANCEL` | Start/resume or cancel manual upload |
| `CAL START` / `CAL CANCEL` | Start/cancel clean-air calibration |
| `CAL SHOW` / `CAL EXPORT` / `CAL IMPORT,...` | Inspect, back up or restore calibration |
| `NET STATUS` / `QUEUE STATUS` | Masked settings, connection/errors and queue space |
| `WIFI SSID ...` / `WIFI PASS ...` | Save hotspot settings (`WIFI OPEN` for an open network) |
| `CLOUD URL ...` / `CLOUD TOKEN ...` | Save `/exec` URL and 64-hex token |
| `NET RECONNECT` / `HELP` | Retry active upload connection / list commands |

Run `test_wifi_cloud.ps1` for host checks and `build_wifi_cloud.ps1` to compile
without uploading. See [verification](../../VERIFICATION.md) and
[Apps Script setup](../../cloud/apps-script/README.md).
[Espressif GPIO9 boot guidance](https://docs.espressif.com/projects/esptool/en/latest/esp32c3/advanced-topics/boot-mode-selection.html).
