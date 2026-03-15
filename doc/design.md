# Design — architecture and data model

Data models (summary)
---------------------
- Group
  - id, name, sort_order, share_token, topics_checklist, todos_checklist, created_at
  - relationships: files, subgroups

- SubGroup
  - id, name, group_id, sort_order, created_at
  - relationships: files

- PDFFile
  - id, original_name, stored_name, group_id, subgroup_id, sort_order
  - description, summary, flashcards, example_tasks, generated_tasks, share_token, uploaded_at
  - Files stored under /uploads with `stored_name` (secure_filename + randomness)

- TimelineTask
  - id, title, start_date, end_date, group_id, created_at

File upload flow
----------------
1. User POSTs multipart/form-data to `/api/files/upload`.
2. Server validates extension (`allowed_file()`), secure_filename, and saves file to /uploads.
3. DB entry (PDFFile) is created with stored_name and metadata.
4. Optionally, user triggers LLM endpoints to generate summaries/flashcards/tasks.

LLM flow
--------
1. The application extracts text from PDFs using pypdf (limited pages for speed).
2. A prompt is composed (centralized in app.py or llm.md) and passed to `llm.chat(...)`.
3. llm.py sends the request to the configured Azure OpenAI endpoint using the 'api-key' header.
4. Response is stored back on the PDFFile row (`summary`, `flashcards`, `generated_tasks`).

Scaling considerations
----------------------
- Move large or expensive LLM work to background workers (Celery/RQ) and use object storage for files.
- For multiple web workers, use a shared database and central object store to avoid local-disk conflicts.

Observability
-------------
- Log LLM calls (prompt hash, latency, error codes) but never log secrets.
- Add metrics for LLM usage and endpoint latencies.
