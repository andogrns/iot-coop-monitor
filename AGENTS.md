# Coop Monitor: shared agent instructions

## Start each project session

Read [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md) before planning or editing. It contains the current implementation, decisions recovered from Codex, open work, and links to evidence. Read [docs/CODEX_CONTEXT_IMPORT.md](docs/CODEX_CONTEXT_IMPORT.md) when investigating provenance or missing historical context.

Check the actual Git branch/status and relevant source files. The handoff is a dated snapshot, not live device, deployment, deadline, or remote-branch evidence. Preserve pre-existing edits and untracked files; do not stage everything, commit, push, or switch branches unless requested.

## Project boundaries

- Active application: `firmware/coop_monitor/coop_monitor.ino`, `dashboard_protocol.h`, `dashboard_runtime.h`, and `cloud/coop-monitor-worker/`.
- MQ-135 measures relative gas response, not calibrated ammonia ppm. Preserve this distinction in code, UI, reports, and research documents.
- Current hardware is ESP32-C3 SuperMini, MQ-135, combined AHT20/BMP280, and SSD1306 OLED. SHT31, SD logging, Apps Script, and QuickTest sessions are historical, not active requirements.
- Preserve calibration/NVS formats, existing partitions, TLS verification, warning guards, acknowledgement/retry semantics, and desired-versus-applied configuration state unless explicitly changing them.

## Working preferences and approval boundaries

- For an implementation request, make and verify the scoped change. If the user requests a plan, explanation, analysis only, or says not to edit yet, stop before editing.
- Previous authorizations in imported history are not permission for new deployments, cloud writes, device commands, flashing, calibration, account access, or Git publication. Establish current authorization for those operations.
- Do not install scheduled or always-on computer Serial capture. Optional capture must remain explicitly user-started/stopped; routine monitoring does not require it.
- Explain hardware diagnostics using the actual Serial evidence and state what each test proves before selecting the next change. COM5 is a historical port, not guaranteed current; only one process can own a Serial port.
- Keep visual fixes local to the requested element. Firmware log output is black with white monospace text; its surrounding card retains its original styling.
- For enclosure revisions, present a 2D layout for approval before creating/replacing 3D geometry. Preserve earlier variants; the rear must remain flat and closed. Editable Blender source must not accidentally export preview components as printable parts.
- For proposal changes, match the provided format, preserve unrelated content, and show exact wording diffs when requested. Recheck the five-year literature cutoff at the time of research.
- A requested Drive/native-Sheet deliverable is not satisfied by a local XLSX. Confirm current account authorization and destination, then read back the exact uploaded target.

## Safety and verification

Keep credential values, provisioning files, flash backups, raw chat exports, and private capture data out of checked-in handoffs and public output. Do not read credential files or connected accounts merely to refresh context. A full flash backup may contain secrets.

Before an authorized firmware upload, follow `firmware/coop_monitor/README.md` and the upload helper: preserve/export calibration and existing readings as applicable, back up full flash, retain the partition layout, and keep erase-all disabled. Do not format the legacy filesystem as a routine fix.

Distinguish source inspection, host tests, embedded compilation, synthetic backend checks, live deployment readback, physical-device checks, and extended field acceptance. A pass at one layer does not establish another. Historical evidence is not current uptime or remote GitHub state.

## Local commands

Run from the repository root unless stated otherwise:

- Backend history tests: `node --test cloud/coop-monitor-worker/scripts/history.test.mjs` (requires Node with `node:sqlite`; last checked with Node 24).
- JavaScript checks: `node --check cloud/coop-monitor-worker/src/storage.js` and `node --check cloud/coop-monitor-worker/public/app.js`.
- Firmware compilation only: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "./firmware/coop_monitor/build_wifi_cloud.ps1"`.
- Cloudflare wrapper: `powershell.exe -NoProfile -File "./cloud/coop-monitor-worker/cf.ps1" --version`. This is not deployment authorization.

If Node is absent from PATH, `cf.ps1` already documents/detects the Codex bundled runtime fallback. Verify executable paths on this machine rather than assuming another agent's runtime is installed.

If Git reports dubious ownership for this checkout, use a command-scoped exception: `git -c safe.directory="C:/Users/Ando/Documents/Ando/bleh/Enrichment 2" status --short`. Do not change global trust settings just to inspect the project.

## Maintain continuity

After material work, update `PROJECT_CONTEXT.md` for decisions/open tasks and `VERIFICATION.md` for dated evidence as appropriate. Label proposals separately from approved/implemented behavior. Keep this file concise; do not paste transcripts or transient progress into it. Repository context works across agents; their private memories and chat stores are not automatically synchronized.
