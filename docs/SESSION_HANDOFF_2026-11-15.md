# Session handoff: 15 November 2026 (dashboard archives + UX redesign)

Written for the next agent. Read `AGENTS.md` and `PROJECT_CONTEXT.md` first; this file adds the detail of one session. It is a dated snapshot: check the actual files and Git status before acting.

## State in one paragraph

Two things happened. (1) Automatic archive folders are now grouped **per UTC day** instead of per hour; this is **deployed** (Worker version `da2869c5-b6aa-454a-ae16-c9e2ca4bdc4d`). (2) The whole dashboard UI in `cloud/coop-monitor-worker/public/` was **redesigned locally and is NOT deployed**; the user has been shown screenshots and a local preview and has not yet given feedback or deploy authorization. Nothing from this session is committed to Git.

## Waiting on the user

1. Feedback on the redesign (they said they were "not a big fan of the UX" of the old site; no specific complaints were given, so the design direction was the agent's).
2. A deploy decision. **Do not deploy without fresh authorization in the new session.** The earlier "yes deploy it" covered only the archive grouping change.

## 1. Archive folders per day (deployed)

- Change: `cloud/coop-monitor-worker/src/archive-folders.js` groups automatic manifests by UTC day (`auto:YYYY-MM-DDT00:00:00.000Z`, label `Automatic archive YYYY-MM-DD (UTC)`). Old hourly `auto:` IDs return 400. R2 objects, manifests, the 15-minute archiving job and 30-day retention are unchanged. No migration.
- Why: the user asked why there were "so many automatic archives" (one folder per hour, about 24 a day).
- Evidence: `DEPLOYMENT.md` (third rollout, 15 November), root `VERIFICATION.md`. After deploy: `/health` 200, anonymous archive routes 401, read-only D1 count showed 71 automatic files in 24 hourly groups, now 6 daily folders. The authenticated Archives tab on production was not opened by the agent.
- Side effect to expect: Week 1 readings (16–23 October) pass the 30-day cutoff over the following days and add about 8 day folders.

## 2. Dashboard UX redesign (local only)

### How it was built

Lead review, then four Opus subagents: stage 1 (design system, shell, Overview), then three in parallel (History; Console + Settings; Archives), then a lead review pass with fixes. All subagents have finished; none is running.

### Files (all under `cloud/coop-monitor-worker/`)

| File | Status | Role |
|---|---|---|
| `public/style.css` | rewritten | Design system; **cheat sheet of tokens and classes in its header comment** |
| `public/format.js` | new | Single date format (DD/MM/YYYY), `relativeTime`, `formatNumber`, `formatBytes`, `describeStatus` (firmware status tokens to plain language), `niceTicks` |
| `public/ui.js` | new | `notice` toasts, `confirmDialog`, `banner`, `emptyState`, `badge`, `el`, `setRelativeTime` |
| `public/console.js` | new | Console and Settings tab logic (`createConsoleTab`, `createSettingsTab`) |
| `public/history.css`, `console.css`, `archives.css` | new | Per-tab styles (kept separate; merging into `style.css` is optional) |
| `public/index.html`, `app.js` | rewritten | Shell, hash routing, Overview, History; `app.js` has section headers per tab |
| `public/trends.js` | drawing changed | Data/model code and tested exports unchanged |
| `public/history-selection.js`, `history-export.js`, `archive-library.js`, `manual-archive.js` | changed | Wording, hooks (`onCount`, `setGuard`), new archive library UI, confirm before archiving |
| `scripts/format.test.mjs` | new | 7 tests |
| `scripts/version-assets.mjs` | new | Rewrites `?v=` content hashes in dependency order |
| `scripts/history-*.test.mjs` | changed | Wording updates plus 2 new tests |

Not touched by the redesign: `src/`, `migrations/`, `wrangler.jsonc`, `firmware/`, `archive-zip.js`, `csv.js`.

### What changed for the user

- **Shell:** compact header; tabs in the URL hash; device status (connection, plain condition, "last reading N s ago") on every tab; red banner on a live gas warning; banner when uploads are paused; toasts instead of the permanent notice line; loading state before sign-in.
- **Overview:** gas tile with gauge against the warning threshold; chart threshold line, shaded warning periods, hover tooltip, non-repeating axis ticks; health verdict; storage bars; confirm before pausing uploads.
- **History:** one control bar (Latest / Last hour / Last 24 h / Last 7 days / Custom range, order, rows per page); one summary line; export button states what it exports; scrollable table with status badges and tinted warning rows.
- **Console:** described command cards grouped Check / Calibration / Disruptive; in-page confirm dialogs; command history with status badges; logs with filter and auto-scroll.
- **Settings:** plain sync status; manual threshold only in Manual mode with inline validation; unsaved-changes state and Discard.
- **Archives:** library first; All / Manual / Automatic filter; type badges; Continue archiving visible on interrupted jobs; checksum behind a toggle; create form secondary, starts with a blank range, asks for confirmation.

### Rules that were kept (keep them)

- MQ-135 is relative gas response, never ammonia ppm. Scope note stays visible.
- `#logs` stays black with white monospace text. Calibration panels stay read-only.
- CSP is `style-src 'self'; script-src 'self'`: no inline `style=` attributes, no `<style>`, no inline scripts, no external resources, no `innerHTML` with data.
- API payloads, desired-versus-applied settings semantics, command TTL 60 s, CAL_START checkbox, confirmation before RESTART / NET_RECONNECT, export and archive verification logic are unchanged.

### Verification done

- `node --test scripts/*.test.mjs`: **122/122 pass**. `node --check` passes on every file in `public/`.
- Local synthetic preview at 1280 px: all five tabs, no page errors, each module loaded once. Also viewed at 390 px (no horizontal page scroll), in dark mode, and in the live gas-warning state.
- Subagents reported checking, in the same preview: command queue and confirm flows, settings save round-trip, CSV export start, ZIP downloads, archive creation.

### Not verified

- The deployed Worker with real data and the real device.
- Safari, Firefox, a real phone (only the built-in preview browser was used).
- Wrong-key sign-in error (the preview accepts any key).
- States with no devices at all or exactly one device (the fixture always has two).
- Cancelling a ZIP download by switching device mid-download.

### Known limitations and loose ends

- Archives "Manual" filter only covers folders loaded so far (50 per page); a full filter would need an API parameter.
- After an archive job finishes, its "complete" message stays at the top of the library until device change or sign-out.
- A queued command is shown as Expired by the UI once `expires_at` passes, because the backend only marks it during scheduled maintenance.
- In Automatic mode a valid manual threshold value is still sent (so it is remembered); payload shape unchanged.
- Chart tooltip says "(estimated)" while History uses an "est." marker; wording not unified.
- `API.md`, `README.md`, `OPERATIONS.md` in the Worker folder were not updated for the new UI (the API did not change).

## How to run things

Node is not on PATH on this machine. Use the bundled runtime (Git Bash path):

```
N="/c/Users/Ando/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe"
cd "cloud/coop-monitor-worker"
"$N" --test scripts/*.test.mjs          # expect 122 pass
"$N" scripts/version-assets.mjs         # after ANY change in public/, and before a deploy
"$N" .local/ux-review/preview.mjs       # local preview on http://127.0.0.1:8793
```

- The preview is git-ignored, uses an in-memory database and a simulated device through the real Worker routes, and has no production access. Fixture switches (`/fixture/gas-on`, `gas-off`, `offline`, `online`, `sensor-error-on`, `sensor-error-off`, `signed-out`, `signed-in`) are documented in the file header. The server started in this session will have stopped; start it again when needed.
- Screenshots of the final state: `cloud/coop-monitor-worker/.local/ux-review/screenshots/` (git-ignored).

## If the user authorizes a deploy

1. Run the tests and `version-assets.mjs` (it should report 0 files changed if nothing was edited since).
2. Confirm the live version is still `da2869c5` (`cf.ps1 deployments list`) so nothing else is overwritten. Other uncommitted `src/` edits in the tree were already live as of this session.
3. Deploy with `powershell.exe -NoProfile -File "./cf.ps1" deploy` from `cloud/coop-monitor-worker`.
4. Read back: `/health` 200; live asset hashes match local for `index.html`, `app.js`, `style.css` and the new files; anonymous API routes still 401. Ask the user to reload and confirm the dashboard, since the agent does not sign in.
5. Record the rollout in `DEPLOYMENT.md`, `VERIFICATION.md` and `PROJECT_CONTEXT.md`.

Rollback if needed: redeploy the previous version from the Cloudflare dashboard or `wrangler rollback` (requires authorization); the old UI files exist only in Git history (`HEAD` plus the earlier uncommitted edits are not recoverable from Git, so do not discard the working tree).

## Git

Branch `main`. Nothing from this session is committed; the tree also holds substantial earlier uncommitted work. Do not stage everything, commit, push or switch branches unless asked. Use `git -c safe.directory="C:/Users/Ando/Documents/Ando/bleh/Enrichment 2" status --short` if Git reports dubious ownership.

## Other open project items (unchanged this session)

See `PROJECT_CONTEXT.md`: C3 rewiring check after the bare-board test, SD backup physical test, Discord bot invitation, and the enclosure and analysis items.
