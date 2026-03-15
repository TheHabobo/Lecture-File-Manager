# User Stories

This document follows the Spec Kit approach: every story has a short description, acceptance criteria (Given/When/Then), priority, and a clear "done" condition.

Personas
- Instructor: uploads lecture PDFs, generates AI artifacts, manages groups.
- Student: browses and downloads files, uses summaries and flashcards to study.
- Admin: manages groups/subgroups, maintains data and ordering.

Stories

US-001 — Upload PDF (Instructor)
- Description: As an Instructor I can upload a PDF to a chosen Group/SubGroup so that it is available to students.
- Acceptance (Given/When/Then): Given a valid PDF file and a group_id (optional), when the client POSTs to /api/files/upload with multipart/form-data, then the server responds 201, the file is saved under /uploads with a unique stored_name, and a PDFFile DB record is created.
- Priority: High
- Done when: Integration test that posts a small PDF gets 201, the file exists on disk, and DB row contains the stored_name.

US-002 — Generate German topic-focused summary (Instructor)
- Description: As an Instructor I can request a detailed German topical summary for an uploaded PDF.
- Acceptance: Given an uploaded PDF with extractable text, when POST /api/files/<id>/summarize is called, then the endpoint returns 200 and body {"summary": "..."} where the summary is German Markdown containing a list of topics; each topic must include 3–6 deep bullet points (aspects, typical applications, boundaries, further details).
- Priority: High
- Done when: Unit test mocking llm.chat asserts the returned string is saved to PDFFile.summary and matches the required Markdown structure.

US-003 — Generate German flashcards (Instructor)
- Description: As an Instructor I can generate flashcards in German for a PDF.
- Acceptance: Given an uploaded PDF, when POST /api/files/<id>/generate-flashcards is called, then the endpoint returns 200 and {"flashcards": "..."} where the flashcards are lines in the format `Vorderseite :: Rückseite`, in German, covering all prominent topics with at least 2 cards per topic when possible.
- Priority: High
- Done when: Unit test mocking llm.chat verifies the saved PDFFile.flashcards contains lines with '::' separators and German text.

US-004 — Browse and Download Files (Student)
- Description: As a Student I can view files for a Group and download a PDF.
- Acceptance: Given existing files, when GET /api/files or GET /api/files?group_id=X is called, then server responds 200 with JSON array of files; GET /api/files/<id>/pdf returns the PDF with application/pdf content type.
- Priority: High
- Done when: Tests cover list endpoint returns expected JSON keys and serve_pdf serves bytes with correct mimetype.

US-005 — Create / Manage Groups & SubGroups (Admin/Instructor)
- Description: As an Admin I can create, update, reorder, and delete groups and subgroups.
- Acceptance: POST /api/groups creates a group (201); PUT updates fields; DELETE removes group and unassigns or deletes related data per documented behavior.
- Priority: Medium
- Done when: Endpoints for groups pass CRUD tests and reorder endpoints adjust sort_order values.

US-006 — Generate Group Topics Checklist (Instructor)
- Description: As an Instructor I can generate a topics checklist aggregated across group files and merge it into the group's topics_checklist.
- Acceptance: Given several files with summaries, when POST /api/groups/<id>/generate-topics is called, then the server returns 200 and group.topics_checklist is updated—existing items preserved and new items appended without duplicates.
- Priority: Medium
- Done when: Test exercises merging algorithm via POST and verifies topics_checklist contains expected items and no duplicates.

US-007 — Timeline Tasks CRUD (Instructor)
- Description: Create, update, list, and delete timeline tasks with date validation.
- Acceptance: POST /api/timeline-tasks validates start_date/end_date (YYYY-MM-DD) and returns 201; invalid date ranges return 400.
- Priority: Medium
- Done when: Unit tests for create/update/validate flows succeed.

US-008 — Share Link (Instructor)
- Description: As an Instructor I can generate an external share link for a file.
- Acceptance: POST /api/files/<id>/share returns a token and stores it; GET /shared/file/<token> returns the shared view.
- Priority: Low
- Done when: Integration test creates share token and shared endpoint returns 200.

Testing guidance
- Unit tests should mock llm.chat and llm.chat_completion to produce deterministic German outputs.
- Integration tests for file upload should write to a temporary uploads folder and clean up afterwards.
- All stories must include acceptance tests (Given/When/Then) added as unit/integration tests where appropriate.
