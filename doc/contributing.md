# Contributing

Getting started (developer environment)
--------------------------------------
1. Install Python 3.12+ and create a virtual environment.
2. pip install -r requirements.txt
3. Copy `.env` to `.env.local` and set `AZURE_OPENAI_API_KEY`.
4. Run tests: `python -m unittest discover -v`.

Branching and PRs
-----------------
- Create a short-lived feature branch: `feature/your-feature`.
- Make small commits with clear messages.
- Push and open a Pull Request describing the change and linking to spec/task IDs.

Commit messages
---------------
- Use clear imperative-style messages.
- When making commits in this environment, include the required commit trailer:
  `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`

Code review
-----------
- Add tests for new behavior.
- Ensure no secrets are present in the diff.
- Address review comments and squash/rebase as appropriate.
