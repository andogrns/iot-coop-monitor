# Poultry-coop firmware

The active monitor is [coop_monitor/coop_monitor.ino](coop_monitor/coop_monitor.ino), built for the **ESP32-C3 SuperMini** with:

- MQ-135 module and two 10 kOhm analog divider resistors;
- combined AHT20/BMP280 temperature, humidity and pressure board;
- SSD1306 128x64 I2C OLED;
- stable USB power and readable USB Serial diagnostics;
- 2.4 GHz Wi-Fi and the deployed Cloudflare Worker, D1 and private R2 archive backend.

MicroSD is unused in the active build. GPIO3 reads the divided MQ analog signal; GPIO4/GPIO5 share I2C between the combined sensor board and OLED. See the [current wiring diagram](coop_monitor/WIRING.md) and [build/provisioning guide](coop_monitor/README.md).

Measurements are buffered in RAM and may be lost during long outages or reboot. Calibration, Wi-Fi/device credentials, monitoring settings and command receipts persist in NVS. The default reading interval is two seconds; remote settings and commands are supported. There is no OTA, battery monitor, RTC, buzzer or relay output.

Firmware `cloudflare-1.0.1` was compiled and uploaded on 10 October 2026 after calibration/full-flash backup. Retained calibration/settings and real sensor ingestion were verified, including operation with the serial reader closed. Extended device acceptance remains; see [verification](../VERIFICATION.md).

## Historical source

`codex/quicktest` retains offline 15/30-minute recording and manual Apps Script upload. `codex/wifi-cloud` retains the older continuous Apps Script uploader. Commit `09aff6a` retains the MicroSD monitor. Legacy queue/session/TLS headers and scripts in `coop_monitor` remain for reference; the active sketch includes `dashboard_runtime.h` instead.

Any older sensor-only, SHT31, SD or OLED diagnostic sketches in a local checkout are separate programs. They are not the current integrated monitor or proof of its wiring. Use the AHT20/BMP280 inventory above for current documentation.

MQ-135 output is a relative gas response. Verified ammonia concentration/selectivity requires independent reference calibration and field validation; the prototype does not report validated ammonia ppm.
