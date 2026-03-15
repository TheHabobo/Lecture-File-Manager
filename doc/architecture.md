# Architecture — System architecture, components, and deployment guidance

This architecture document follows Spec Kit recommendations: describe components, responsibilities, data flows, scaling considerations, security controls, and acceptance criteria for the architecture.

High-level overview
-------------------
```
[Browser] <--> [Flask Web App (app.py)] <--> [SQLite DB (fms.db)]
                                   |                      \
                                   |                       > [CI/CD, Tests]
                                   +--> [File storage on disk (/uploads)]
                                   +--> [LLM client: llm.py] --> [Azure OpenAI Deployment]
                                          (AZURE_OPENAI_ENDPOINT & AZURE_OPENAI_API_KEY)
```

Components & responsibilities
- Web App (Flask - app.py)
  - HTTP routing, templates, API endpoints
  - Data validation, persistence via SQLAlchemy
  - File handling (saving files under /uploads)
  - Orchestrates LLM calls through the unified llm.py module

- LLM Adapter (llm.py)
  - Centralizes all LLM requests and header handling (api-key header for Azure)
  - Exposes `chat()` convenience function and `chat_completion()` for raw JSON
  - Responsible for raising LLMError on failures and keeping network concerns localized

- Database (SQLite for dev)
  - Stores Groups, SubGroups, PDFFile metadata, TimelineTask
  - For production, replace with managed DB (Postgres, Azure SQL)

- File storage (local /uploads)
  - For production, migrate to object storage (Azure Blob / S3) with immutable keys

- Background workers (recommended)
  - For heavy LLM workloads, use a queue + worker (Redis + Celery or RQ)
  - Workers call llm.chat and persist results back to DB. Provide job status endpoints.

- Secrets management
  - Store AZURE_OPENAI_API_KEY and any DB credentials in a secrets store (Azure Key Vault/managed platform secrets). DO NOT commit .env to repo.

Data flow for AI generation
1. Client triggers endpoint (e.g., /api/files/<id>/summarize).
2. Server extracts text (pypdf limited pages).
3. Server calls llm.chat(system_prompt, user_prompt=extracted_text, temperature, max_tokens).
4. llm.py posts to the Azure OpenAI endpoint using api-key header and returns JSON or text.
5. Server validates and stores the output to PDFFile.summary / flashcards / generated_tasks.

Scaling and performance
- LLM calls are the bottleneck: use worker pool -> schedule tasks asynchronously and respond with job IDs.
- For high concurrency: replace SQLite with a resilient RDBMS, use a shared object store for files.
- Add caching for repeated prompts (prompt hashing + TTL cache) to reduce cost when same document/parameters are requested.

Security considerations
- Use HTTPS in production for all endpoints; terminate TLS at load balancer.
- Do not log API keys or raw prompts containing sensitive user data.
- Rate-limit public endpoints and add authentication/authorization for management endpoints.
- Validate uploads thoroughly: MIME check, pypdf sanity, virus scanning.

Observability & monitoring
- Log LLM call metadata (prompt hash, response size, latency, status) without the prompt text.
- Add metrics (Prometheus): LLM request count, latency, error rate; API request latencies; disk usage for uploads.
- Configure alerting on unusual LLM error rates or cost spikes.

Deployment recommendations
- Dev: current repo runs with SQLite and local uploads; set AZURE_OPENAI_API_KEY in env and run with Flask.
- Staging/Prod:
  - Replace SQLite with Postgres/Azure SQL
  - Store files in Azure Blob Storage; serve through CDN
  - Run multiple web workers behind a load balancer
  - Use Redis + Celery (or RQ) for background LLM jobs
  - Use Azure Key Vault for secrets and set least privilege for the key used by llm.py

Mapping to source files
- app.py: API & core logic; contains AI hooks transformed to call llm.chat; to review for unit-test coverage.
- llm.py: unified LLM access; the single place to change if switching providers or endpoints.
- tests/: contains baseline tests; extend to mock llm.chat and simulate edge cases.

Architecture acceptance criteria
- All LLM requests go through llm.py (verified by grepping codebase for direct OpenAI/requests usage).
- Environment configuration (AZURE_OPENAI_API_KEY/ENDPOINT) and .env exclusion enforced via .gitignore.
- AI endpoints have deterministic fallbacks if LLM is unavailable.
- Plan to move LLM-heavy work to background workers exists and is documented in tasks.md.

Next steps
- Implement background job queue and add job status API.
- Migrate storage to object store and DB to managed RDS for production.
- Harden upload validation and add rate limiting and authentication.

