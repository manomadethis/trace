# TRACE Core Scaffold Implementation Plan (Plan 0 — the base)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement task-by-task. Steps use checkbox (`- [ ]`) syntax.
> **Owner:** the core-scaffold person. **This lands on `main` FIRST.** The four slice plans branch off it. Do not start a slice until this plan's Definition of Done passes.

**Goal:** A containerized FastAPI + Postgres app that boots clean, seeds deterministically, and exposes the state machine, SSE bus, auth, and 501-stub REST routes every slice will fill in.

**Architecture:** One FastAPI monolith in Docker Compose (app + db). SQLAlchemy 2.0 models for all tables. A single `Batch.transition()` is the only way state changes. An in-process asyncio SSE bus + append-only `AuditEvent`. bcrypt session-cookie auth with role dependencies. Deterministic seed.

**Tech Stack:** FastAPI, SQLAlchemy 2.0, psycopg, pydantic-settings, bcrypt, itsdangerous (signed sessions), pytest, Docker Compose, Postgres 16.

**Specs:** [product spec §6, §7, §4b, §13](../../specs/2026-07-11-trace-mvp-design.md) · [impl spec §2, §3](../../specs/2026-07-11-trace-implementation-design.md)

**Time budget:** ~1.5–2 hrs. This is the gating deliverable — the other three can prep (read the slice plans, stub tests) while you finish.

---

## File structure

```
compose.yaml
.env.example
backend/
  Dockerfile
  pyproject.toml
  app/
    __init__.py
    main.py            # FastAPI app, CORS, router mount, /health
    config.py          # pydantic-settings env loader
    db.py              # engine, SessionLocal, get_db dependency, Base
    models.py          # ALL tables
    auth.py            # bcrypt, session middleware, role deps, capture token
    statemachine.py    # states, transitions, guards, transition()
    events.py          # SSE bus + audit writer
    seed.py            # deterministic seed (--reset)
    routers/__init__.py
    routers/auth.py    routers/batches.py  routers/contracts.py
    routers/capture.py routers/admin.py     routers/payouts.py
    routers/offers.py  routers/pickups.py
  tests/
    conftest.py
    test_statemachine.py
    test_seed.py
    test_auth.py
```

---

## Task 1: Docker Compose + FastAPI skeleton + /health

**Files:** `compose.yaml`, `backend/Dockerfile`, `backend/pyproject.toml`, `backend/app/main.py`, `backend/app/config.py`, `backend/app/db.py`, `.env.example`

- [ ] **Step 1:** Write `backend/pyproject.toml` with deps: `fastapi`, `uvicorn[standard]`, `sqlalchemy>=2`, `psycopg[binary]`, `pydantic-settings`, `bcrypt`, `itsdangerous`, `httpx`, `pillow`, `pytest`, `pytest-asyncio`.

- [ ] **Step 2:** Write `backend/app/config.py`:
```python
from pydantic_settings import BaseSettings
class Settings(BaseSettings):
    database_url: str = "postgresql+psycopg://trace:trace@db:5432/trace"
    session_secret: str = "dev-secret-change-me"
    openrouter_api_key: str = ""
    openrouter_model: str = ""
    telegram_bot_token: str = ""
    llm_justification_model: str = ""
    class Config: env_file = ".env"
settings = Settings()
```

- [ ] **Step 3:** Write `backend/app/db.py`:
```python
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase
from app.config import settings
engine = create_engine(settings.database_url)
SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)
class Base(DeclarativeBase): pass
def get_db():
    db = SessionLocal()
    try: yield db
    finally: db.close()
```

- [ ] **Step 4:** Write `backend/app/main.py`:
```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
app = FastAPI(title="TRACE")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
@app.get("/health")
def health(): return {"status": "ok"}
```

- [ ] **Step 5:** Write `backend/Dockerfile` (python:3.12-slim, install deps, `CMD uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload`).

