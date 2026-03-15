# API reference

Base URL: (local) http://localhost:5000

Endpoints (summary)
-------------------
- GET / -> HTML index

Files
- GET /api/files
  - Query: group_id, subgroup_id, root_only
  - Response: JSON array of file objects

- GET /api/files/<id>
  - Response: JSON file object

- POST /api/files/upload
  - Multipart form-data: group_id, subgroup_id, file (PDF)
  - Response: 201 JSON file object

- PUT /api/files/<id>
  - JSON body: fields to update (description, summary, example_tasks, generated_tasks, group_id, subgroup_id)
  - Response: updated file object

- DELETE /api/files/<id>
  - Response: message

AI endpoints
- POST /api/files/<id>/summarize
  - Triggers AI summarization; response: {"summary": "..."}

- POST /api/files/<id>/generate-tasks
  - JSON body (optional): { original_name, description, summary, example_tasks }
  - Response: {"tasks": "...", "file": { ... }}

- POST /api/files/<id>/generate-flashcards
  - JSON body (optional): { original_name, description, summary }
  - Response: {"flashcards": "...", "file": { ... }}

Groups
- GET /api/groups
- POST /api/groups  (json {"name": "..."}) -> 201
- PUT /api/groups/<id>
- DELETE /api/groups/<id>
- POST /api/groups/<id>/generate-topics  -> merges generated topics into group.topics_checklist

Timeline Tasks
- GET /api/timeline-tasks
- POST /api/timeline-tasks  (json {title, start_date, end_date, group_id?}) -> 201
- PUT /api/timeline-tasks/<id>
- DELETE /api/timeline-tasks/<id>

Notes
-----
- AI endpoints call the centralized llm layer. Ensure AZURE_OPENAI_API_KEY is configured when invoking these endpoints in non-dev environments.
- Uploads are limited by app.config['MAX_CONTENT_LENGTH'] (50 MB by default).
