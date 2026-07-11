# TRACE Slice B — Intake & Comms Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Branch: `slice/intake` off `main` (after Plan 0 lands).
> **Owner:** the intake/comms person. **You are the farmer's front door** and the outbound message channel.

**Goal:** A Telegram bot that turns intent into a graded batch, a token-gated photo-upload endpoint (storing photos + advancing `harvested→graded_farm`), and `send_message()` — all farmer-facing text grade/category-framed, never naming a buyer.

**Architecture:** Telegram webhook → create `Farmer` + `Batch` → reply with capture link → `POST /capture/{token}` stores photo + calls Slice C `grade()` + transitions. Outbound via `send_message`. Visibility rule (spec §4a): read `market_category` from data, never map a destination.

**Tech Stack:** `python-telegram-bot` (or raw `httpx` to Telegram Bot API), FastAPI, the core state machine, Slice C's `grade()`.

**Specs:** [product spec §4, §4a, §4b, §14a](../../specs/2026-07-11-trace-mvp-design.md) · [impl spec §4 Slice B, §5](../../specs/2026-07-11-trace-implementation-design.md)

**Time budget:** ~half day. Depends on Slice C's `grade()` signature (already fixed) and core's `transition()`/`generate_capture_token()`.

---

## File structure

```
backend/app/services/messaging.py     # send_message(), send_farmer_update(), get_batch_photo()
backend/app/routers/capture.py        # POST /capture/{token}  (replace core's 501 stub)
backend/app/routers/telegram.py       # POST /telegram/webhook
backend/app/photos/                    # stored upload photos (gitignored)
backend/tests/test_capture.py
backend/tests/test_messaging.py
```

---

## Task 1: Photo storage + `get_batch_photo()` seam

**Files:** `backend/app/services/messaging.py`, `backend/app/photos/.gitkeep`

- [ ] **Step 1:** `mkdir backend/app/photos && touch backend/app/photos/.gitkeep`; add `app/photos/` to `.gitignore` (keep `.gitkeep`).
- [ ] **Step 2:** In `services/messaging.py`, implement photo storage helpers:
```python
import os
PHOTO_DIR = os.path.join(os.path.dirname(__file__), "..", "photos")
def store_photo(batch_id: int, image_bytes: bytes) -> str:
    path = os.path.join(PHOTO_DIR, f"batch_{batch_id}.jpg")
    with open(path, "wb") as f: f.write(image_bytes)
    return path
def get_batch_photo(batch) -> bytes:
    with open(batch.photo_ref, "rb") as f: return f.read()
```
- [ ] **Step 3:** Test `store_photo` + `get_batch_photo` round-trip. Commit: `feat(intake): photo storage + get_batch_photo seam`.

---

## Task 2: `POST /capture/{token}` endpoint

**Files:** `backend/app/routers/capture.py` (replace core stub), `backend/tests/test_capture.py`

- [ ] **Step 1:** Replace the 501 stub. Implement `POST /capture/{token}` (no auth — token is the auth): look up `Batch WHERE capture_token == token AND capture_token_expires_at > now`; 404/410 if missing/expired. Accept the uploaded image (multipart), `store_photo(batch.id, bytes)` → set `batch.photo_ref`. Then **call Slice C's `grade()`**, set `batch.farm_grade` + `batch.grade_reason_farm`, and `transition(db, batch, State.GRADED_FARM, farm_grade=...)`. Return `{grade, reason}`.
- [ ] **Step 2:** Test: seed a batch at HARVESTED with a token, monkeypatch `grade()` to return `{grade:"A",reason:"x"}`, POST a fixture image → 200, batch now at GRADED_FARM with farm_grade="A". Expired token → 410. Run → PASS. Commit: `feat(intake): capture endpoint stores photo + grades + transitions`.

---

## Task 3: `send_message()` + `send_farmer_update()` (category-framed)

**Files:** `backend/app/services/messaging.py`, `backend/tests/test_messaging.py`

- [ ] **Step 1:** Implement (using `httpx` to the Bot API, no SDK needed for MVP):
```python
import httpx
from app.config import settings
TELEGRAM_API = f"https://api.telegram.org/bot{settings.telegram_bot_token}"
def send_message(chat_id: str, text: str) -> None:
    httpx.post(f"{TELEGRAM_API}/sendMessage", json={"chat_id": chat_id, "text": text}, timeout=10)
def send_farmer_update(chat_id: str, event: dict) -> None:
    # event carries market_category (from Slice D), NOT a destination
    cat = event.get("market_category", "market")
    text = f"Your {event['crop']} dropped to Grade {event['handoff_grade']} in transit, " \
           f"so it sold at the Grade {event['handoff_grade']} price to the {cat} — " \
           f"${event['payout_now']} instead of ${event['payout_was']}. Still sold, nothing wasted."
    send_message(chat_id, text)
```
- [ ] **Step 2:** Test `send_farmer_update` produces text containing "Grade B", "secondary market", "$5.10", and **never** a buyer name. Assert no destination string leaks. Monkeypatch `send_message` to capture. Run → PASS. Commit: `feat(intake): category-framed send_message + send_farmer_update`.

---

## Task 4: Telegram webhook — intent → capture link

**Files:** `backend/app/routers/telegram.py`

- [ ] **Step 1:** Implement `POST /telegram/webhook`: parse `message.text` + `message.chat.id`; resolve/create `Farmer` by `telegram_chat_id`. On intent text matching `harvest (\d+)kg (\w+)`, create a `Batch` at `HARVESTED`, call core's `generate_capture_token(db, batch)`, and reply: `"Nice! Tap to photograph your batch with a coin for scale 👇 <FRONTEND_URL>/capture/{token}"`. On "what's needed?" or "demand", reply with the demand feed (call Slice D's demand-feed function/endpoint when available; until then a stub message). Else reply a short help text.
- [ ] **Step 2:** Configure the webhook against the bot (`setWebhook`) — document the one-time curl in a README snippet. For local dev, support polling mode behind a flag. Test the intent-parse + token-creation logic with a mocked update. Commit: `feat(intake): telegram webhook intent → capture link`.

---

## Task 5: Degraded-mode message queue (spec §14a)

**Files:** `backend/app/services/messaging.py`

- [ ] **Step 1:** Wrap `send_message` so on HTTP failure it **queues** the message to a small `OutboundQueue` table (id, chat_id, text, attempts, next_retry_at) and a background retry loop flushes it. The state machine **never blocks** on Telegram being down.
- [ ] **Step 2:** Test: monkeypatch httpx to raise, call `send_message` → row appears in queue; flush → retries. Run → PASS. Commit: `feat(intake): degraded-mode outbound queue + retry`.

## Definition of Done

- [ ] Texting the bot creates a batch + returns a working capture link
- [ ] Uploading via the link grades the photo (via Slice C) and advances the batch to GRADED_FARM
- [ ] `send_message` / `send_farmer_update` work and never leak a buyer/destination
- [ ] Telegram-down queues, doesn't crash
- [ ] PR to `main`

## Critical reminders

- **Never map destination→category.** Read `market_category` from the payout/event Slice D produces. If you find yourself writing `if destination == "school"`, stop — that's Slice D's job.
- `get_batch_photo(batch)` is the seam Slice D's handoff step depends on — keep its signature stable.
- For the demo, the webhook needs a public URL (Railway gives you one). Locally, use Telegram `getUpdates` polling.
