# Constitution — Project principles

Purpose
--------
This project ("Lecture File Manager") helps instructors and students manage lecture PDF files, organize them into groups and subgroups, and generate AI-assisted artifacts (summaries, flashcards, tasks).

Governing principles
--------------------
- Spec-driven development: produce clear specs before implementing changes; prefer reviewable, testable artifacts.
- Test-first mindset: unit and integration tests are required for new features; CI must run the test suite.
- Minimal dependencies: prefer standard library and small, well-understood libraries; avoid adding heavy dependencies without justification.
- Secure secrets handling: API keys and secrets must never be committed. Use environment variables or platform secret stores (Azure Key Vault recommended).
- Privilege separation: LLM calls, storage, and user-facing endpoints should be separated; expensive/long-running LLM work should be queued in background jobs.
- Reproducible prompts: prompt templates and LLM calling code must be centralized (see llm.py) and versioned.
- Language policy: AI-generated content is produced in German (per current prompt policy). Document and tests must reflect this.

Acceptance criteria for constitution
------------------------------------
- A maintained constitution.md describing governance and developer expectations.
- CI checks for tests and linting (if added).
- Documented secrets handling and environment configuration in /doc/security.md.
