# TRACE Slice D — Orchestration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Branch: `slice/orchestration` off `main` (after Plan 0 lands).
> **Owner:** the orchestration person. **You are the brain** — the biggest slice. Aggregation, the self-healing cascade, all money math, the handoff step, the scheduler, and the secondary/composter/dispute endpoints.

**Goal:** Aggregate graded batches into virtual shipments → contract match (HITL) → ship → (scheduler) → handoff re-grade (decay) → `decide_route()` deterministic reroute → payout math (with `market_category`) → justification LLM → farmer message. Handle two anomalies (transit decay + route disruption).

**Architecture:** Pure rules engine keyed off grade delta + contract/buyer state. Slice D owns the *entire handoff step* (B's photo via `get_batch_photo` → C's `simulate_decay`+`grade` → write `handoff_grade` → `decide_route`). Money moves only here, deterministically. One LLM call for justification text.

**Tech Stack:** plain Python rules, `httpx` (justification LLM), core state machine + events, Slice B `send_message`, Slice C `grade`/`simulate_decay`.

**Specs:** [product spec §6, §10, §11, §12, §13 (two anomalies)](../../specs/2026-07-11-trace-mvp-design.md) · [impl spec §4 Slice D, §5](../../specs/2026-07-11-trace-implementation-design.md)

**Time budget:** ~full day — the largest slice. Start early; B and C land before you need their functions.

---

## File structure

```
backend/app/services/aggregation.py   # pool + % contribution + demand feed
backend/app/services/routing.py       # decide_route() + compute_payout()
backend/app/services/handoff.py       # run_handoff(): photo→decay→grade→decide_route
backend/app/services/scheduler.py     # asyncio task gating shipped→graded_handoff
backend/app/services/justify.py       # the justification LLM call
backend/app/routers/contracts.py      # /contracts/mine, /confirm (replace stubs)
backend/app/routers/offers.py         # GET /offers  (secondary)
backend/app/routers/pickups.py        # GET /pickups (composter)
backend/app/routers/batches.py        # POST /batches/{id}/dispute + GET /batches
backend/app/routers/payouts.py        # GET /payouts
backend/tests/test_aggregation.py
backend/tests/test_routing.py
backend/tests/test_payout.py
```

---

## Task 1: Aggregation + demand feed

**Files:** `backend/app/services/aggregation.py`, `backend/tests/test_aggregation.py`

- [ ] **Step 1:** Implement `pool_for_contract(db, contract)` — select `GRADED_FARM` batches matching the contract's crop + grade within its geo box, create a `VirtualShipment`, link each via `VirtualShipmentBatch` with `pct_contribution = batch.kg / sum(kg)`. Transition each `graded_farm→pooled`.
- [ ] **Step 2:** Implement `demand_feed(db)` — from open `Contract`s, return anonymized `[{crop, grade, qty_band, urgency}]` (qty_band bucketed, no buyer/price/contract-id). This feeds Slice B's farmer message + `GET /demand`.
- [ ] **Step 3:** Test: seed 3 GRADED_FARM batches + a contract, pool → one shipment, percentages sum to 1.0; `demand_feed` returns no buyer fields. Run → PASS. Commit: `feat(orch): aggregation + demand feed`.

---

## Task 2: Contract matching + HITL confirm + ship

**Files:** `backend/app/routers/contracts.py` (replace stubs)

- [ ] **Step 1:** Implement `GET /contracts/mine` (`require_buyer(premium)`, scoped to `current_user.buyer_id` — core already stubbed this; finalize it) returning the contract + its pooled shipment + fulfillment %. Implement `POST /contracts/{id}/confirm` (`require_buyer(premium)`, owns contract) → for each pooled batch `transition(... CONTRACTED)`, then `transition(... SHIPPED)` with a created `Route`. After SHIPPED, enqueue the scheduler (Task 5).
- [ ] **Step 2:** Test confirm flow on seeded data: batches reach SHIPPED, a Route exists. Run → PASS. Commit: `feat(orch): contract confirm + ship + route`.

---

## Task 3: `decide_route()` — the self-healing rules engine (BOTH anomalies)

**Files:** `backend/app/services/routing.py`, `backend/tests/test_routing.py`

- [ ] **Step 1:** Implement `decide_route(db, batch, handoff_grade, contract, buyers) -> RoutingDecision` per spec §10:
  - `handoff_grade == farm_grade` → `graded_handoff→delivered` (stay premium).
  - downgraded A→B → pull batch from its premium shipment, recompute sibling %s + fulfillment, find a secondary `Buyer` with demand+capacity reachable (straight-line lat/lng) → `graded_handoff→rerouted→delivered_secondary`; else `composted`/`lost`.
  - WASTE → `graded_handoff→composted` if composter capacity on returning leg, else `lost`.
  - **route disruption:** `reason_code=route_disruption` → recompute returning leg to a **fallback composter/buyer** (the 2nd composter in the seed) reachable via an alternate route; re-payout. (Driven by a flag set by the demo/scheduler; see Task 6.)
  - Always write a `RoutingDecision` row + `transition()` the batch.
- [ ] **Step 2:** Returning-leg helper `reachable_on_returning(route, buyer)` — straight-line lat/lng distance vs the route's return path. Keep it simple (haversine).
- [ ] **Step 3:** Table-driven tests for each branch (no-decay, A→B, A→WASTE, route-disruption, no-capacity→lost) + returning-leg preference. Run → PASS. Commit: `feat(orch): decide_route rules engine incl. route-disruption branch`.

---

## Task 4: Payout math + `market_category`

**Files:** `backend/app/services/routing.py` (`compute_payout`), `backend/tests/test_payout.py`

