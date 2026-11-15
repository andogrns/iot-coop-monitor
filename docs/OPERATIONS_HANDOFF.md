# Coop Monitor operations handoff

Prepared **5 November 2026 (Asia/Jakarta)** for the person operating the prototype and preserving study data. Read [project context](../PROJECT_CONTEXT.md) for dated status and [stack architecture](STACK_ARCHITECTURE.md) for how data moves. Development and acceptance ownership are in the [project handoff](PROJECT_HANDOFF.md).

## What the operator receives

| Item | Known setup / boundary |
|---|---|
| Monitor | ESP32-C3 SuperMini, MQ-135, replacement AHT20/BMP280; OLED disabled/disconnected; stable USB power and 2.4 GHz Wi-Fi |
| Dashboard | [Coop Monitor](https://coop-monitor-worker.coop-monitor-worker.workers.dev/), private owner sign-in |
| Device identity | `coop-monitor-01`; configured HTTPS protocol-1 exchange at the same origin |
| Cloud resources | Worker `coop-monitor-worker`, D1 `coop-monitor-db`, private R2 `coop-monitor-archives`; existing resources are reused |
| Data | Searchable D1 retention setting 30 days; private gzip archives; no automatic archive deletion configured |
| Firmware source | `cloudflare-1.0.4`; installed version must be checked during the next authorized device session |

Latest recorded deployment is 1 November, multipart CSV export. Last recorded device state on 4 November was five-second sampling, revision 4, mq135-02 calibration missing; default source interval remains two seconds. Replacement-sensor and closed-lid tests each passed short acquisition checks; Wi-Fi was intentionally off and OLED disconnected. Follow the [field launch handoff](FIELD_RUN_2026-11-05.md) for the planned seven-day run: actual installation/start and fresh persisted uploads are not recorded. Today's device/cloud state was not checked. A populated screen or `/health` response does not prove current uploads.

**MQ-135 reports relative gas response.** A warning is a prototype indication, not a validated ammonia concentration or a substitute for independent environmental measurements.

## Private access transfer

The project owner should assign an incoming operator and transfer required access privately. Do not paste secrets into this document or a public issue. These are file roles, not contents read for this refresh:

| Private material | Purpose / transfer rule |
|---|---|
| `cloud/coop-monitor-worker/.credentials.local.json` | Owner key, device token and session secret; owner access only |
| `cloud/coop-monitor-worker/.secrets.production.json` | Worker owner/session secrets; deployment administrator only |
| `cloud/coop-monitor-worker/.dev.vars` | Local development secrets; not a production backup |
| `firmware/coop_monitor/dashboard.local.json` | Device ID, exact endpoint and device token for USB provisioning; contains no owner session secret |
| Calibration export | Preserve the accepted profile for the same sensor/divider setup |
| Full-flash and D1 backups | Private; may contain credentials/token hashes, command and measurement data |
| R2 exports and manifests | Keep raw gzip bytes, object keys, hashes and catalog metadata together |

Owner sign-in uses the owner key, then an eight-hour browser cookie. Device credentials cannot open owner APIs. Credential rotation must be coordinated: changing an owner key alone does not revoke existing cookies; device token changes must match D1 and firmware. Follow [cloud operations](../cloud/coop-monitor-worker/OPERATIONS.md) when authorized.

## Routine observation

1. Check safe/stable power and dashboard status; use temporary authorized USB diagnostics if needed. OLED is disabled and intentionally disconnected; do not require it for preliminary logging. Note warm-up, calibration or sensor errors. A new boot has a ten-minute warning warm-up. Routine operation does not need a computer or Serial reader.
2. With authorized owner access, check the selected device, last exchange/sample timestamps, boot/uptime, stale indicator, firmware, desired/applied settings, calibration and upload pause/capacity reasons. Record when the check was made and the actual reported times.
3. Confirm new History entries arrive at the **applied** interval. A four-second screen refresh is not the sensor interval; snapshots can update faster than readings. Backend stale status uses exchange/state age, not just sample age.
4. Watch drop counts, boot changes and gaps. A reset loses pending RAM and resets per-boot counters; zero drops on a new boot does not prove no prior loss.
5. Review archive progress and preserve independent data copies at the project's agreed intervals. The planned field run calls for daily exports and coverage checks; no automatic computer capture is installed.

Calibration panels are read-only. Do not start calibration during ordinary observation; known reference conditions and authorization are required. Avoid repeated remote commands to an offline device: commands cannot arrive until exchange resumes, and queued commands can expire.

## Reading the dashboard

- **Overview:** last reported values, status, calibration and capacity. Trends cover 1h/6h/12h/24h and query recent D1 data. Empty windows can be valid when all readings are older. **Refresh trend** reloads the full window to include older late arrivals.
- **History:** default 100 newest entries; page sizes 50/100/250/500/1000 and both orders. Dates are DD/MM/YYYY; picker/time display follows the browser timezone. The selected-range total covers the inclusive range, independently of loaded rows. Submit the range to change the table.
- **Console:** bounded firmware events and command outcomes, approximately 24-hour log retention plus pruning lag. It is not a full USB or boot-ROM transcript. A network reconnect result proves link recovery only; check actual HTTPS ingestion separately.
- **Settings:** a saved desired revision must match an applied revision/error report before calling the change successful. Manual MQ thresholds use divided ADC mV, not module volts, multipliers or ppm.
- **Archives:** manual IDs appear as folders; duplicate labels remain separate. Automatic chunks group by hour. Download all follows every file page; Download selected uses checked files. ZIPs retain original `.json.gz` bytes after SHA-256 verification. Large downloads consume browser memory; use smaller selections if needed.

Creating a manual archive is a cloud write that moves selected readings out of normal History after verified storage. Confirm the intended device, inclusive range and label before an authorized archive action. Keep the page open until complete or resume with **Continue archiving**. A saved selection count can change as new data arrives/archival runs; use the actual final job count. Normal History/export does not include already archived readings.

## Incident triage

Observe and preserve evidence first. Changes below require the appropriate device/cloud authorization; this document does not execute them.

| Symptom | Evidence to collect / next step |
|---|---|
| Stale/offline dashboard | Record last exchange and sample time, boot/uptime, pause reason and any available local diagnostics. Bench Wi-Fi was intentionally off on 4 November; respect that distinction before intervention. Check power, 2.4 GHz Wi-Fi/internet; verify fresh History on recovery |
| `SETUP NEEDED` / token error | Inspect masked `NET STATUS` during an authorized USB session; use the existing private provisioning file/helper. Do not share the token |
| `WAITING FOR CLOCK` | Confirm network permits NTP; TLS waits for valid UTC. Do not disable TLS verification |
| `CLOUD RETRY` | Collect HTTP/TLS status and attempt/success uptime; check connectivity/backend availability. Pending readings are RAM-only |
| `PROTOCOL ERROR` / HTTP 400 or 409 | Preserve status/error and identities without secrets; escalate to the developer. Clock/identity conflicts need diagnosis; endless retries are not proof of recovery |
| `UPLOADS PAUSED` | Check owner pause versus capacity/stale-capacity reason. Local sensing continues; backend state can become stale. Resume only after the cause is understood; provider quotas may also block control traffic |
| Desired/applied mismatch | Record both revisions and application error, check connectivity, then diagnose validation/NVS. Saving the form again does not prove application |
| Command `uncertain` or blocked journal | Preserve receipt/NVS/flash evidence; inspect actual physical outcome before any new action. Do not erase or automatically replay |
| Missing History | Check device, timezone/range/order, retained versus archived data, boot/drop counts and outage timing. Download relevant archives; do not assume missing table rows were deleted |
| Interrupted manual archive | Reopen the saved job and Continue archiving when authorized. Verify saved chunks/count; do not create duplicate jobs blindly |

For an authorized Serial session, identify the actual port, close other readers and use 115200 baud/Newline. `CAL SHOW`, `CAL EXPORT`, `CONFIG SHOW` and `NET STATUS` are documented in the [firmware guide](../firmware/coop_monitor/README.md). COM5 is only a historical example. Capture stays explicitly user-started/stopped.

## Preserve and reconstruct study data

Keep independent copies of the remaining D1 export, D1 SQL backup, all required R2 files/manifests, calibration exports and a note of sampling/configuration changes. A D1 backup alone does not contain R2 object bytes. Backups stored only in the hosting account do not cover loss of access to that account.

Follow every API cursor for complete exports. The browser CSV exporter follows sequential cursor pages and splits results into numbered parts of at most 50,000 readings each, with a header per part. Keep every part. Completed-part links remain available if automatic downloads are blocked; a later failure marks the export incomplete and retains completed parts. Retry starts the selection again. The 31-day selection limit and D1-only scope remain; archived readings require separate retrieval. Real-browser automatic multi-download acceptance is still unverified. Preserve JSON/gzip originals because CSV text is formula-escaped. Browser timezone display does not change stored UTC/uptime.

For reconstruction, verify compressed/original SHA-256 and gzip/JSON, map tuples using the archive's `sampleFields`, combine archives with remaining D1 data, check device/boot/sequence identities, compare duplicates for value conflicts and inspect timestamp/count coverage. Preserve null original `sampledAt`; `estimatedAt` is server-anchored, not original sensor UTC. Keep gaps, calibration fingerprints and settings revisions in the analysis. Archive boundary overlap is a known residual risk; do not simply add file counts and claim unique coverage.

Detailed backup/restore commands are in [OPERATIONS.md](../cloud/coop-monitor-worker/OPERATIONS.md). Exporting production data/accessing the account requires current authorization. Test a restore in a separate database before any live binding change; code rollback does not undo schema/data changes. Before authorized flashing, preserve calibration/readings and a full 4 MB backup, keep partition layout and erase-all disabled, and follow the upload helper. Do not format legacy storage.

## Capacity and transfer acceptance

Source budgets are application estimates: storage/write warnings near 80%; write pauses near 95% also consider estimated requests. A request pause can occur without an earlier warning. Missing/hour-old capacity state pauses uploads. These estimates omit some traffic/orphan bytes and are not an account-wide zero-cost cap. Verify actual provider usage/terms during authorized account review; the old pricing/limit notes are dated, not current financial assurance.

At transfer, assign the operator/developer/cloud administrator and record the following with dates and private evidence locations:

- [ ] Actual device/installed firmware, power/network and safe wiring identified.
- [ ] Owner access delivered privately; desired/applied settings and calibration recorded.
- [ ] Fresh samples/sequence coverage observed; historical observations clearly separated.
- [ ] Independent D1/R2/calibration backup locations and recovery owner agreed.
- [ ] Outstanding physical tests assigned: power cycle, warning guards, settings/commands, outage/pause/restart and extended field coverage; OLED remains deferred.
- [ ] Actual field start/end recorded, daily exports assigned, and retention decision agreed; seven-day retention remains unimplemented.
- [ ] Known audit findings and escalation path acknowledged; no unverified field-reliability claim.

These boxes are intentionally unmarked: producing documentation does not perform a physical or account handover. Add results to [VERIFICATION.md](../VERIFICATION.md) and durable decisions to [PROJECT_CONTEXT.md](../PROJECT_CONTEXT.md).
