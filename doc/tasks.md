# Tasks — Actionable work items

This list maps to short, testable todos. Use the `todos` SQL table to track progress if desired.

- docs-001: Finalize /doc content (this patch) — DONE
- tests-001: Add unit tests mocking llm.chat for summarization and flashcards endpoints (priority: high)
- llm-001: Add robust error handling, retries, and timeouts around LLM calls (priority: high)
- security-001: Implement MIME-type validation, virus scanning, and size checks for uploads (priority: high)
- infra-001: Configure secrets via Azure Key Vault or platform secrets; update deployment docs (priority: high)
- perf-001: Move LLM-heavy jobs into a background queue (Celery/RQ) and add job status endpoints (priority: medium)
- i18n-001: Add configuration to allow multi-language output for LLM endpoints (priority: low)
- docs-002: Add usage examples and curl snippets for API endpoints (priority: medium)

Each task should include:
- ID (short kebab-case)
- Title
- Description
- Acceptance criteria
- Estimated owner (team member)
