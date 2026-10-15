# Codex context import: provenance and boundaries

## Scope

On **11 October 2026**, the user authorized inspection of local Codex memories and project-related history, with unrelated conversations and credentials excluded and original Codex data left unchanged.

The deliverables are root `AGENTS.md` and `PROJECT_CONTEXT.md`, plus this provenance record. They are a curated shared handoff, not a wholesale transcript copy or an import into Hermes's conversation database. No connected account was queried.

## Sources and selection

Local Codex home resolved to `C:/Users/Ando/.codex`. Source discovery used file metadata and a read-only SQLite connection to `state_5.sqlite`. Conversation selection matched the project's working directory, including Codex's Windows extended-path prefix `\\?\`. Automated `Guardian review` threads were excluded from conversation-content review.

| Source | Scope / outcome |
|---|---|
| `memories/MEMORY.md` | Selected 14 project-related task groups, including linked proposal/CAD work saved under other working directories |
| `memories/rollout_summaries/` | Located 32 summary files referenced by those selected groups; their names/checksums form the local audit manifest, not a claim that every summary was independently reviewed |
| `state_5.sqlite` project metadata | 84 project-directory records, including automated review records; 37 non-Guardian records |
| Available project conversations | 15 non-Guardian transcripts available and inspected selectively for user requests and recent final answers |
| Older project conversations | 22 non-Guardian records had missing transcript files; filename-only searches by thread ID found no replacement in local session/archive directories |
| Codex global `AGENTS.md` | Empty; no additional working instructions to carry over |
| Current repository | README/guides, firmware constants and active entry point, Worker retention/cron configuration, existing diff, tests, and local CAD/printing-guide artifacts |

Only project-related sections were extracted from the mixed-project memory file. Sanitized extracts stayed in Hermes scratch storage. Raw credential files, tool outputs, authentication/configuration stores, and unrelated conversation bodies were not imported. Assistant final answers were treated as historical claims rather than instructions or current verification. Automated continuation instructions were excluded from the handoff.

## Key source locators

These filenames refer to local Codex summaries under `memories/rollout_summaries/`; they are evidence locators, not public resources:

- `2026-10-08T09-13-21-W74F-cloudflare_worker_deploy_device_verification_capacity_foreca.md`: cloud setup, physical ingestion, capacity observations.
- `2026-10-10T09-14-50-bO0a-enrichment2_dashboard_calibration_console_styling.md`: calibration references, latest-100 history, reverse numbering, scoped log styling.
- `2026-10-10T14-15-55-IziY-seven_day_archive_retention_study_plan.md`: four-week study and seven-day retention discussion; no edits authorized in that conversation.
- `2026-10-10T09-49-32-tRrY-firmware_github_main_cross_check_partial.md`: local firmware/ref inspection and failed live GitHub verification.
- `2026-10-06T06-27-07-JHc6-v5_measurements_google_sheet_and_v5a_enclosure_package.md`: separate V5a variant, preserved V5, artifact-vs-physical verification boundary.
- `2026-10-08T11-13-42-xZIm-v5_compact_enclosure_fit_plan.md`: separate 2D compact concept, not the V5a model.
- `2026-09-23T00-39-27-MyFq-esp32_monitor_aht20_bmp280_oled_manual_logging.md`: manual capture requirement and historical hardware/logging work.
- `2026-09-25T12-37-13-pTE7-poultry_early_warning_proposal_draft.md`: proposal format and conservative sensing claims.
- `2026-10-05T05-57-11-gjvj-compare_proposal_docx_revisions.md`: Research Question 2 correlation revision and exact-diff workflow.

Relevant available conversation IDs for later targeted lookup:

| Topic | Codex thread ID |
|---|---|
| Cloud deployment / physical connection repair | `01a11ac9-e3af-7710-a9aa-2ddadec5862d` |
| Dashboard/history/console changes | `01a12517-f83f-7080-8927-ecb6f5e4c8ea` |
| Archive retention / four-week study | `01a1262b-a0ba-7042-b205-48925d1c5354` |
| Separate V5a optimization | `01a10fe4-fcbc-7d43-bdda-ecb4884867d2` |
| V5a printing-shop / STL inspection questions | `01a126aa-04b6-7290-8b76-c8dd62234bb9` |
| Proposal wording diff | `01a10aa3-3921-7043-8b7c-4f79074714e1` |

Do not assume thread titles contain all requests or that the newest rollout path preserves the whole original conversation. Resumed/compacted transcripts can be incomplete; consult the selected memory groups and actual repository evidence together.

## Reconciliation rules

- Current local source/configuration wins over obsolete historical implementation descriptions.
- SD, SHT31, offline QuickTest and Apps Script details were retained only as history, not revived as active requirements.
- Seven-day retention is an unapproved discussion; local `RETENTION_DAYS` remains 30.
- Physical upload/ingestion observations are dated October 10, not today's availability.
- Prior decisions, permissions, suggested titles, deadlines, and estimates are not fresh authorization or guarantees.
- CAD/software tests are not physical fit/durability results.
- Missing historical transcripts were not reconstructed or fabricated. Existing memory summaries support only the claims they actually record.

## Checks performed during this handoff

- The existing backend history suite passed **6/6** using Node **24.19.0** and actual in-memory SQLite; no production fixture was written.
- Source hashes of the inspected Codex memory file, referenced summaries, and extracted transcripts were checked after inspection. The memory file and summaries remained unchanged. One rollout file changed while Codex was still active; its sanitized extract was refreshed and the user-request/final-answer counts remained unchanged. No writes to original Codex files were performed by this migration.
- Existing repository files were snapshotted before handoff writes, so preservation can be checked independently of an already-dirty Git checkout.
- Handoff links, document bounds, whitespace, and obvious credential-value patterns were checked locally.
- The installed Hermes `build_context_files_prompt` loader discovered root `AGENTS.md`, retained its `PROJECT_CONTEXT.md` read instruction, and passed the context security scan without truncation. The existing backend/dashboard JavaScript syntax checks and Git whitespace check also passed.

The detailed machine-local audit manifest and sanitized extracts are under Hermes scratch storage (`codex-enrichment2-handoff`). Scratch is temporary and is not required for future project sessions; these three repository documents are the durable result. This record intentionally avoids exporting raw conversations or personal data to a Git repository.

## Continuing across agents

Start future sessions in this repository and read `AGENTS.md` / `PROJECT_CONTEXT.md`. Keep them updated after material decisions. Codex and Hermes retain their own private memories and histories; there is no automatic ongoing synchronization configured by this import. If older history is needed later, perform a targeted, permission-scoped lookup instead of bulk-loading the account's conversations.
