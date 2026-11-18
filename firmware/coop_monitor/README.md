# ESP32-C3 monitor with Cloudflare

**3 November 2026 sensor diagnosis:** source firmware is `cloudflare-1.0.4`. At the user's request, OLED work is deferred and OLED traffic is disabled; AHT/BMP default to 100 kHz I2C. Local `aht20_reader.h` uses `0xBE` initialization when needed, an 80 ms conversion wait, bounded busy polling, CRC-checked seven-byte measurements and one full-conversion retry. Local `bmp280_reader.h` checks chip identity, repeated factory-trim reads, configuration and complete measurement transfers before Bosch compensation. Failed readings remain invalid and trigger ten-second reinitialization. See [verification](../../VERIFICATION.md) for the installed binary and actual device results.

The damaged MQ module was replaced with a new, initially unconditioned module, identified as `mq135-02`. Its calibration uses separate `mq02_*` keys; the old module's profile is preserved but cannot apply to the replacement. Initial conditioning and a new clean-air calibration are still required. USB `SENSOR STATUS` reports sensor errors/recovery counters and a fresh BMP chip-ID check; `MQ CHECK` takes a bounded 256-sample ADC/noise/clipping check without saving calibration. `I2C SCAN` remains available. `OLED TEST` reports disabled in this build. Earlier white/striped OLED output did not establish the DSP-0109 controller because prior SSD1306/SH1106 initialization was not separated by physical power removal; normal display operation remains unresolved.

USB `I2C RATE <10000|50000|100000>` temporarily changes the bus clock for controlled sensor diagnostics while OLED is disabled. It changes RAM only; reboot restores the compiled default. A successful sample after retry does not establish an error-free electrical bus. Do not use a lower speed as a claimed fix without comparing actual sensor failure/recovery counters.

**Standalone week-long field run:** use the [5 November launch handoff](../../docs/FIELD_RUN_2026-11-05.md). `preflight_field_run.ps1 -Port COM5` performs a bounded 15-minute read-only sensor/upload check and writes `result.json` under ignored outputs. Add `-ReconnectOnce` to request one reconnect using existing settings. It requires fresh accepted protocol exchanges and a draining queue; HTTP 200 alone is insufficient. Actual new dashboard History rows remain a separate mandatory launch check. The tool neither calibrates nor flashes. Offline buffering remains only 64 readings; no week-long computer capture or new persistent device logger is installed by this helper.

Source/documentation reviewed **18 November 2026 (Asia/Jakarta)**. Current source is `cloudflare-1.2.0`; OLED traffic is disabled. USB backpressure handling, protocol 1 and verified TLS remain. See [stack architecture](../../docs/STACK_ARCHITECTURE.md), [project handoff](../../docs/PROJECT_HANDOFF.md) and [operations handoff](../../docs/OPERATIONS_HANDOFF.md).

The **10 October** physical upload installed `cloudflare-1.0.1` on the ESP32-C3 SuperMini. A verified full 4 MB flash backup and calibration export preceded the erase-all-off upload. Calibration and existing Wi-Fi/device settings were retained; actual sensor readings and applied revision 1 were read back then. Sampling/uploads continued with Serial Monitor closed during that short check. This is historical evidence, not today's device status. The later 13 October stored snapshot recorded revision 3 and 30-second sampling; it was not refreshed here. See [verification](../../VERIFICATION.md) and [project context](../../PROJECT_CONTEXT.md).

MQ-135 values are relative gas response, not validated ammonia ppm. Default sensing is every **2 seconds**, with a **10-minute cold-boot warm-up**. Calibration, warm-up, invalid sensors and ADC-high status suppress gas warnings even with a manual threshold.

**Latest recorded sensor checks (4 November):** replacement AHT/BMP and subsequent closed-lid runs each captured 180 readings in 15 minutes with zero retries/final failures. OLED was intentionally disconnected; Wi-Fi was intentionally off in those timed checks. Revision 4 / five seconds and missing mq135-02 calibration remained. Earlier old-module retry faults do not describe the replacement test, and neither run establishes field endurance or fresh History persistence.

## Hardware

Use the ESP32-C3 SuperMini, MQ-135 module, two 10 kOhm divider resistors, AHT20/BMP280 combined module and SSD1306 128x64 I2C OLED (disconnected; output disabled in firmware). See the [pin table and wiring diagram](WIRING.md).