- [ ] **Step 6:** Flesh out `compose.yaml` (replaces Ryheeme's placeholder) with services `db` (postgres:16, env POSTGRES_USER/PASSWORD/DB=trace) and `app` (build ./backend, depends_on db, env DATABASE_URL, port 8000:8000). Add a `seed` one-shot profile.

- [ ] **Step 7:** Write `.env.example` listing every key from `config.py`.

- [ ] **Step 8:** `docker-compose up -d --build` → `curl localhost:8000/health` → expect `{"status":"ok"}`. Commit: `chore: docker compose + fastapi skeleton + /health`.

---

## Task 2: Models — all tables

**Files:** `backend/app/models.py`, `backend/tests/conftest.py`

- [ ] **Step 1:** Write `models.py` with SQLAlchemy 2.0 declarative `Mapped` columns for: `User` (id, email unique, password_hash, role enum `admin|premium_buyer|secondary_buyer|composter`, buyer_id FK nullable), `Farmer` (id, name, telegram_chat_id, lat, lng), `Buyer` (id, name, type enum `premium|secondary|composter`, lat, lng, demand_crop, demand_grade, demand_kg, price_per_kg, capacity), `Contract` (id, buyer_id, crop, grade, kg_target, price_per_kg, deadline, status enum `open|fulfilling|fulfilled|short`), `Batch` (id, farmer_id, crop, kg, lat, lng, status str, farm_grade, handoff_grade, final_grade, decay_event nullable, photo_ref, grade_reason_farm, grade_reason_handoff, capture_token unique, capture_token_expires_at, virtual_shipment_id nullable, route_id nullable), `VirtualShipment` (id, contract_id, total_kg, status), `VirtualShipmentBatch` (shipment_id FK, batch_id FK, pct_contribution Float), `Route` (id, buyer_id, pickup_geo, returning_leg_capacity, batch_ids JSON), `RoutingDecision` (id, batch_id, from_destination, to_destination, reason_code enum `transit_decay|route_disruption|quality_mismatch`, claude_justification Text, created_at), `Payout` (id, farmer_id, batch_id, grade_paid_at, destination, market_category enum `premium_market|secondary_market|composted`, kg, amount Numeric, status enum `held|released`), `AuditEvent` (id, batch_id nullable, event_type, payload JSON, created_at).

- [ ] **Step 2:** Write `tests/conftest.py` with a fixture that creates all tables on a test DB and yields a session.

- [ ] **Step 3:** Write a smoke test that creates one of each row and commits. Run `pytest -q tests/test_models.py` → PASS. Commit: `feat(models): all tables per spec §6`.

---

## Task 3: State machine — the single source of truth

**Files:** `backend/app/statemachine.py`, `backend/tests/test_statemachine.py`

- [ ] **Step 1:** Write `statemachine.py` defining `class State(str, Enum)` with all 13 states (spec §7) and a `TRANSITIONS` dict mapping `(from, to) -> guard_fn`. Provide `transition(db, batch, dest, **ctx)` that: raises `IllegalTransition` if `(batch.status, dest)` not in TRANSITIONS; runs the guard; sets `batch.status = dest`; and (once Task 4 lands) appends an `AuditEvent` + publishes to the bus. For now just mutate status + commit.

- [ ] **Step 2:** Guards: `harvested->graded_farm` requires `farm_grade` in ctx; `pooled->contracted` requires `contract_id`; `contracted->shipped` requires `route_id`; `shipped->graded_handoff` requires `handoff_grade`. Others are unconditional given the right source state.

- [ ] **Step 3:** Write `tests/test_statemachine.py` (table-driven): assert every legal transition from spec §7 advances; assert a sample of illegal transitions raise (e.g. `HARVESTED -> PAID`). Run → PASS. Commit: `feat(statemachine): batch lifecycle + guards`.

---

## Task 4: SSE bus + AuditEvent writer

**Files:** `backend/app/events.py`

- [ ] **Step 1:** Write `events.py` with an in-process asyncio pub/sub: `subscribe() -> AsyncGenerator` (yields JSON event strings to SSE clients), `publish(event_type, payload)` (fans out to all subscribers), and `log_audit(db, batch_id, event_type, payload)` (appends an `AuditEvent` row then publishes `"audit"`).

- [ ] **Step 2:** Wire `statemachine.transition()` to call `log_audit` on every successful transition (import inside the function to avoid cycles). Re-run state-machine tests → still PASS, now each transition emits an event. Commit: `feat(events): SSE bus + audit writer wired into transitions`.

---

## Task 5: Auth — sessions, roles, capture token

**Files:** `backend/app/auth.py`, `backend/tests/test_auth.py`, `backend/app/routers/auth.py`

- [ ] **Step 1:** Write `auth.py`: `hash_password(pw)`/`verify_password(pw, hash)` via bcrypt; a signed-cookie session store via itsdangerous (`set_session(response, user_id)`, `current_user(request, db)`); role dependencies `require_admin`, `require_buyer(type=...)`, `require_composter` that read `current_user` and raise 401/403; and `generate_capture_token(db, batch)` writing a `secrets.token_urlsafe(32)` to `batch.capture_token` with `capture_token_expires_at = utcnow + 24h`.

- [ ] **Step 2:** Write `routers/auth.py`: `POST /auth/login {email,password}` (verify, set session cookie, return role), `POST /auth/logout`. Mount in `main.py`.

- [ ] **Step 3:** Test: seed a user, POST /auth/login with correct password → 200 + cookie; wrong password → 401; `require_admin` dependency allows admin, 403s a buyer. Run → PASS. Commit: `feat(auth): session-cookie login + role deps + capture token`.

---

## Task 6: Deterministic seed

**Files:** `backend/app/seed.py`

- [ ] **Step 1:** Write `seed.py` with a `--reset` flag (drop_all + create_all). Seed: 1 admin `User` + 1 premium-buyer `User` (bcrypt) + 1 secondary-buyer `User` + 1 composter `User`; 6 `Farmer`s across a small lat/lng box; 1 resort `Buyer` (premium) + 1 school-feeding `Buyer` (secondary) + **2 composter `Buyer`s** (primary + fallback, for the route-disruption anomaly); 1 `Contract` (resort, tomato, Grade A, 200kg, by 4pm); and **one `Batch` parked at `GRADED_FARM`** (Grade A, ready to flow). Mark one farmer's batches as decay-triggered via a flag in a small `DemoFlag` table or a `decay_on_handoff=True` column on Batch (add it).

- [ ] **Step 2:** Add a `seed` compose profile or a script entry: `docker-compose run --rm app python -m app.seed --reset`. Run it; query the DB → 6 farmers, 1 contract, seeded batch at GRADED_FARM. Commit: `feat(seed): deterministic scenario incl. 2 composters + decay batch`.

---

## Task 7: REST stubs (501) + SSE endpoint stub + DB scoping

**Files:** `backend/app/routers/{batches,contracts,capture,admin,payouts,offers,pickups}.py`

- [ ] **Step 1:** For each route in impl spec §5, add a handler returning HTTP 501, gated by the right role dependency (`require_admin` for `/batches`, `/contracts`, `/payouts`, `/demand`, `/admin/stream`; `require_buyer(premium)` for `/contracts/mine`, `/contracts/{id}/confirm`, `/batches/{id}/dispute`; `require_buyer(secondary)` for `/offers`; `require_composter` for `/pickups`; token-gated for `/capture/{token}`). `GET /admin/stream` returns a `text/event-stream` that subscribes to `events.subscribe()` (real stream, no logic yet).

- [ ] **Step 2:** Implement `GET /contracts/mine` for real now (it's trivial + proves DB scoping): filter `Contract WHERE buyer_id == current_user.buyer_id`. Keep others at 501.

- [ ] **Step 3:** `GET /batches` → 501 but gated `require_admin` (verify unauth → 401, buyer → 403). Commit: `feat(routers): 501 stubs gated by role + /admin/stream SSE + scoped /contracts/mine`.

---

## Definition of Done (the gate slices wait on)

- [ ] `docker-compose up -d --build` boots app + db
- [ ] `python -m app.seed --reset` seeds cleanly
- [ ] `GET /health` → 200
- [ ] `GET /batches` (as admin) → returns the seeded GRADED_FARM batch
- [ ] `GET /admin/stream` holds an SSE connection
- [ ] state-machine tests + auth tests + seed test all green
- [ ] **Push to `main`** (`git push origin main`) and announce to the team: slices may branch

## Critical reminders for the owner

- **`batch.status` is mutated ONLY inside `statemachine.transition()`.** Slices call `transition()`. Review PRs for direct status writes.
- Add `decay_on_handoff: bool` to `Batch` (Task 6) — Slice D reads it to trigger the decay re-grade.
- Keep `main` green. Slices merge into it; if you break `main`, you block everyone.
