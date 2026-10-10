# IoT Coop Monitor

ESP32-C3 poultry-coop air-quality early-warning prototype using an MQ-135 gas sensor, an AHT20/BMP280 module, and an SSD1306 OLED. The MQ-135 output is a relative gas response, not a calibrated ammonia concentration.

`main` now contains continuous Wi-Fi monitoring through the deployed Cloudflare Worker, private owner dashboard, D1 recent history and private R2 archives. Default sampling is every two seconds; the dashboard refreshes every four seconds. Monitoring settings and supported commands travel through the same authenticated device exchange.

The firmware keeps OLED readings, readable USB Serial output, saved calibration and warning guards. Measurements and logs use bounded RAM buffers: no MicroSD or persistent flash measurement queue is used. Wi-Fi loss, upload pauses and reboot can cause explicitly reported gaps. Calibration, credentials, monitoring settings and command receipts remain in NVS.

## Start here

- [Firmware build, USB cutover and provisioning](firmware/coop_monitor/README.md)
- [Current wiring and SD-free hardware](firmware/coop_monitor/WIRING.md)
- [Private dashboard and Cloudflare operations](cloud/coop-monitor-worker/README.md)
- [Implementation map and remaining acceptance](CLOUD_MIGRATION_PLAN.md)
- [Verification evidence](VERIFICATION.md)

Dashboard: [Coop Monitor](https://coop-monitor-worker.coop-monitor-worker.workers.dev/). Sign in with the owner key in the ignored `cloud/coop-monitor-worker/.credentials.local.json`. Device provisioning uses the separate ignored `firmware/coop_monitor/dashboard.local.json`; credentials are not in Git.

The Cloudflare backend was deployed and checked with synthetic fixtures on 10 October 2026. The new ESP32-C3 firmware compiles; physical flashing, provisioning, real sensor ingestion and device acceptance remain pending. A Git update does not change the firmware installed on the ESP32.

## Historical implementations

`codex/quicktest` retains the 15/30-minute offline field-session workflow and manual Google Sheets upload. `codex/wifi-cloud` retains the earlier continuous Apps Script uploader. Commit `09aff6a` retains the original MicroSD monitor. Their source and dated verification records remain available; existing Google Sheet data and Apps Script deployment were preserved.
