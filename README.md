# fms

File management system built with Flask.

## Run with Docker

```bash
docker compose up --build
```

App URL: `http://localhost:5000`

To stop:

```bash
docker compose down
```

## Open in Dev Container (VS Code)

This project includes `.devcontainer/devcontainer.json` and is linked to Docker through `docker-compose.yml`.

1. Open this folder in VS Code.
2. Run **Dev Containers: Reopen in Container**.
3. In the container terminal, start the app:

```bash
python app.py
```

Then open `http://localhost:5000`.
