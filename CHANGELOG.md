# FMS – Session Changelog
**Date:** March 12, 2026

---

## Features Added

### 1. Share Group
- Added `share_token` column to the `Group` model (with auto-migration on startup).
- Added `POST /api/groups/<id>/share` — generates a unique share token and returns it.
- Added `DELETE /api/groups/<id>/share` — revokes the share link.
- Added `GET /shared/<token>` — serves a read-only public view of the group.
- Added a **🔗 Share** button in the group view header (next to "Add Unassigned Files").
- Added a share modal with a copyable link field and a "Revoke Link" button.
- Created `templates/shared.html` — a standalone read-only page showing the group, its under-groups, all files, and each file's description and summary.

### 2. Interactive Shared Page
- Made each file card on the shared page **expandable/collapsible** (click the header row).
- Added a **"View PDF"** button that embeds the PDF inline via an `<iframe>`.
- Added an **"Open in New Tab"** link for direct PDF access.
- Description and summary are always shown when a card is expanded, with fallback placeholder text when empty.
- Fixed inline template event-handler parse errors by replacing `onclick="fn({{ id }})"` with `data-*` attributes and a delegated `click` listener.

### 3. Favicon
- Created `static/favicon.svg` — a blue book icon rendered as an SVG.
- Added `<link rel="icon">` to both `templates/index.html` and `templates/shared.html`.
- Added a `/favicon.ico` Flask route that redirects to the SVG for browser compatibility.

---

## Bug Fixes

- **Shared page parse errors** (`Property assignment expected`, `',' expected`): caused by Jinja2 template expressions inside inline `onclick` attributes. Fixed by switching to `data-toggle-card` / `data-view-pdf` attributes with a single delegated listener.

---

## Infrastructure / Housekeeping

### Cleaned Up Dev Container
- Changed `docker-compose.yml` volumes from `- .:/app` (full bind-mount) to selective mounts:
  - `./app.py`, `./static`, `./templates`, `./requirements.txt` — source files (live-reload)
  - `./uploads`, `./fms.db` — runtime data (persisted on host)
- Result: container no longer contains `.git/`, `.devcontainer/`, `.gitignore`, `.dockerignore`, `README.md`, `Dockerfile`, or `docker-compose.yml`.

### Improved `.dockerignore`
Added exclusions: `README.md`, `docker-compose.yml`, `Dockerfile`, `.dockerignore`, `fms.db`.

---

## File Summary

| File | Change |
|---|---|
| `app.py` | Added `share_token` to `Group`, migration, share/unshare endpoints, shared view route, `/favicon.ico` redirect |
| `templates/index.html` | Added Share button + share modal, favicon link |
| `templates/shared.html` | Created (new) — fully interactive read-only shared group page |
| `static/favicon.svg` | Created (new) — blue book SVG favicon |
| `docker-compose.yml` | Switched to selective bind mounts |
| `.dockerignore` | Extended exclusion list |