- MQ heater: stable 5 V / VBUS; all grounds shared.
- MQ AO: 10 kOhm to GPIO3; another 10 kOhm from GPIO3 to GND. Never connect a possible 5 V AO directly to the ESP32.
- I2C: GPIO4 SDA, GPIO5 SCL; combo module and OLED powered from 3V3.
- MicroSD backup (`cloudflare-1.1.0`): CS GPIO10, SCK GPIO6, MOSI GPIO7, MISO GPIO1; adapter B (3V3, CS, MOSI, CLK, MISO, GND) powered from the C3 3V3, never 5 V, with 100 µF across its 3V3/GND. Use a FAT32 card of 32 GB or less. `sd_backup.h` buffers every reading and device log event in RAM (4 KiB), writes whole 512-byte sectors every 15 minutes or at 3 KiB (about every 3 minutes at 5 s), reads each write back, and starts `/coop/bNNNNN.csv` on each boot. A power cut loses at most the ~3 minutes still in RAM. USB: `SD STATUS`, `SD TAIL`, `SD FLUSH`, `SD EJECT` (before removing the card), `SD MOUNT`. The firmware runs normally without a card.
- Diagnostics (`cloudflare-1.1.0`): one `BOOT reset=<reason>` log per boot (plus `cause=tls_memory` after a safety restart: if HTTPS cannot allocate TLS memory for 10 minutes, the firmware flushes the SD buffer and restarts), a `CRASH task=... pc=...` log after a firmware crash (core dump summary), and `state.health` with Wi-Fi signal, reconnects, upload failures, RAM queue depth, free memory (including `largestFreeBlock`, the limit for opening TLS), AHT/BMP counters and SD status. The RAM upload queue holds 64 readings (about 5 minutes at 5 s); the SD card is the record for longer outages.
- Network robustness (`cloudflare-1.1.0`): Wi-Fi TX power is 8.5 dBm (the SuperMini antenna fails to authenticate or pass traffic at full power). DNS prefers 1.1.1.1/8.8.8.8 with the DHCP server as fallback. SNTP syncs once after connecting, is then stopped, and resyncs daily with uploads paused during the sync. This avoids a core 3.3.12 crash where `hostByName` clears the DNS cache during an SNTP lookup. `NET STATUS` also prints `@NET,ADDRESS` (IP, gateway, DNS).
- BOOT/GPIO9 has its normal bootloader role. It no longer stops a field session. Holding it during reset can enter download mode.

## Build without uploading

Install Arduino IDE, **ESP32 by Espressif Systems**, Adafruit SSD1306, GFX and BusIO. AHT20 and BMP280 support is local to this sketch. `Wire`, `Preferences`, Wi-Fi, TLS, HTTP and cJSON come with the ESP32 core. The October build used core **3.3.11**; the November repair build uses installed core **3.3.12**.

From the repository root in PowerShell:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\firmware\coop_monitor\build_wifi_cloud.ps1"
```

The helper finds Arduino IDE's CLI by default; use `-ArduinoCli 'C:\path\to\arduino-cli.exe'` if needed. It writes ignored `outputs/cloudflare/build`. This invocation changes execution policy only for that process.

Board: `esp32:esp32:nologo_esp32c3_super_mini`, USB CDC on boot, 4 MB flash, no OTA, erase-all **off**. Keep every active header and the supplied `partitions.csv` with `coop_monitor.ino`. The 2 MiB application partition and NVS/filesystem offsets match the prior build. The Cloudflare runtime neither mounts nor formats LittleFS; old filesystem bytes are retained.

## USB cutover

1. With the **old firmware still installed**, export calibration with `CAL EXPORT`. If using QuickTest, stop/disarm any active session and upload/export its pending readings using that branch's guide. For the older continuous uploader, let its pending queue finish. Keep the corresponding firmware source and a copy of any historical data needed for rollback.
2. Close Serial Monitor and any capture process. Only one process may own the COM port. Replace `COM5` below with the device's actual port.

   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\firmware\coop_monitor\upload_wifi_cloud.ps1" -Port COM5
   ```

   The helper compiles, identifies a **4 MB ESP32-C3**, queries calibration and legacy session/network status, then saves a calibration export and complete 4 MB flash dump with SHA-256 in ignored `outputs/cloudflare/backups`. It stops before upload if calibration cannot be read, the backup fails, a session is Armed/Recording, or reported legacy readings remain pending. `-LegacyRecordsExported` permits pending legacy records only after you have independently preserved them; it never bypasses an active session. The new firmware cannot upload legacy flash records.

   The upload keeps erase-all disabled. Full flash backups can contain credentials; keep them private. A backup file and hash do not establish physical restore success.
