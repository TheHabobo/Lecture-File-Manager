# FMS Session Changelog

---

## Session - March 12, 2026

### Features

#### Share Group
- Added `share_token` column to the `Group` model (with auto-migration on startup).
- Added `POST /api/groups/<id>/share` to generate and return a unique share token.
- Added `DELETE /api/groups/<id>/share` to revoke the share link.
- Added `GET /shared/<token>` to serve a read-only public view of the group.
- Added a share button in the group view header (next to "Add Unassigned Files").
- Added a share modal with a copyable link field and a revoke link action.
- Created `templates/shared.html` as a standalone read-only page showing group content.

#### Interactive Shared Page
- Made each file card on the shared page expandable and collapsible.
- Added a "View PDF" button that embeds the PDF inline via an `<iframe>`.
- Added an "Open in New Tab" link for direct PDF access.
- Kept description and summary visible when expanded, with fallback placeholder text when empty.
- Replaced inline `onclick="fn({{ id }})"` usage with `data-*` attributes and delegated click handling.

#### Favicon
- Created `static/favicon.svg` as a blue book SVG favicon.
- Added `<link rel="icon">` to both `templates/index.html` and `templates/shared.html`.
- Added a `/favicon.ico` Flask route redirecting to the SVG for browser compatibility.

### Bug Fixes
- Fixed shared page parse errors (`Property assignment expected`, `',' expected`) caused by Jinja2 inside inline `onclick` attributes.

### Infrastructure

#### Dev Container Cleanup
- Changed `docker-compose.yml` volumes from `- .:/app` (full bind mount) to selective mounts:
  - `./app.py`, `./static`, `./templates`, `./requirements.txt` for live source updates.
  - `./uploads`, `./fms.db` for persisted runtime data.
- Result: container no longer includes repository and dev-container metadata files.

#### Docker Ignore Improvements
- Added exclusions for `README.md`, `docker-compose.yml`, `Dockerfile`, `.dockerignore`, and `fms.db`.

### Files Changed

| File | Change |
|---|---|
| `app.py` | Added `share_token`, migration, share/unshare endpoints, shared view route, and `/favicon.ico` redirect |
| `templates/index.html` | Added share button, share modal, and favicon link |
| `templates/shared.html` | Created interactive read-only shared group page |
| `static/favicon.svg` | Created blue book SVG favicon |
| `docker-compose.yml` | Switched to selective bind mounts |
| `.dockerignore` | Extended exclusion list |

---

## Session - March 14, 2026

### Features

#### Library Front Page Enhancements
- Added group-level topics checklist support to the main workflow.
- Added generation controls and preview integration, then refactored into a dedicated topics workflow.
- Updated fallback summary behavior to include "Topics Covered" context.

#### Dedicated Topics Page
- Moved topic management from group cards into a dedicated topics interface.
- Added navigation from group view to topics view with a topics action button.
- Implemented section-aware rendering with progress indicators.

#### Hierarchical Topic Generation
- Updated generation output to support hierarchy:
  - `# Over Topic`
  - Checklist items as under-topics.
- Added parser and renderer support to preserve hierarchy in the UI.
- Added sorting controls for hierarchy order and creation order.

#### Topics Editor
- Implemented editing capabilities for topics and sections:
  - Reorder via drag and drop.
  - Rename topics and sections.
  - Delete topics and sections.
  - Create new topics and new sections.
- Added drag visual feedback and improved handle placement.
- Persisted edits by saving back to group checklist data.

#### Non-Destructive Regeneration
- Reworked generation so new AI output is merged into existing checklists.
- Added backend parse/serialize/merge helpers to preserve manual edits.
- Generation now appends only newly discovered topics where possible.

#### To-Do Checklist Support
- Added `todos_checklist` persistence to groups.
- Added startup migration logic to create the missing DB column when needed.
- Extended group update API to accept both `topics_checklist` and `todos_checklist`.

