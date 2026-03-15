# Security & secrets

Secrets & environment
---------------------
- Never commit API keys or .env files. The repository includes an example `.env` and `.gitignore` that excludes `.env`.
- Recommended production practice: store secrets in a managed secret store (Azure Key Vault, AWS Secrets Manager) and inject them at deploy time.
- The LLM wrapper expects an API key via `AZURE_OPENAI_API_KEY`. For CI, use repository secrets and avoid exposing keys in logs.

File uploads
------------
- Current code checks extension (`allowed_file()`) but should:
  - Validate MIME type and parse with pypdf to ensure it's a genuine PDF.
  - Run a virus/av scan and deny dangerous files.
  - Enforce `MAX_CONTENT_LENGTH` to limit upload size.
  - Store files in object storage for production and avoid serving user-controlled filenames directly.

Endpoint safety
---------------
- Add rate limiting to public endpoints to prevent abuse of the LLM and upload endpoints.
- Add authentication and authorization for any non-public operations (group management, reordering, deletion).

LLM and prompt safety
---------------------
- Do not log raw prompts containing private data.
- Sanitize inputs that are sent to the LLM to avoid prompt injection when incorporating user content verbatim.
- Monitor LLM usage and set budgets/quotas.

Recommendations
---------------
- Implement authentication (JWT/OAuth) before exposing LLM endpoints publicly.
- Introduce background processing for LLM tasks and keep request timeouts small.
