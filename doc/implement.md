# Implement — Developer instructions and checklist

Prerequisites
-------------
- Python 3.12+
- Recommended: create a virtual environment (venv)

Local setup (quick)
-------------------
```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env .env.local   # populate AZURE_OPENAI_API_KEY
export FLASK_APP=app.py
export FLASK_ENV=development
flask run --host=0.0.0.0 --port=5000
```

Database
--------
- The app uses SQLite (fms.db). On first import `db.create_all()` runs in app.py to ensure schema exists.

Running tests
-------------
```bash
python -m unittest discover -v
```

Common developer workflows
--------------------------
- Make small, focused changes and include tests.
- Commit and open a PR; include a descriptive title and link to relevant spec/tasks.
- Follow the repository commit trailer policy (see CONTRIBUTING) when making commits.

Notes
-----
- For production, update `SQLALCHEMY_DATABASE_URI` and move uploads to object storage.
- Do not commit secrets or .env files.
