# ESP32-C3 monitor with Cloudflare

Updated 10 October 2026. This is the active `main` implementation. It continuously reads MQ-135, AHT20/BMP280 and OLED, and exchanges readings, settings, logs and command results with the deployed private dashboard.

The source compiles for the ESP32-C3 SuperMini. This update has **not** been flashed to the physical device. Follow the USB cutover below before expecting real readings in Cloudflare. A Git branch change does not change installed firmware.

MQ-135 values are relative gas response, not validated ammonia ppm. Default sensing is every **2 seconds**, with a **10-minute cold-boot warm-up**. Calibration, warm-up, invalid sensors and ADC-high status suppress gas warnings even with a manual threshold.

## Hardware

Use the ESP32-C3 SuperMini, MQ-135 module, two 10 kOhm divider resistors, AHT20/BMP280 combined module and SSD1306 128x64 I2C OLED. See the [pin table and wiring diagram](WIRING.md).

- MQ heater: stable 5 V / VBUS; all grounds shared.
- MQ AO: 10 kOhm to GPIO3; another 10 kOhm from GPIO3 to GND. Never connect a possible 5 V AO directly to the ESP32.
- I2C: GPIO4 SDA, GPIO5 SCL; combo module and OLED powered from 3V3.
- MicroSD is unused. Remove only the SD adapter connections if it remains attached.
- BOOT/GPIO9 has its normal bootloader role. It no longer stops a field session. Holding it during reset can enter download mode.

## Build without uploading

Install Arduino IDE, **ESP32 by Espressif Systems**, Adafruit AHTX0, BMP280, SSD1306, GFX, BusIO and Unified Sensor. `Wire`, `Preferences`, Wi-Fi, TLS, HTTP and cJSON come with the ESP32 core. The checked build used core **3.3.11**.

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
5. Reopen Serial Monitor. Expect `CLOUD CONNECTED` after Wi-Fi and NTP time synchronization. Confirm `CONFIG SHOW` reaches desired revision 1 or the dashboard's current revision. Open [Coop Monitor](https://coop-monitor-worker.coop-monitor-worker.workers.dev/) using the separate owner key, and confirm actual sensor readings, device uptime and firmware version `cloudflare-1.0.0`.

The backend has already registered **`coop-monitor-01`**. You do not need another D1 database, R2 bucket or device registration. The local provisioning file contains protocol version 1, that ID, the exact exchange endpoint and its device token. `dashboard.example.json` is a safe template for another authorized provisioning setup. Legacy `cloud.local.json` has a different format/token and is not used by the current helper.

## Calibration and warnings

A new MQ-135 requires initial conditioning; use the established more-than-48-hour procedure before short clean-air calibration. Keep the sensor in known representative clean air away from exhaust, smoke, alcohol and cleaners. Send `CAL START` and allow **10 minutes stabilization plus 5 minutes collection**. Wait for `@CAL,SAVED`, then save `CAL EXPORT`. Failed or cancelled calibration retains the previous accepted profile.

Calibration always samples every 2 seconds during its collection workflow, temporarily overriding a slower dashboard interval. After calibration the selected interval resumes. At least 60 valid samples are required. Calibration starts only with the AHT sensor available, and warnings are suppressed during calibration.

The automatic threshold is the greater of baseline + 3 standard deviations or a 15% baseline increase. Dashboard manual thresholds are **10–2399 mV at the divided ESP32 ADC**, not MQ module volts or ppm. Warning confirmation is 1–10 consecutive samples; default 3. Normal sampling is 2–60 seconds. Changing settings resets the warning streak. A manual value below baseline is logged as a warning. ADC values at or above **2400 mV** produce the ADC-high guard.

Accepted calibration remains in the unchanged `coopcal` namespace with the existing 32-byte profile format. For the same MQ module, GPIO and divider, restore a saved `@CAL,DATA,...` line by replacing `@CAL,DATA,` with `CAL IMPORT,` and sending the remaining fields unchanged. Import is USB-only. `calibrationRevision` is a CRC32 fingerprint of the accepted profile, not an increasing counter; missing calibration uses 0. A fingerprint supports history interpretation and is not a security signature.

## Cloud behavior and data loss

