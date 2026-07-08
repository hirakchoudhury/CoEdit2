# CRDT-Based Collaborative Document Editor

A **local-first**, **offline-capable**, real-time collaborative document editor. The backend is a stateless relay and snapshot store; document state lives in clients using **Yjs (CRDT)**. Built to match the [system design document](crdt_collaborative_document_editor_system_design.md).

## Architecture (brief)

- **Clients**: Own document state (Yjs CRDT). Edits apply immediately; updates are sent over WebSocket and queued when offline.
- **Backend**: Spring Boot modular monolith. Responsibilities:
  - **Auth** (JWT) and **authorization**
  - **WebSocket relay**: forwards binary CRDT updates; no document merging
  - **Snapshot persistence only**: store/load CRDT snapshots; no plain-text document content
  - **Presence**: Redis-backed online users and cursors per document
- **PostgreSQL**: Users, document metadata, permissions, CRDT snapshots.
- **Redis**: Presence per document; Pub/Sub for multi-instance WebSocket sync.

## Tech stack

| Layer      | Stack                          |
|-----------|----------------------------------|
| Backend   | Java 17, Spring Boot, WebSocket, Spring Security (JWT), JPA, PostgreSQL, Redis, Maven |
| Frontend  | React (Vite), TypeScript, Yjs, WebSocket |
| Deployment| Docker (monorepo), optional Render/Railway/Fly.io |

## How to run locally

### Prerequisites

- **Java 17**, **Maven**, **Node 18+**, **Docker & Docker Compose** (for full stack)
- Or: **PostgreSQL 16** and **Redis 7** (for backend + frontend without Docker)

### Option A: Docker (full stack)

```bash
# From repo root
docker compose up --build
```

- App: **http://localhost** (frontend via nginx)
- Backend API: **http://localhost:8080**
- PostgreSQL: `localhost:5432` (user `postgres`, password `postgres`, db `collab_editor`)
- Redis: `localhost:6379`

### Option B: Backend + frontend on host

**1. Start PostgreSQL and Redis** (e.g. local install or Docker):

```bash
docker compose up -d postgres redis
```

**2. Backend**

```bash
cd backend
mvn spring-boot:run
```

Defaults: `localhost:8080`, DB `collab_editor`, Redis `localhost:6379`. Override with env:

- `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`
- `REDIS_HOST`, `REDIS_PORT`
- `JWT_SECRET` (min 32 chars for HS256)

**3. Frontend**

```bash
cd frontend
npm install
npm run dev
```

Open **http://localhost:5173**. Vite proxies `/api` and `/ws` to the backend.

### First run

1. Open the app, **Register** with email + password.
2. **Create** a document and open it.
3. Open the same document in another browser (or incognito) with another user to see real-time sync and presence.

## Project layout

```
root/
  backend/           # Spring Boot
    src/main/java/com/collab/editor/
      config/        # Security, CORS, Redis, WebSocket
      domain/        # User, Document, DocumentPermission, DocumentSnapshot
      repository/    # JPA
      service/       # Auth, Document, Snapshot, Presence
      controller/    # REST: auth, documents
      websocket/     # WebSocket handler, JWT handshake
      collab/        # Presence, Redis pub/sub, CRDT relay
  frontend/          # Vite + React + TypeScript
    src/
      api/           # REST client, auth, documents
      context/       # Auth context
      sync/          # WebSocketProvider (Yjs + presence)
      pages/         # Login, Register, Dashboard, Editor
  docker/            # Dockerfiles, nginx config
  docker-compose.yml
  README.md
```

## Scaling notes

- **Stateless backend**: Any instance can serve any request; JWT validates auth.
- **WebSockets**: Use **sticky sessions** (e.g. by cookie) so a given document’s clients hit the same instance, or rely on **Redis Pub/Sub** (already in place) so that when one instance receives a CRDT update it publishes to Redis and other instances subscribe and broadcast to their local sessions.
- **Snapshot strategy**: Client uploads snapshot every N updates or T seconds (configurable in frontend); backend stores only the latest (or last few) per document. No edit log stored.
- **Free-tier friendly**: Single backend instance, small Postgres and Redis (e.g. Render, Railway, Fly.io, Neon, Upstash).

## Why the main parts are there

- **Domain + JPA + Flyway**: Matches the design’s ER and class diagram; schema versioned and validated at startup.
- **JWT auth**: Stateless auth for REST and WebSocket handshake; no server-side session store.
- **Document CRUD + permissions**: Document metadata and sharing (READ/WRITE/OWNER) live in the backend; content is only in CRDT/snapshots.
- **WebSocket relay**: Clients send binary Yjs updates; backend broadcasts to other clients (and to Redis for multi-instance). No merging or OT on the server.
- **Presence in Redis**: So multiple backend instances see the same online users and cursors; TTL keeps keys from leaking.
- **Snapshot service**: Load latest on document open; client periodically uploads state so recovery after reconnect or new client is fast.
- **Frontend Yjs + custom provider**: Single source of truth in the client; offline queue and sync on reconnect; minimal UI focused on correctness.

## License

MIT.
