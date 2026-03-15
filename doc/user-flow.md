# User Flow — Primary flows and edge cases

This document describes the main user flows using Spec Kit structure: Happy path, alternative flows, API calls mapping, preconditions, and postconditions.

Flow 1 — Upload + (optional) Summarize

- Actors: Instructor (web UI)
- Preconditions: Instructor is on the upload page, or POST client has valid multipart/form-data. The server has UPLOAD_FOLDER writable.

Happy path (API steps):
1. Client: POST /api/files/upload with form fields group_id (optional), subgroup_id (optional), and file (PDF).
2. Server: Validate extension (allowed_file), secure_filename, create stored_name, save file to /uploads.
3. Server: Create PDFFile row with stored_name, group_id/subgroup_id, sort_order; commit DB.
4. Server: Respond 201 with file object JSON.
5. Optional: Client triggers POST /api/files/<id>/summarize.
6. Server: Extract text (pypdf limited pages) and call llm.chat(system_prompt=SummarySystemPrompt, user_prompt=extracted_text...).
7. Server: Receive German Markdown topics list, save to PDFFile.summary and return {"summary": "..."}.

Alternative/error flows:
- Upload with non-PDF or empty file -> 400, do not save.
- SubGroup mismatch (subgroup.group_id != group_id) -> 400 (already implemented and tested).
- LLM failure/unconfigured key -> Endpoint returns fallback heuristic summary (German) and logs the error; 200 with fallback text.

Flow 2 — Generate Flashcards

- Actors: Instructor
- Preconditions: A PDFFile record exists (may or may not have summary).

Happy path:
1. Client: POST /api/files/<id>/generate-flashcards (optional body: original_name, description, summary).
2. Server: Compose context_text and call llm.chat with the FlashcardsSystemPrompt (German) via llm.chat(...).
3. Server: On success save PDFFile.flashcards and return {"flashcards": "...", "file": { ... }}.

Error handling:
- If llm.chat raises LLMError, server runs the heuristic flashcard generator (German) and returns that result.

Flow 3 — Browse & Download

- Actors: Student
- Steps:
  - GET /api/files or GET /api/files?group_id=X
  - Server returns list JSON
  - Student clicks file -> GET /api/files/<id>/pdf to download

Flow 4 — Group Topics Checklist

- Actors: Instructor
- Steps:
  - POST /api/groups/<id>/generate-topics
  - Server: Collect file metadata (original_name, description, summary), call llm.chat with group-level prompt (German) and merge into group.topics_checklist using _merge_topics_checklists()
  - Server returns the updated topics_checklist.

Flow 5 — Manage groups/subgroups/timeline tasks

- Actors: Admin/Instructor
- CRUD operations across /api/groups and /api/timeline-tasks. Server returns appropriate status codes (201, 200, 400, 404) and validates inputs (e.g., dates).

UX considerations
- Long-running LLM tasks should be performed asynchronously with progress indicators. The current implementation is synchronous for simplicity; plan to add background jobs.
- Error messages should be localized in German when shown to users (app currently returns English error strings; consider localization work).

Mapping to acceptance tests
- Each Happy path above maps directly to a test in tests/:
  - Upload -> test upload roundtrip
  - Summarize -> test endpoint with mocked llm.chat
  - Generate flashcards -> test with mocked llm.chat
  - Browse/download -> test GET endpoints

