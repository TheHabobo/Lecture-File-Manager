# Lecture File Manager

A GoodNotes-style web app for organising and sharing lecture PDFs. Files are grouped into **Groups** and **Under-Groups**, each file can carry a description and AI-ready summary, and any group can be shared via a public read-only link.

---

## Features

- **Library view** — visual card grid of all your groups
- **Groups & Under-Groups** — two-level folder hierarchy; drag cards to reorder
- **File management** — upload PDFs, add descriptions & summaries, drag to reorder
- **Move files** — drag a file onto a group or under-group card; toast with one-click Undo
- **Unassigned files picker** — add uncategorized files to a group from inside the group view
- **Share** — generate a public link for any group; recipients can read descriptions, summaries, and view PDFs without an account; revoke the link at any time
- **AI hooks** — `/api/files/<id>/summarize` and `/api/files/<id>/generate-tasks` endpoints are ready to connect to any AI model
- **Task generator** — rule-based fallback that creates fresh exam-style tasks from file metadata

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Python 3.12, Flask 3.1, Flask-SQLAlchemy 3.1 |
| Database | SQLite (auto-created as `fms.db`) |
| PDF parsing | pypdf 5.4 |
| Frontend | Vanilla JS, CSS, HTML5 Drag-and-Drop API |
| Container | Docker + Docker Compose |

---

## Quick Start

### With Docker (recommended)

```bash
docker compose up --build
```

App runs at **http://localhost:5001**

To stop:

```bash
docker compose down
```

### Without Docker

```bash
pip install -r requirements.txt
python app.py
```

App runs at **http://localhost:5000**

---

## Project Structure

```
fms/
├── app.py                  # Flask app — models, routes, AI hooks
├── requirements.txt
├── Dockerfile
├── docker-compose.yml
├── fms.db                  # SQLite database (auto-created)
├── uploads/                # Uploaded PDF files
├── static/
│   ├── css/style.css
│   ├── js/app.js
│   └── favicon.svg
└── templates/
    ├── index.html          # Main app
    └── shared.html         # Public read-only shared group view
```

---

## API Overview

### Files
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/files` | List files (supports `group_id`, `subgroup_id`, `root_only`) |
| `POST` | `/api/files/upload` | Upload a PDF |
| `PUT` | `/api/files/<id>` | Update name / description / summary / group |
| `PUT` | `/api/files/<id>/move` | Move file to a different group/under-group |
| `PUT` | `/api/files/reorder` | Persist drag-reorder |
| `DELETE` | `/api/files/<id>` | Delete file |
| `GET` | `/api/files/<id>/pdf` | Serve the raw PDF |
| `POST` | `/api/files/<id>/summarize` | AI summary hook |
| `POST` | `/api/files/<id>/generate-tasks` | Task generator |

### Groups
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/groups` | List all groups |
| `POST` | `/api/groups` | Create group |
| `PUT` | `/api/groups/<id>` | Rename group |
| `DELETE` | `/api/groups/<id>` | Delete group |
| `PUT` | `/api/groups/reorder` | Persist drag-reorder |
| `POST` | `/api/groups/<id>/share` | Generate share link |
| `DELETE` | `/api/groups/<id>/share` | Revoke share link |

### Under-Groups
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/groups/<id>/subgroups` | List under-groups |
| `POST` | `/api/groups/<id>/subgroups` | Create under-group |
| `PUT` | `/api/subgroups/<id>` | Rename under-group |
| `DELETE` | `/api/subgroups/<id>` | Delete under-group |
| `PUT` | `/api/groups/<id>/subgroups/reorder` | Persist drag-reorder |

### Sharing
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/shared/<token>` | Public read-only group view |

---

## Connecting an AI Model

Replace the body of `_run_ai_summary()` in `app.py` with a call to your preferred model:

```python
def _run_ai_summary(pdf_path: str) -> str:
    # Call your AI API here and return the summary string
    ...
```

The `generate-tasks` endpoint is fully self-contained and requires no external API.

---

## Dev Container (VS Code)

1. Open this folder in VS Code.
2. Run **Dev Containers: Reopen in Container**.
3. The container starts automatically via `docker-compose.yml`.
4. Open **http://localhost:5001**.

