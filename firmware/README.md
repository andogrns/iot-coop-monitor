# Poultry-coop firmware

Source/documentation reviewed **5 November 2026 (Asia/Jakarta)**. The active monitor is [coop_monitor/coop_monitor.ino](coop_monitor/coop_monitor.ino), built for the **ESP32-C3 SuperMini** with:

- MQ-135 module and two 10 kOhm analog divider resistors;
- combined AHT20/BMP280 temperature, humidity and pressure board;
- SSD1306 128x64 I2C OLED support, currently disabled and intentionally disconnected;
- stable USB power and readable USB Serial diagnostics;
- 2.4 GHz Wi-Fi and the deployed Cloudflare Worker, D1 and private R2 archive backend.

MicroSD is unused in the active build. GPIO3 reads the divided MQ analog signal; GPIO4/GPIO5 share I2C between the combined sensor board and OLED. See the [current wiring diagram](coop_monitor/WIRING.md) and [build/provisioning guide](coop_monitor/README.md).

Measurements are buffered in RAM and may be lost during long outages or reboot. Calibration, Wi-Fi/device credentials, monitoring settings and command receipts persist in NVS. The default reading interval is two seconds; remote settings and commands are supported. There is no OTA, battery monitor, RTC, buzzer or relay output.

Current source and last recorded installed build are `cloudflare-1.0.4` (3 November upload, ESP32 core 3.3.12). Local checked AHT20/BMP280 readers run at 100 kHz with OLED disabled. Replacement sensor and closed-lid acquisition checks passed on 4 November; mq135-02 calibration and actual field uploads remain unverified. See [verification](../VERIFICATION.md) and the [field launch handoff](../docs/FIELD_RUN_2026-11-05.md). No device was accessed for this documentation refresh.

## Historical source

`codex/quicktest` retains offline 15/30-minute recording and manual Apps Script upload. `codex/wifi-cloud` retains the older continuous Apps Script uploader. Commit `09aff6a` retains the MicroSD monitor. Legacy queue/session/TLS headers and scripts in `coop_monitor` remain for reference; the active sketch includes `dashboard_runtime.h` instead.

Any older sensor-only, SHT31, SD or OLED diagnostic sketches in a local checkout are separate programs. They are not the current integrated monitor or proof of its wiring. Use the AHT20/BMP280 inventory above for current documentation.

MQ-135 output is a relative gas response. Verified ammonia concentration/selectivity requires independent reference calibration and field validation; the prototype does not report validated ammonia ppm.
