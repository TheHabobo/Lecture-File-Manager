# Project documentation

This documentation set follows the Spec Kit approach (https://github.com/github/spec-kit). It was created to provide a spec-driven, reviewable, and actionable description of this repository and its design decisions.

Top-level files (spec-kit mapping):
- constitution.md  — project principles and governance (/speckit.constitution)
- spec.md          — product specification and acceptance criteria (/speckit.specify)
- plan.md          — technical implementation plan (/speckit.plan)
- tasks.md         — actionable task list (/speckit.tasks)
- implement.md     — developer implementation notes (/speckit.implement)

Additional reference docs:
- design.md        — architecture and data model details
- api.md           — API endpoints and example requests/responses
- security.md      — secrets, uploads, and security guidance
- llm.md           — unified LLM layer and prompt guidance (German output)
- contributing.md  — developer setup and contribution guide

How this was produced
- The repository was scanned and an LLM wrapper (llm.py) was created to centralize Azure OpenAI calls. The doc content follows Spec Kit templates and adapts them to the current codebase.

Next steps
- Review the document set and approve or request changes. If you want translations (German) or a narrower subset of templates, indicate preferences and the files will be adjusted.