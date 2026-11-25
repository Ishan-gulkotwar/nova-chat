# Nova Chat

A self-hosted AI chat app: a ChatGPT-style interface for local models through
[Ollama](https://ollama.com) and cloud models through OpenAI-compatible APIs and
Anthropic's Claude API.

> **Status:** early development (Phase 1 of 9: project setup).

## Tech stack

| Layer    | Tech                                                                 |
| -------- | -------------------------------------------------------------------- |
| Frontend | React 18, TypeScript, Vite, Tailwind CSS v4, TanStack Query          |
| Backend  | Python 3.11+, FastAPI, Pydantic Settings                             |
| Testing  | pytest (backend), Vitest + Testing Library (frontend)                |
| Planned  | SQLModel, Alembic, PostgreSQL + pgvector, SSE streaming, Docker, CI  |

## Project structure

```
nova-chat/
├── backend/    FastAPI app (app/), tests (tests/), pyproject.toml
└── frontend/   React + Vite app (src/)
```

## Getting started (local development)

**Prerequisites:** Python 3.11+, Node.js 20+, Git.

### 1. Backend (Windows PowerShell)

```powershell
cd backend
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -e ".[dev]"
Copy-Item .env.example .env
python -m uvicorn app.main:app --reload --port 8000
```

On macOS/Linux, activate with `source .venv/bin/activate` and copy with `cp`.
Using `python -m <tool>` also works on Windows machines where Application Control
blocks the `.exe` launchers inside `.venv\Scripts`.

API docs: http://localhost:8000/api/docs

### 2. Frontend (second terminal)

```powershell
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. In development, Vite proxies `/api/*` to the backend.

### Running tests

```powershell
cd backend;  python -m pytest
cd frontend; npm test
```

## Roadmap

- [x] Phase 1: Monorepo setup, FastAPI + React hello world
- [ ] Phase 2: Streaming chat with Ollama (SSE), Markdown rendering, model selector
- [ ] Phase 3: Persistent chat history
- [ ] Phase 4: Multiple providers (Ollama, OpenAI-compatible, Anthropic), encrypted API keys
- [ ] Phase 5: Authentication (JWT), per-user chats, admin role
- [ ] Phase 6: RAG: chat with your documents
- [ ] Phase 7: Tool calling (calculator, time, web reader, web search)
- [ ] Phase 8: Docker Compose, migrations, linting, GitHub Actions CI
- [ ] Phase 9: Live demo deployment

## Credits

Inspired by [Open WebUI](https://github.com/open-webui/open-webui). This is an
independent implementation and shares no code with it.

## License

[MIT](LICENSE)