- HTTPS POSTs use certificate/hostname validation, a separate device bearer token and protocol version 1. No redirects or insecure TLS fallback are enabled.
- Cloud exchange runs in a separate task, normally every 2 seconds even when sampling is slower. HTTPS delays do not run in the sensing loop.
- **64 readings and 16 logs** are buffered in RAM. Each exchange sends up to **12 readings, 6 logs and 5 command results**, within the backend's minute-window limits. Only matching acknowledged IDs or explicit permanent rejections remove sent records.
- A boot gets a random ID. Sample uptime is 64-bit monotonic time; sequence IDs and payloads remain unchanged on retry. Original unknown UTC stays `null`, even after NTP becomes available. The backend provides a separately identified estimated timestamp.
- Failures retry with backoff and jitter up to about 60 seconds. HTTP 401 blocks uploads until credentials are corrected or reconnect is requested. HTTP 400/409 shows `PROTOCOL ERROR` and requires diagnosis; repeated retries are not proof of recovery.
- At 2-second sampling the buffer holds roughly **128 seconds**. When full, it drops oldest readings and increments the per-boot drop count. A power loss/restart discards pending RAM data and resets these counters. There is no flash measurement recovery or offline field-session recorder in this build.
- Owner/capacity upload pauses leave local sensing and warnings running. Exchanges usually slow to 60 seconds; pending command receipts temporarily use 2 seconds so commands can acknowledge/complete. The deployed backend does not persist fresh device state/readings/logs while data writes are paused, so dashboard values can become stale. Existing stored history remains accessible where provider quotas permit.
- Local logs aggregate status changes and command/calibration outcomes; routine sample blocks stay on USB Serial. Firmware buffers and backend hourly log limits can discard logs. The cloud console is not a copy of ROM bootloader output or every USB line.

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

Command receipts use a CRC-protected 12-entry NVS journal. The firmware persists acceptance and waits for the server to acknowledge it before executing. It checks expiry before starting. In-progress commands recovered after a reboot become `uncertain` and are not replayed; a confirmed software reset can complete the recorded restart command. Results retry until acknowledged. This provides replay protection with explicit uncertainty, not universal exactly-once physical execution. Corrupt/failed journal writes block remote execution and preserve the stored evidence.

Wi-Fi/device credential updates and calibration import are USB-only. No free-form shell, OTA, fan/relay action or remote factory reset is exposed.

## USB commands

| Command | Action |
|---|---|
| `CAL START`, `CAL CANCEL` | Start/cancel clean-air calibration |
| `CAL SHOW`, `CAL EXPORT`, `CAL IMPORT,...` | Inspect/back up/restore calibration |
| `CONFIG SHOW` | Applied monitoring configuration |
| `NET STATUS`, `NET RECONNECT` | Masked provisioning/link state; reconnect |
| `WIFI SSID ...`, `WIFI PASS ...`, `WIFI OPEN` | Save Wi-Fi settings |
| `CLOUD URL ...`, `CLOUD ID ...`, `CLOUD TOKEN ...` | Save the deployed endpoint, device ID and 64 lowercase hex token |
| `HELP` | List USB commands |

The endpoint is restricted to `https://coop-monitor-worker.coop-monitor-worker.workers.dev/api/device/exchange`. Device tokens are distinct from the dashboard owner key. `TEST ...` and `QUEUE ...` commands explicitly report that legacy storage is disabled and make no filesystem changes.

## Troubleshooting and acceptance

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

Physical acceptance remains: read back calibration/settings after upload and power cycle; observe real records and dashboard freshness; check warm-up/warning guards; change settings and inspect desired/applied revisions; exercise each supported command, Wi-Fi loss/reconnect, RAM overflow and owner pause; observe restart recovery; then collect a 24-hour device run and actual resource usage. Compilation and the earlier synthetic backend checks do not establish those physical results.

The old `cloud_runtime.h`, flash/session headers, SD tools and `test_wifi_cloud.ps1` remain historical support. They are not the active Cloudflare runtime or evidence of its device behavior. For those workflows use `codex/wifi-cloud`, `codex/quicktest`, or the original SD commit. Optional computer Serial capture remains manually controlled and is not required for cloud operation. See [verification](../../VERIFICATION.md) and the [firmware handoff](../../cloud/coop-monitor-worker/FIRMWARE_HANDOFF.md).
