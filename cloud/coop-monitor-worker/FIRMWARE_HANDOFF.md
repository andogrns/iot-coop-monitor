# ESP32 firmware connection handoff

## Provisioned connection

The backend is prepared for `coop-monitor-01`. The ignored file `../../firmware/coop_monitor/dashboard.local.json` contains the complete device ID, HTTPS endpoint and device bearer token. The active firmware and `configure_network.ps1` now consume this protocol-v1 configuration. Source compilation passed on 10 October 2026; physical USB cutover/provisioning is still pending. See the [firmware guide](../../firmware/coop_monitor/README.md).

Endpoint: `https://coop-monitor-worker.coop-monitor-worker.workers.dev/api/device/exchange`

Keep the device token in local provisioning/NVS. Do not put the owner key or session secret in firmware. Do not commit, print to Serial, or log Wi-Fi passwords/device credentials. Do not overwrite legacy `cloud.local.json`, the `coopcal` namespace, partitions or stored records during migration.

## HTTP contract

- HTTPS POST, `Content-Type: application/json`, `Authorization: Bearer <device token>`.
- Protocol version 1; maximum body 65,536 bytes; no redirects to other hosts.
- Exchange approximately every 2 seconds, even if sampling is configured slower. If `uploads.paused`, keep local sensing running and exchange every `retryAfterSec` (initially 60 seconds); temporarily use 2 seconds for pending command receipts. The current backend does not persist fresh state/readings/logs while paused, so dashboard device state may become stale.
- Generate a random boot ID on every reboot; keep it stable for that boot. The implementation uses 64-bit `esp_timer_get_time()` uptime, independent of the 32-bit `millis()` wrap. Sequence IDs are unsigned 32-bit, monotonic within a boot and never reused for different readings. The firmware stops enqueueing before sequence overflow; reboot creates a new boot ID.
- Preserve a reading's exact uptime and payload on every retry. IDs are scoped to device/boot; deduplication compares sequence IDs within their immutable uptime minute. Changing uptime or reusing IDs violates the protocol.
- Maximum 30 readings, 6 logs, 5 command results per exchange. Limit backlog to three uptime minute windows plus the current state minute. Drain backlog in successive exchanges.
- Unknown UTC and unavailable sensor measurements are JSON `null`; do not send NaN, `NA`, guessed UTC, or zero in place of missing data. UTC, when known, must agree with server-anchored uptime within 5 minutes. `estimatedAt` in history is explicitly estimated, not the original device timestamp.

Example (substitute real measurements):

```json
{
  "protocolVersion": 1,
  "deviceId": "coop-monitor-01",
  "bootId": "random-boot-id",
  "state": {
    "uptimeMs": 12000,
    "firmwareVersion": "cloudflare-1.0.0",
    "appliedConfigRevision": 1,
    "configStatus": "applied",
    "configError": "",
    "status": "WARMUP|CAL_MISSING",
    "calibrated": false,
    "warmupRemainingSec": 588,
    "droppedReadings": 0,
    "droppedLogs": 0
  },
  "readings": [{
    "seq": 6, "uptimeMs": 12000, "sampledAt": null,
    "mqRaw": 720, "mqMv": 580, "mqRatio": null, "mqThresholdMv": null,
    "ahtTemperatureC": 28.2, "humidityPct": 65.1,
    "bmpTemperatureC": 28.4, "pressureHpa": 1008.6,
    "status": "WARMUP|CAL_MISSING", "configRevision": 1, "calibrationRevision": 0
  }],
  "logs": [],
  "commandResults": []
}
```

Optional `state.calibration`: `revision`, `baselineMv`, `thresholdMv`, `sdMv`, `samples`, `temperatureC`, `humidityPct`. Firmware log entries: `seq`, `uptimeMs`, `sampledAt`, `level` (`debug/info/warn/error`), `message` (512 characters maximum). Logs are bounded to 60 new messages/hour/device; aggregate repeated faults locally.

