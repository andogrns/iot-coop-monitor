# IoT Coop Monitor

ESP32-C3 poultry-coop air-quality early-warning prototype using an MQ-135 gas sensor, an AHT20/BMP280 module, and an SSD1306 OLED. The MQ-135 output is a relative gas response, not a calibrated ammonia concentration.

This is the `codex/wifi-cloud` version: a persistent internal flash queue uploads readings over 2.4 GHz Wi-Fi to a private Google Sheet. `main` retains the MicroSD version. See [firmware setup](firmware/coop_monitor/README.md), [Apps Script setup](cloud/apps-script/README.md), and [verification results](VERIFICATION.md).