- [ ] **Step 1:** Implement `compute_payout(db, batch, destination_buyer, price_per_kg) -> Payout`: amount = `batch.kg * price_per_kg` at delivered grade; set `market_category` from the destination buyer's type (`premium→premium_market`, `secondary→secondary_market`, `composter→composted`); status `held` until delivered then `released`. On compost → **zero-amount row still created + released** (`composted→paid`). On reroute → recompute this farmer's payout and the contract's fulfillment % (short if not backfilled). Buyer-side: contract finishes `fulfilled` or `short` (short = refunded/never charged).
- [ ] **Step 2:** Test: reroute A→B recomputes the farmer's payout to secondary price + recomputes contract fulfillment; compost yields an explicit $0 released payout; lost yields no payout row. Assert `market_category` is set and destination is **not** present on any farmer-facing field. Run → PASS. Commit: `feat(orch): payout math + market_category + zero-amount compost`.

---

## Task 5: The handoff step + scheduler (Slice D owns both)

**Files:** `backend/app/services/handoff.py`, `backend/app/services/scheduler.py`

- [ ] **Step 1:** Implement `run_handoff(db, batch)`:
```python
from app.services.messaging import get_batch_photo
from app.services.grading import simulate_decay, grade
from app.services.routing import decide_route, compute_payout
def run_handoff(db, batch):
    photo = get_batch_photo(batch)
    # The handoff ALWAYS re-grades (real second grade). The decay flag only
    # controls whether the image is degraded first — so a decay-flagged batch
    # gets grade(simulate_decay(photo)) and reads lower; a normal batch gets
    # grade(photo) and should hold its farm grade.
    img = simulate_decay(photo) if batch.decay_on_handoff else photo
    result = grade(img)                       # {"grade":..,"reason":..}
    batch.handoff_grade = result["grade"]; batch.grade_reason_handoff = result["reason"]
    transition(db, batch, State.GRADED_HANDOFF, handoff_grade=result["grade"])
    decision = decide_route(db, batch, result["grade"], batch.contract, all_buyers(db))
    payout = compute_payout(db, batch, decision.to_destination, price_for(decision))
    justification = justify(decision, payout)          # Task 6
    send_farmer_update(batch.farmer.telegram_chat_id,
        {"crop": batch.crop, "handoff_grade": result["grade"],
         "payout_was": ..., "payout_now": payout.amount,
         "market_category": payout.market_category})
```
- [ ] **Step 2:** Implement `services/scheduler.py`: a background asyncio task that, after SHIPPED, `await asyncio.sleep(8)` (demo pacing — spec §impl) then calls `run_handoff`. Start it on app startup (`@app.on_event("startup")`) reading SHIPPED batches with no handoff yet.
- [ ] **Step 3:** Test `run_handoff` end-to-end with mocked `grade`/`send_farmer_update`: a decay-flagged batch ends at DELIVERED_SECONDARY with a recomputed payout and a RoutingDecision row. Run → PASS. Commit: `feat(orch): handoff step + scheduler`.

---

## Task 6: Justification LLM + remaining endpoints

**Files:** `backend/app/services/justify.py`, `backend/app/routers/{offers,pickups,batches,payouts}.py`

- [ ] **Step 1:** Implement `justify(decision, payout) -> str` — one `httpx` call to the justification model with the structured `{reason_code, crop, farm_grade, handoff_grade, market_category, payout_was, payout_now}` and the fixed prompt (see [PROMPTS.md](../../../../PROMPTS.md)). Return text. Store on `RoutingDecision.claude_justification`.
- [ ] **Step 2:** Implement `GET /offers` (`require_buyer(secondary)`) → batches rerouted to secondary buyers; `GET /pickups` (`require_composter`) → composted batches; `POST /batches/{id}/dispute` (`require_buyer(premium)`, owns) → `delivered→disputed`; `GET /payouts` (`require_admin`); `GET /batches` (`require_admin`, replace stub).
- [ ] **Step 3:** Test the dispute transition + that offers/pickups scope correctly. Commit: `feat(orch): justification LLM + offers/pickups/dispute/payouts endpoints`.

---

## Task 7: Wire the route-disruption demo anomaly

- [ ] **Step 1:** In the scheduler or a demo endpoint, support flipping the seeded route's `washed_out=True` mid-demo: when `run_handoff`/`decide_route` sees the primary route closed, it takes the `route_disruption` branch to the fallback composter (2nd in seed). Add a small `POST /admin/demo/route-disruption` (`require_admin`) toggle to trigger it live during the pitch.
- [ ] **Step 2:** Test: trigger the toggle on an en-route waste batch → batch reroutes to fallback composter, `reason_code=route_disruption`, payout recomputed. Commit: `feat(orch): route-disruption demo toggle`.

## Definition of Done

- [ ] Full cascade runs: `pooled→contracted→shipped→(sleep)→graded_handoff(decay)→rerouted→delivered_secondary→paid`
- [ ] Both anomalies work (transit decay + route disruption to fallback composter)
- [ ] Payouts correct (farmer re-priced; contract fulfillment recomputed; compost = explicit $0)
- [ ] `market_category` on every payout; no destination on any farmer-facing path
- [ ] Justification text generated + logged; farmer messaged
- [ ] PR to `main`

## Critical reminders

- **You are the only slice that writes `RoutingDecision`, `Payout`, or transitions past SHIPPED.** Own it cleanly.
- `batch.status` still only changes via `transition()` — never assign it directly.
- The handoff step touches three slices (B photo, C grade, D route) — you own the orchestration of all three; the seams (`get_batch_photo`, `grade`, `simulate_decay`, `send_farmer_update`) must match the other plans' signatures exactly.
- Keep the scheduler sleep short (~8s) so the demo cascade plays in ~3 min, not 20.