#### Global Topics + To-Dos Board
- Added a Library mode switch with `Groups` and `Topics + To-Dos` modes.
- Aggregated unchecked topics and unchecked to-dos across all groups.
- Added board layout and styling for cross-group tracking.

#### Interaction Refinement
- Updated board interactions so checkbox clicks toggle completion state.
- Updated item-content clicks to open the corresponding group topics page.
- Prevented accidental completion when users intend to navigate.

### Validation
- Re-ran diagnostics after major JS, CSS, and backend edits.
- Verified `app.py` compilation with `py_compile`.
- Final state had no relevant JS, CSS, or Python diagnostics for changed files.

---

## Session - March 14, 2026 (continued)

### Features

#### Timeline View
- Added a new **Timeline** mode to the library switch bar (alongside "Groups" and "Topics + To-Dos").
- Introduced a monthly calendar grid showing tasks as colour-coded chips on their span of days.
- Each chip is coloured by its associated group (using the existing group palette). Unassigned tasks use a neutral grey.
- Month navigation arrows (← Prev / Next →) advance or retreat one month at a time.
- Added a task creation form at the top of the timeline view with:
  - Free-text title input.
  - Optional group selector.
  - Date picker for start and end dates.
  - Optional prefill from any existing to-do item across all groups (dropdown populated from all group to-do checklists).
- Calendar chips are clickable and open an inline edit prompt (title, start date, end date).
- A task list below the calendar shows all tasks that overlap the current month with Edit and Delete buttons.
- Delete confirms via the existing modal confirm dialog.
- Timeline mode state persists correctly when navigating away and returning to the Library view.
- Clicking a chip or editing a task re-fetches the task list and re-renders the calendar in place.

#### Validation & Optimisation

##### Upload Validation Hardening
- Moved group/sub-group existence checks to occur **before** writing the uploaded file to disk, eliminating the risk of orphaned files on invalid requests.
- Added an explicit `group_id` existence check on upload (previously only `subgroup_id` was validated).
- Made stored filenames collision-resistant by appending a 4-character random hex suffix alongside the existing millisecond timestamp.

##### Shared Group View Query Optimisation
- Replaced N+1 per-subgroup file queries in `shared_view` with a single bulk query, grouping results in Python before template rendering.

### Infrastructure

#### Automated Test Suite
- Created `tests/test_app.py` with a `unittest`-based `APISmokeTests` class covering:
  - `test_index_page_renders` — asserts the main page returns HTTP 200 and contains expected content.
  - `test_group_create_and_delete_roundtrip` — creates a group, verifies it appears in the list, then deletes it.
  - `test_upload_rejects_mismatched_subgroup_group` — POSTs a PDF with a subgroup belonging to a different group and asserts HTTP 400 with no file left on disk.
  - `test_timeline_task_crud_and_validation` — creates, reads, updates, tests invalid date-range rejection (HTTP 400), and deletes a timeline task.
- All tests are self-cleaning: test data is uniquely prefixed and removed in `tearDown`.
- All 4 tests pass.

#### Backend — `TimelineTask` Model
- Added `TimelineTask` SQLAlchemy model (`timeline_tasks` table) with `id`, `title`, `start_date`, `end_date`, `group_id` (FK → groups), and `created_at`.
- `db.create_all()` on startup creates the table automatically; no manual migration required.
- Added `_parse_ymd_date()` helper for safe `YYYY-MM-DD` string → `date` conversion.
- Deleting a group now also deletes its associated timeline tasks.

#### Backend — Timeline REST API
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/timeline-tasks` | List all tasks; optional `?group_id=` filter |
| POST | `/api/timeline-tasks` | Create a task (validates dates, group existence) |
| PUT | `/api/timeline-tasks/<id>` | Partial-update title, start_date, end_date, or group_id |
| DELETE | `/api/timeline-tasks/<id>` | Delete a task |

#### Dev Container
- Installed `curl` (via `apt-get`) in the dev container.
- Installed **GitHub Copilot CLI v1.0.5** to `/usr/local/bin/copilot` via the official `https://gh.io/copilot-install` script.