3. Open Serial Monitor at **115200 baud, Newline**. Check `CAL SHOW`, `CONFIG SHOW`, `NET STATUS` and the sensor readings. Compare calibration with the pre-upload export. Do not initialize/format the old filesystem.
4. Close Serial Monitor, then provision Wi-Fi and the Cloudflare device credential:

   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\firmware\coop_monitor\configure_network.ps1" -Port COM5
   ```

   The helper reads ignored `dashboard.local.json`, prompts for a **2.4 GHz** Wi-Fi SSID and password, saves settings and requests reconnect. Passwords/tokens are not printed. It accepts open networks, 8–63 UTF-8 password bytes or a 64-character hex key. Provisioning writes to NVS; it does not flash the firmware.
5. Reopen Serial Monitor. Expect `CLOUD CONNECTED` after Wi-Fi and NTP time synchronization. Confirm `CONFIG SHOW` reaches desired revision 1 or the dashboard's current revision. Open [Coop Monitor](https://coop-monitor-worker.coop-monitor-worker.workers.dev/) using the separate owner key, and confirm actual sensor readings, device uptime and the installed firmware version.

The backend has already registered **`coop-monitor-01`**. You do not need another D1 database, R2 bucket or device registration. The local provisioning file contains protocol version 1, that ID, the exact exchange endpoint and its device token. `dashboard.example.json` is a safe template for another authorized provisioning setup. Legacy `cloud.local.json` has a different format/token and is not used by the current helper.

## Calibration and warnings

A new MQ-135 requires initial conditioning; use the established more-than-48-hour procedure before short clean-air calibration. Keep the sensor in known representative clean air away from exhaust, smoke, alcohol and cleaners. Send `CAL START` and allow **10 minutes stabilization plus 5 minutes collection**. Wait for `@CAL,SAVED`, then save `CAL EXPORT`. Failed or cancelled calibration retains the previous accepted profile.

Calibration always samples every 2 seconds during its collection workflow, temporarily overriding a slower dashboard interval. After calibration the selected interval resumes. At least 60 valid samples are required. Calibration starts only with the AHT sensor available, and warnings are suppressed during calibration.

The automatic threshold is the greater of baseline + 3 standard deviations or a 15% baseline increase. Dashboard manual thresholds are **10–2399 mV at the divided ESP32 ADC**, not MQ module volts or ppm. Warning confirmation is 1–10 consecutive samples; default 3. Normal sampling is 2–60 seconds. Changing settings resets the warning streak. A manual value below baseline is logged as a warning. ADC values at or above **2400 mV** produce the ADC-high guard.

Accepted calibration remains in the unchanged `coopcal` namespace with the existing 32-byte profile format. Replacement `mq135-02` uses `mq02_cal_a`, `mq02_cal_b` and `mq02_active`; original `cal_a`, `cal_b`, `active` and legacy keys are retained but not loaded for this module. For the same MQ module, GPIO and divider, restore a saved `@CAL,DATA,...` line by replacing `@CAL,DATA,` with `CAL IMPORT,` and sending the remaining fields unchanged. Import is USB-only. `calibrationRevision` is a CRC32 fingerprint of the accepted profile, not an increasing counter; missing calibration uses 0. A fingerprint supports history interpretation and is not a security signature.

## Cloud behavior and data loss

- HTTPS POSTs use certificate/hostname validation, a separate device bearer token and protocol version 1. No redirects or insecure TLS fallback are enabled.
- Cloud exchange runs in a separate task, normally every 2 seconds even when sampling is slower. HTTPS delays do not run in the sensing loop.
- **64 readings and 16 logs** are buffered in RAM. Each exchange sends up to **12 readings, 6 logs and 5 command results**, within the backend's minute-window limits. Only matching acknowledged IDs or explicit permanent rejections remove sent records.
- A boot gets a random ID. Sample uptime is 64-bit monotonic time; sequence IDs and payloads remain unchanged on retry. Original unknown UTC stays `null`, even after NTP becomes available. The backend provides a separately identified estimated timestamp.
- Failures retry with backoff and jitter up to about 60 seconds. HTTP 401 blocks uploads until credentials are corrected or reconnect is requested. HTTP 400/409 shows `PROTOCOL ERROR` and requires diagnosis; repeated retries are not proof of recovery.
- At 2-second sampling the buffer holds roughly **128 seconds**. When full, it drops oldest readings and increments the per-boot drop count. A power loss/restart discards pending RAM data and resets these counters. There is no flash measurement recovery or offline field-session recorder in this build.
- Owner/capacity upload pauses leave local sensing and warnings running. Exchanges usually slow to 60 seconds; pending command receipts temporarily use 2 seconds so commands can acknowledge/complete. The deployed backend does not persist fresh device state/readings/logs while data writes are paused, so dashboard values can become stale. Existing stored history remains accessible where provider quotas permit.
- Local logs aggregate status changes and command/calibration outcomes; routine sample blocks stay on USB Serial. Firmware buffers and backend hourly log limits can discard logs. The cloud console is not a copy of ROM bootloader output or every USB line.

Firmware `cloudflare-1.0.1` makes USB TX nonblocking and skips optional sample blocks when the host does not consume data. Cloud publication/OLED update precede optional Serial output. `NET STATUS` includes Wi-Fi status/RSSI, clock readiness, HTTP and TLS errors, attempt/success uptime, free heap and network-task stack headroom. It omits credentials. Transport connection/read timeouts are 15 seconds; TLS validation remains enabled. The 10 October physical history readback confirmed approximately two-second sampling and continued HTTPS uploads with the serial reader closed.

D1 keeps recent full-resolution samples for 30 days. Older data is archived to private compressed R2 files with checksum/readback verification before deleting the matching D1 source. See [operations](../../cloud/coop-monitor-worker/OPERATIONS.md). Included-capacity guards and billing notifications do not guarantee a provider-enforced zero-cost cap.

## Settings and remote commands

Desired settings are validated and applied atomically in the sensing task. Only configuration changes write NVS. The firmware reports applied revision/error separately from the dashboard's saved revision; invalid or older revisions do not replace accepted settings.

| Dashboard command | Completion meaning |
|---|---|
| `CAL_SHOW`, `CAL_EXPORT` | Return saved profile values to the console; also print the USB export |
| `CAL_START` | Start only after reference conditions are confirmed; complete after a valid profile is actually saved |
| `CAL_CANCEL` | Cancel calibration and retain the previous profile |
| `NET_STATUS` | Report link/upload state, pending readings and drops; no credentials |
| `NET_RECONNECT` | Retry Wi-Fi; complete when the link is re-established, which does not itself prove HTTPS ingestion |
| `CONFIG_SHOW` | Report currently applied monitoring settings/revision |
| `RESTART` | Reboot after the server acknowledges the running receipt; report completion on the new software-reset boot |
| `HELP` | Return the allowed command list |
| `SD_STATUS` | (`cloudflare-1.2.0`+) Same fields as USB `SD STATUS`, separated by `; ` |
| `SD_TAIL` | (1.2.0+) Newest complete lines on the card this boot, about 300 characters (USB `SD TAIL` shows 1 KiB as stored) |
| `SD_FLUSH` | (1.2.0+) Write and verify whole 512-byte sectors now; `failed` if no card is mounted or the write fails |
| `SD_EJECT` | (1.2.0+) Final write including the partial sector, unmount; backup paused until `SD_MOUNT` or reboot |
| `SD_MOUNT` | (1.2.0+) Remount and start a new `/coop/bNNNNN.csv`; `failed` if the card does not mount |

Command type numbers are stored in the NVS journal and are append-only. **Rollback caveat:** firmware 1.1.0 or older treats a journal entry with a type above 9 as corrupt and blocks remote commands, so after any `SD_*` dashboard command, downgrading below 1.2.0 disables dashboard commands on that build (sensing and uploads are unaffected).

**C3 flash backup note (15 November 2026):** with 1.1.0/1.2.0 installed, `esptool read-flash` with the default stub stops at 0xA0000 on the USB-Serial/JTAG port ("Packet content transfer stopped"); every other 4 KiB block reads. `--no-stub` reads the whole 4 MB (about 7 minutes). `upload_wifi_cloud.ps1` still uses the stub read and fails safe at that step.

Command receipts use a CRC-protected 12-entry NVS journal. The firmware persists acceptance and waits for the server to acknowledge it before executing. It checks expiry before starting. In-progress commands recovered after a reboot become `uncertain` and are not replayed; a confirmed software reset can complete the recorded restart command. Results retry until acknowledged. This provides replay protection with explicit uncertainty, not universal exactly-once physical execution. Corrupt/failed journal writes block remote execution and preserve the stored evidence.

Wi-Fi/device credential updates and calibration import are USB-only. No free-form shell, OTA, fan/relay action or remote factory reset is exposed.

## USB commands

| Command | Action |
|---|---|
| `I2C SCAN` | USB-only address scan, bus pins/clock, readiness and last AHT error |
| `OLED TEST` | USB-only SSD1306 border/text test for 15 seconds; requires visual confirmation |
| `CAL START`, `CAL CANCEL` | Start/cancel clean-air calibration |
| `CAL SHOW`, `CAL EXPORT`, `CAL IMPORT,...` | Inspect/back up/restore calibration |
| `CONFIG SHOW` | Applied monitoring configuration |
| `NET STATUS`, `NET RECONNECT` | Masked provisioning/link state; reconnect |
| `WIFI SSID ...`, `WIFI PASS ...`, `WIFI OPEN` | Save Wi-Fi settings |
| `CLOUD URL ...`, `CLOUD ID ...`, `CLOUD TOKEN ...` | Save the deployed endpoint, device ID and 64 lowercase hex token |
| `HELP` | List USB commands |

The endpoint is restricted to `https://coop-monitor-worker.coop-monitor-worker.workers.dev/api/device/exchange`. Device tokens are distinct from the dashboard owner key. `TEST ...` and `QUEUE ...` commands explicitly report that legacy storage is disabled and make no filesystem changes.

