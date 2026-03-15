# Technical plan

Goals
-----
Deliver a stable Flask application that provides file management and AI-assisted artifacts while centralizing LLM access via llm.py.

Tech stack
----------
- Python 3.12+, Flask 3.x, Flask-SQLAlchemy
- SQLite (local dev), SQLAlchemy ORM
- pypdf for PDF extraction
- Azure OpenAI for LLM (Azure endpoint configured via AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_API_KEY)
- Minimal JS/CSS frontend (templates/ and static/)

Architecture overview
---------------------
```
[Browser] <--> [Flask app (app.py)] <--> [SQLite database (fms.db)]
                                |
                                +--> [File storage on disk] (/uploads)
                                |
                                +--> [LLM client: llm.py] --> [Azure OpenAI endpoint]
```

Components
----------
- app.py: main Flask app. Defines models (Group, SubGroup, PDFFile, TimelineTask) and API routes.
- llm.py: unified LLM layer; central place to call Azure OpenAI; reads AZURE_OPENAI_API_KEY from env and uses 'api-key' header.
- uploads/: filesystem storage for PDFs.
- tests/: unit tests verifying core API flows.

LLM integration
---------------
- All application code must call LLM via `llm.chat(...)` or `llm.chat_completion(...)`.
- Environment variables:
  - AZURE_OPENAI_API_KEY (required)
  - AZURE_OPENAI_ENDPOINT (optional; defaults to the configured deployment URL)
- For heavy or long-running LLM workloads (e.g., processing many files), migrate to background tasks (Celery/RQ) and queue jobs.

Deployment notes
----------------
- For production, replace SQLite with a managed DB and store files on object storage (S3/Azure Blob).
- Use Azure Key Vault or platform secrets for API keys; avoid .env in production.

Testing and CI
--------------
- Unit tests available under tests/ (run with python -m unittest discover).
- Add CI workflow to run tests on PRs and push.