### Files Changed

| File | Change |
|---|---|
| `app.py` | Added `TimelineTask` model, `_parse_ymd_date` helper, timeline CRUD endpoints; hardened upload validation; optimised shared group view query; cascaded timeline-task deletion on group delete |
| `static/js/app.js` | Added `timelineTasks` state, Timeline library mode, month navigation, calendar grid renderer, task form with to-do prefill, chip click edit, task list with edit/delete actions |
| `static/css/style.css` | Added timeline shell, calendar, weekday header, day cell, chip, task-list, and responsive styles |
| `templates/index.html` | Added Timeline switch button and `#library-timeline-root` container |
| `tests/test_app.py` | Created automated smoke test suite (4 tests) |

---

## Session - March 14, 2026 (Copilot CLI audit)

### Features

#### Mock-up Audit
- Performed a repository audit for remaining mockups, placeholders, demo values, and LLM fallbacks.
- Identified placeholder/demo usages in:
  - `app.py`: AI summarization placeholder, flashcards and group topics fallback heuristics.
  - `llm.py`: default demo endpoint (`demollmleon`) used when AZURE_OPENAI_ENDPOINT is unset.
  - `.env`: placeholder environment variables and guidance comments.
  - `templates/index.html`, `static/js/app.js`: UI placeholder text and example input copy.
- Created `doc/mockup-audit.md` documenting findings and recommended actions.
- Inserted session-tracking todos into the session DB for audit and persistence.

### Files Changed

| File | Change |
|---|---|
| `doc/mockup-audit.md` | Added mock-up audit report listing placeholder locations and recommended actions |

---

## Session - March 14, 2026 (Unified Azure LLM Layer & Spec Kit docs)

### Features

#### Unified Azure LLM Layer
- Added `/app/llm.py`: unified Azure OpenAI wrapper (AzureLLM, chat, chat_completion, LLMError). Default endpoint set to `https://demollmleon.cognitiveservices.azure.com/openai/deployments/gpt-4o/chat/completions?api-version=2025-01-01-preview`; reads `AZURE_OPENAI_API_KEY` / `OPENAI_API_KEY` from environment and sends the `api-key` HTTP header.
- Centralized all LLM access through the unified layer and updated application code to call `llm.chat` / `llm.chat_completion`.

#### Summaries & Flashcards (German)
- Rewrote AI prompts for summaries, flashcards, and topic grouping to require German-only output; summaries now return topics-only lists.
- Replaced placeholder `_run_ai_summary()` with live LLM integration and added robust German-language heuristic fallbacks when the LLM is unavailable.

#### Environment & Repository
- Added an example `.env` (documented) to store API keys and endpoint configuration.
- Updated `.gitignore` to exclude `.env` and common local artifacts.

#### Documentation (Spec Kit)
- Created Spec Kit–style documentation under `/app/doc/` including: `README.md`, `constitution.md`, `spec.md`, `plan.md`, `tasks.md`, `implement.md`, `design.md`, `api.md`, `security.md`, `contributing.md`, `llm.md`, and the requested `user-stories.md`, `user-flow.md`, and `architecture.md`.

### Validation
- Executed the existing smoke test suite: `python -m tests.test_app` — 4 tests passed.
- Verified `app.py` compiles and that LLM calls are guarded with error handling and fallbacks.

### Files Changed

| File | Change |
|---|---|
| `llm.py` | Added unified Azure OpenAI wrapper (AzureLLM, chat, chat_completion, LLMError) |
| `app.py` | Integrated `llm.chat` into summary, flashcards, and topic generation functions; removed placeholder summarizer |
| `.env` | Added example env file with `AZURE_OPENAI_API_KEY` and endpoint documentation (DO NOT COMMIT) |
| `.gitignore` | Added `.env` and common local ignores |
| `doc/*` | Added Spec Kit–style documentation and user-stories/user-flow/architecture files |
| `tests/test_app.py` | Ran existing smoke tests (4 tests pass) |

---