## Troubleshooting and acceptance

For AHT/OLED diagnosis, run `I2C SCAN` at 115200 baud with Newline. Expected addresses are AHT20 `0x38`, OLED `0x3C`/`0x3D`, and BMP280 `0x76`/`0x77`. If a device appears after an initial failed probe, the retry path can recover without rebooting. A blank replacement display with an ACK still needs `OLED TEST` and inspection of its actual printed pin labels/controller; matching a seller's module code or the old connector position is insufficient. Keep the existing GPIO4 SDA/GPIO5 SCL and 3V3 supply mapping.

Local AHT20 fault/timing and OLED transport/retry regression tests (requires `g++` on PATH):

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\firmware\coop_monitor\test_aht20.ps1"
```

| Status | Next step |
|---|---|
| `SETUP NEEDED` | Run provisioning; inspect masked `NET STATUS` |
| `WIFI OFFLINE` | Check 2.4 GHz network, SSID/password, signal and power |
| `WAITING FOR CLOCK` | Permit NTP; TLS uploads wait for valid UTC |
| `CHECK DEVICE TOKEN` | Use the device token from `dashboard.local.json`, then reconnect |
| `CLOUD RETRY` | Check internet/TLS/backend availability; pending data is only in RAM |
| `PROTOCOL ERROR` | Capture non-secret Serial status and inspect backend contract; avoid assuming retries repaired it |
| `UPLOADS PAUSED` | Inspect owner pause/capacity in the dashboard; local sensing continues |
| Configuration failed / commands blocked | Inspect error and preserve NVS/flash backup; do not erase calibration or command evidence as a routine repair |

Physical checks recorded on 10 October: erase-all-off upload, matching calibration export after reset, retained provisioning/applied revision 1, real records in history/dashboard, and continued sampling/uploads with the serial reader closed. Remaining acceptance: an independent power cycle; warm-up/warning guards and OLED observation; changed desired/applied settings; each supported command; Wi-Fi loss/reconnect, RAM overflow, owner pause and restart recovery; then a 24-hour device run and actual resource usage. Short recovery observations do not establish those longer physical results. No new device connection, build, flash or command was performed in the 22 October documentation refresh.

The old `cloud_runtime.h`, flash/session headers, SD tools and `test_wifi_cloud.ps1` remain historical support. They are not the active Cloudflare runtime or evidence of its device behavior. For those workflows use `codex/wifi-cloud`, `codex/quicktest`, or the original SD commit. Optional computer Serial capture remains manually controlled and is not required for cloud operation. See [verification](../../VERIFICATION.md) and the [firmware handoff](../../cloud/coop-monitor-worker/FIRMWARE_HANDOFF.md).