## Response handling

Successful response contains `protocolVersion`, `serverTime`, `acked`, `rejected`, `desiredConfig`, `commands`, `uploads`, and measured `databaseUsage`.

- Remove RAM readings/logs only for matching IDs under `acked`. Matching `rejected` IDs are permanent discards (outside retention or log throttling); remove them, increment discard counters and report the gap.
- A pause acknowledges no new unwritten reading. Bound RAM; discard oldest when full and retain/report cumulative drop counts. Reboot loses RAM data. Do not create a persistent flash measurement queue.
- On timeout, 429, 5xx, or connection failure: exponential backoff with jitter, bounded to 60 seconds; retain exact IDs/payloads. On 400/409 inspect the error and repair the client; endless retries of invalid data are inappropriate. On 401 stop authenticated uploads until local credentials are corrected.
- `desiredConfig` is `{revision, settings}`. Validate all four settings, apply atomically in the sampling task, persist only on change, reset relevant warning streaks, and report `appliedConfigRevision` and `configStatus` (`pending/applied/failed`). A cloud save does not prove firmware application.
- Settings: automatic/manual MQ threshold; manual 10–2399 mV; consecutive samples 1–10; interval 2–60 s. Defaults: automatic, null manual value, 3 samples, 2 s. Keep warm-up/calibration/ADC/sensor guards in manual mode.
- Supported command types: `CAL_SHOW`, `CAL_EXPORT`, `CAL_START`, `CAL_CANCEL`, `NET_STATUS`, `NET_RECONNECT`, `CONFIG_SHOW`, `RESTART`, `HELP`. `CAL_START` requires `args.referenceConditionsConfirmed=true`.
- Before starting a command check its expiry against synchronized time. Persist acceptance metadata and wait for the server to acknowledge `accepted` before executing; persist `running` before dispatch. Then report `completed`/`failed`. Return `uncertain` after recovery when completion cannot be proved. Prevent execution of the same command ID twice across reboot. A command already started can complete after expiry. Keep terminal results available for retry until acknowledged. `RESTART` waits for the server's running acknowledgement and reports completion only on a confirmed software-reset boot.
- `commandResults`: `{id,status,message}`. Do not claim completion until the handler reports actual completion. Backend state transitions are monotonic and reject expired queued commands or terminal regression.

## Implemented firmware

The active sketch includes `dashboard_runtime.h` and `dashboard_protocol.h`. Readings/logs use 64/16-entry RAM rings, with 12 readings/6 logs/5 results per batch. A 12-entry CRC-protected NVS journal stores command receipts; monitoring settings are CRC-protected and persisted on revision changes. Calibration keeps the original `coopcal` profile format. Its reported revision is a CRC32 profile fingerprint, not a monotonic revision number.

Public ISRG Root X1/X2 and GTS roots are in `cloudflare_roots.h`; `refresh_tls_roots.mjs` refreshes the ISRG roots from official sources after fingerprint verification. NTP precedes TLS; hostname/certificate validation remains enabled. Legacy queue/session headers are retained but not included by the active sketch, and old LittleFS bytes are not mounted or formatted.

The ESP32-C3 source compilation used core 3.3.11, USB CDC enabled, no OTA, the existing 4 MB partition layout and erase-all disabled. See [root verification](../../VERIFICATION.md) for actual application/static RAM figures. No new firmware tests or physical upload were performed.

## Hardware acceptance still required

The backend probes use synthetic readings. Next perform the deliberate USB cutover and provisioning, then observe a physical session. Check preserved calibration/settings, warm-up, sensor/OLED/warning behavior, actual ESP32 TLS, Wi-Fi loss/reconnect, retries, RAM overflow, command replay prevention, desired/applied revision reporting and dashboard freshness. The new upload helper requires calibration export/chip identification and saves a full flash backup before writing; legacy pending data must first be preserved. Compilation and backend deployment do not establish physical device acceptance.
