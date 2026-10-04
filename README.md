# IoT Coop Monitor

ESP32-C3 poultry-coop air-quality early-warning prototype using an MQ-135 gas sensor, an AHT20/BMP280 module, and an SSD1306 OLED. The MQ-135 output is a relative gas response, not a calibrated ammonia concentration.

This is `codex/quicktest`: calibrate at campus, arm a 15- or 30-minute offline session, power off for travel, record every two seconds at the site, then manually upload to the private Sheet's `QuickTests` tab over a 2.4 GHz hotspot. Hold BOOT for two seconds while recording to stop early. Calibration and readings survive power-off. `main` retains MicroSD logging; `codex/wifi-cloud` retains continuous cloud logging. See the [eight-step field guide and flash budget](firmware/coop_monitor/README.md), [Apps Script setup](cloud/apps-script/README.md), and [verification results](VERIFICATION.md).
