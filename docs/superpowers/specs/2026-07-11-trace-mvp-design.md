# Project TRACE — MVP Design

**Status:** Approved for implementation planning
**Date:** 2026-07-11
**Build horizon:** One day to a demoable MVP; spec written so the production system (the original 7-agent diagram) is a credible roadmap, not a dead end.

---

## 1. Purpose & the differentiator

TRACE is an agentic supply-chain orchestration engine that turns fragmented Caribbean smallholder harvests into a reliable, enterprise-grade supply source for premium buyers (resorts, hotels, supermarkets, restaurants), while never wasting a harvest that falls short of top grade.

**The twist that the whole pitch rests on:** most systems assume spoilage happens at the farm. TRACE proves — and tracks — that it usually happens in the **gap between farm and buyer**, and it **self-heals around that decay automatically, in real time, without a human re-routing anything by hand**.

The MVP must make this claim visible and defensible: a batch is graded at the farm, again at handoff, and if it decayed in transit the system detects the grade change and reroutes it (premium → secondary → compost) with recalculated payouts and a human-readable reason — no manual intervention.

---

## 2. What we are building vs. deferring

| In the MVP (today) | Deferred to roadmap (credible upgrades) |
|---|---|
| FastAPI monolith, plain Python modules | LangGraph orchestration |
| Vision-LLM grader (OpenRouter, temp 0, fixed prompt) | YOLOv8 + vLLM (GPU) |
| Straight-line lat/lng distance | PostGIS routing |
| `AuditEvent` append-only log (visible timeline) | Hash-chained provenance ledger |
| Deterministic rules engine for all decisions | Autonomous LLM agents for non-money decisions |
| Deterministic single-crop seed scenario | Planning Agent (demand-led, long-horizon planting) |
| Single demo geography | Multi-island + real fleet scheduling |

The MVP is the honest ancestor of the production diagram, not a throwaway prototype.

---

## 3. Stack

| Layer | Choice | Notes |
|---|---|---|
| Backend | **FastAPI** (Python), deployed to **Railway** | One process: Telegram webhook, grading, rules engine, payouts, SSE. Plain modules, not microservices. |
| Database | **PostgreSQL** everywhere (local + Railway) | One engine, no SQLite↔Postgres migration risk. ORM via SQLAlchemy. |
| Real-time | **Server-Sent Events (SSE)** | FastAPI pushes every state change; frontend subscribes via `EventSource`. |
| Messaging | **Telegram Bot API** → webhook into FastAPI | Conversation channel only. Chosen over WhatsApp Sandbox for the demo: no per-recipient approval, no 24-hour customer-service window, no template-message rules — anyone (including a judge) can message the bot instantly. Photos still go through the `/capture` web link, not chat. |
| Grading | **Vision LLM via OpenRouter** | Temp 0, identical prompt every image. Any model behind one interface. |
| Routing logic | **Plain Python rules engine** | Deterministic. |
| Justification text | **One Claude/GPT call** per routing decision | Structured in, text out. The "Golden Prompt" deliverable. |
| Frontend | **Decided by frontend team member** | See §4. Not locked to a framework. |

**Frontend constraint (firm):** whatever framework is chosen, it must (a) be a separate deploy consuming the FastAPI REST + SSE API, (b) render the web role surfaces — **Admin, Premium buyer, Secondary buyer, Composter** (farmers are Telegram-only; see §4a) — and (c) host the `/capture/[token]` photo-upload page. The backend contract is framework-agnostic.

---

## 4. Farmer intake — the one friction rule

**Telegram carries the conversation. A single web link carries the camera. That link is the only deliberate friction point, and it is universal for every farmer.**

- The farmer does **not** attach photos in Telegram. Ever. No chat-media plumbing.
- Flow: farmer messages the bot → bot replies with a one-tap camera link carrying a token → the link opens the phone browser to `/capture/[token]` (no app, no login) → farmer photographs the batch with a coin in frame → uploads straight to the backend → bot replies in Telegram with the grade, then later with shipment/payout/reroute updates.
- The `/capture/[token]` page is the **single, universal photo intake** — used by every farmer.
- There is **no farmer web dashboard.** Farmers interact with TRACE exclusively through Telegram — the demand feed, their batch grades, and their payouts all arrive as Telegram messages. The only web surface a farmer ever touches is the `/capture/[token]` camera link. (The web UI is for admins and customers only; see §4a.)

Pitch line this enables: *"A farmer with a basic phone and Telegram can move a harvest to market — no app, no login."*

---

## 4a. Visibility & data-flow boundaries (who sees what)

**Contracts are a backend concept.** They are *not* surfaced to farmers. The system routes farmer output to contracts internally (aggregation, §10); the farmer never learns which contract or buyer their batch fulfilled. This mirrors real agricultural markets: farmers respond to **market demand**, not individual purchase orders, and it protects buyer relationships.

- **Farmer (Telegram only — no web UI):** everything reaches the farmer as Telegram messages — the **demand feed** (an anonymized, aggregated projection of open contracts: crop + grade + rough quantity + urgency — *no buyer name, no price, no contract id*), their own batch grades, and payouts shown as **amount + grade + buyer-type category** (e.g. "premium market" / "secondary market" / "composted" — the *category*, never the specific buyer). The reroute/payout messages are **grade + outcome + category-framed**, never naming a destination (e.g. *"your tomatoes dropped to Grade B in transit, so they sold at the Grade B price to the secondary market — $5.10 instead of $12.40. Still sold, nothing wasted."*). There is **no `/farmer` web route** — farmers never touch the web UI except the one-tap `/capture/[token]` camera link.
- **Premium buyer sees (web):** *their own* contract only, framed in **grade + produce** terms ("your Grade A tomato contract is 78% fulfilled"), not farmers' identities.
- **Secondary buyer / composter see (web):** incoming offers/pickups (grade + kg + price), no contract.
- **Admin / operator sees (web):** everything including contracts — this is the internal/operator view for running the platform.

The demand feed is derived (Slice D) from open contracts and is also the natural input to the roadmap Planning Agent.

---

## 5. Architecture

```
💬 TELEGRAM Bot API — conversation only
   farmer messages the bot
        │ webhook
        ▼
┌─────────────────────────────────────────────────────────────┐
│  FASTAPI BACKEND (Railway) — plain modules                   │
│                                                              │
│  Intake → Capture ← /capture/[token] uploads photos         │
│  Grade  → OpenRouter vision LLM (temp 0, fixed USDA prompt)  │
│  Aggregate → pool by crop+grade+geo → Virtual Shipment       │
│  Contract → match to Premium Buyer demand; HITL confirm      │
│  Ship    → assign Route; start spoilage clock                │
│  ★ Decay sim → bakes image degradation between the two grades│
│  Re-grade → same LLM call on the degraded handoff image      │
│  Reroute → deterministic rules engine; Claude writes reason  │
│  Payout  → recompute at delivered grade × destination price  │
│                                                              │
│  PostgreSQL  ◆── SSE ──► live state changes to dashboards    │
└─────────────────────────────────────────────────────────────┘
        │ REST + SSE
        ▼
 FRONTEND (framework TBD) — Vercel or equivalent
   /capture/[token]  ★ the one photo upload surface (farmer reaches via Telegram link)
   /admin            ★ operator pitch-hero view (cascade + provenance)
   /premium-buyer    (resort/hotel/supermarket/restaurant — own contract)
   /secondary-buyer  (school feeding / discount market — incoming offers)
   /composter        (waste pickups)
   (no /farmer route — farmers are Telegram-only: see §4a)
```

The ★-marked decay loop is the differentiator: simulated in transit, detected by a real second grade on a degraded image, self-healed by the deterministic rules engine.

---

## 6. Data model

The atom is a **Batch**. It is created at intent, graded twice, lives inside a **Virtual Shipment**, and ends at one destination with a payout.

- **Farmer** — id, name, telegram_chat_id, lat/lng. (trust score: roadmap)
- **Buyer** — id, name, type (`premium | secondary | composter`), lat/lng, demand (crop, grade, kg, price/kg), capacity.
- **Contract** — id, premium buyer, crop, grade, kg target, price/kg, deadline, status (`open | fulfilling | fulfilled | short`).
- **Batch** — id, farmer, crop, kg, lat/lng, status (state machine, §7), `farm_grade`, `handoff_grade`, `final_grade`, `decay_event` (nullable), photo refs, `grade_reason_farm`, `grade_reason_handoff`.
- **VirtualShipment** — id, contract, member batches with each one's `%` contribution, total kg, status.
- **Route** — id, ordered pickups → handoff point → buyer, assigned batch ids, returning-leg capacity (for waste→composter).
- **RoutingDecision** — id, batch, `from_destination`, `to_destination`, `reason_code` (`transit_decay | route_disruption | quality_mismatch`), `claude_justification`, timestamp.
- **Payout** — id, farmer, batch, `grade_paid_at`, destination, kg, amount, status (`held | released`).
- **AuditEvent** — id, batch, event type, timestamp, payload. Append-only log rendered as the admin "provenance timeline."

**Deliberate choices:**
- Two grade fields on Batch (`farm_grade`, `handoff_grade`) so the decay delta is queryable and visualizable — this is the pitch's evidence.
- `%` contribution lives on the VirtualShipment↔Batch link, so a reroute recomputes the remaining batches' percentages and the contract's fulfillment cleanly.
- `RoutingDecision` is its own table: every reroute is a recorded, justified event.
- No separate provenance-ledger table in the MVP — `AuditEvent` gives the visible timeline. The hash-chained ledger is roadmap.

---

## 7. The Batch state machine (single source of truth)

One machine governs a batch's lifecycle. Every transition is a guarded, logged, SSE-emitting function. Illegal transitions raise. The reroute is a **branch inside the machine**, not a separate system — that is what makes it "self-healing."

**States:**
`HARVESTED · GRADED_FARM · POOLED · CONTRACTED · SHIPPED · GRADED_HANDOFF · REROUTED · DELIVERED · DELIVERED_SECONDARY · COMPOSTED · PAID · DISPUTED · LOST`

**Transitions (named, guarded):**
`harvested→graded_farm` (after photo+coin uploaded) · `graded_farm→pooled` · `pooled→contracted` (HITL: buyer confirms) · `contracted→shipped` · `shipped→graded_handoff` · `graded_handoff→delivered` (grade unchanged) · `graded_handoff→rerouted` (downgraded) · `graded_handoff→composted` (true waste) · `rerouted→delivered_secondary` · `delivered→paid` / `delivered_secondary→paid` (payout released) · `composted→paid` (zero-amount payout released, closes the loop) · `delivered→disputed` (HITL: buyer quality mismatch) · `→lost` (no pickup/composter capacity or past spoilage window).

**Rules:**
- A batch is always in exactly one state.
- Payout is **held** from `CONTRACTED`, **released** at `DELIVERED` / `DELIVERED_SECONDARY`.
- `DISPUTED` is the only other HITL transition besides `CONTRACTED`.
- There is **no grading audit queue / no confidence state** — HITL lives only at contracts + disputes.

**Implementation:** a small explicit transition table + guard functions (no heavy library), so it is readable and demo-explainable. (Roadmap: this plain machine is the direct ancestor of the LangGraph version.)

---

## 8. Grading

**One OpenRouter vision-LLM call per grade, identical for the farm pass and the handoff pass.**

- **Provider:** OpenRouter (any vision model — Claude / GPT-4o / Gemini — behind one interface).
- **Temperature: 0** for determinism.
- **Prompt:** one fixed string, every image. Per-crop config supplies the crop name and expected size range; for the MVP demo the crop is **tomato only**.
- **Output:** `{"grade": "A" | "B" | "WASTE", "reason": "one short sentence citing the deciding USDA factor"}`.
- **No confidence score.** No tie-breaker branch. No grading audit queue.

### 8.1 The grading standard = USDA Fresh Tomato standards

Because the prompt is fixed and temp is 0, **the prompt is the standard.** It is anchored to the real USDA *United States Standards for Grades of Fresh Tomatoes* (§51.1855–51.1859) so the grades are defensible, not invented.

| TRACE | USDA anchor | USDA language (abridged) | Sells to |
|---|---|---|---|
| **A** | U.S. No. 1 (§51.1855) | mature, not overripe/soft, fairly well formed & smooth, fairly uniform red, free from *damage* (decay, bruising, cuts, growth cracks, disease) | Premium buyer |
| **B** | U.S. No. 2 (§51.1857) | same basics, more tolerant shape/smoothness, free from *serious damage* (higher defect bar) — still sound & edible | Secondary buyer |
| **Waste** | cull / below U.S. No. 3 | decay, freezing injury, sunscald, or damage beyond No. 2 tolerance — unsellable | Composter |

The **A↔B boundary is USDA's "damage vs serious damage" distinction** — a real boundary, not an invented one. The prompt names the USDA standard and the §-sections explicitly, so a judge asking "where did your grades come from?" gets pointed at §51.1855.

### 8.2 The fixed prompt (Golden Prompt — grading variant)

> You are a produce quality grader following the USDA United States Standards for Grades of Fresh Tomatoes (§51.1855–1859). A coin is in the frame as a size reference. Grade this batch of tomatoes by the USDA definitions, using visible **SIZE** (vs the coin), **MATURITY** (color/ripeness), and **DEFECTS** (cuts, bruising, growth cracks, soft/wrinkled spots, decay, mold):
>
> - **A** = U.S. No. 1 — fairly uniform ripe color, ~free from damage
> - **B** = U.S. No. 2 — tolerable defects, free from *serious* damage
> - **WASTE** = below No. 2 — decay / severe damage / unsellable
>
> Reply ONLY: `{"grade":"A"|"B"|"WASTE", "reason":"one sentence citing the USDA deciding factor"}`

### 8.3 How decay is detected (image-level)

The transit-decay simulator operates on **image pixels**, not on a score. At handoff the simulator derives the handoff image from the **original farm photo** (there is no second photo upload in the MVP — the `/capture` flow runs once, at the farm) and bakes degradation into it with PIL: darkening / browning of the produce region and soft-spot / wrinkle artifacts. The same prompt, same model, temp 0 then genuinely re-grades the worse-looking photo lower.

**Honesty note (important for the pitch):** in a one-day demo there is no real transit, so the *decay itself is simulated*. What is **not** simulated is the detection: the LLM genuinely reads the degraded photo as a lower grade — the same mechanism that would catch real transit spoilage from a true handoff photo in production. Pitch this precisely: *"we simulate the decay because there's no real truck in a demo, but the detection, reroute, and repricing are all real and would fire unchanged on a genuine spoiled-handoff photo."* Do **not** claim the demo catch is "honest spoilage" — it is honest *detection* of simulated spoilage. (Roadmap: a real second capture at the aggregation point replaces the simulator with no other code changes.)

Farm pass: `original photo → LLM → {grade: A, "uniform ripe, no damage"}`
Handoff pass: `degraded copy of the same photo → LLM → {grade: B, "moderate blemishing, uneven color"}`

---

## 9. "Agents" — how we build and frame them

**In the MVP there are no autonomous LLM agents.** Grading, aggregation, routing, and payout are **deterministic Python functions** driven by the state machine and the rules engine.

There are exactly **two LLM surfaces**, both tightly scoped, and **neither moves money autonomously**:

1. **Vision grader** (OpenRouter, §8) — produces a grade + reason. Disambiguates quality; does not decide payouts or routes.
2. **Routing justification** (Claude/GPT) — turns a structured `RoutingDecision` into the justification text (audit trail) and the farmer's Telegram message. The rules engine has already decided the destination; the LLM only explains it.

**Pitch framing:** the system is described with the "agent" *naming* from the original diagram (Intake, Grading, Aggregation, Contract, Routing, Payout) because it is evocative and maps to the roadmap — but we are precise that these are **deterministic components orchestrated by one state machine, not autonomous LLMs**. The strongest Q&A defense this gives: *"The LLM never reroutes food or reprices a payout. A deterministic, reproducible rules engine does. The LLM only writes the explanation a human reads."* Money-moving decisions are auditable and reproducible; only the *wording* varies.

---

## 10. Routing & the self-healing cascade

Pure deterministic Python, keyed off the handoff grade delta and contract/buyer state. No LLM in the decision.

**`decide_route(batch, handoff_grade, contract, buyers)` → `RoutingDecision`:**

```
IF handoff_grade == farm_grade (no decay):
    → stay on route → DELIVERED (premium)

ELIF downgraded A→B (transit decay):
    1. pull batch out of its premium VirtualShipment
    2. recompute remaining batches' % and contract fulfillment
    3. find a secondary buyer with demand + capacity reachable on the
       RETURNING leg (straight-line lat/lng — no PostGIS)
       yes  → REROUTED → DELIVERED_SECONDARY
       none → COMPOSTED (composter on returning leg) or LOST

       (No separate "flash-sale tier" in the MVP — near-spoilage simply
        routes to the same secondary buyer at the secondary price. A
        discounted flash-sale tier is roadmap.)

ELIF handoff_grade == Waste (true spoilage):
    → COMPOSTED if composter capacity on returning leg, else LOST
    → batch feeds back as a demand/capacity signal
```

**Then** the single Claude/GPT call: the rules engine produces `{reason_code, from, to, facts}`; the LLM turns that into the logged justification and the farmer's Telegram message. Structured in, text out.

**Returning-leg fleet:** when assigning a reroute destination, prefer a buyer/composter on (or near) the route's returning leg — the same truck drops premium produce and hauls rerouted/waste back. Straight-line lat/lng is sufficient for the MVP.

---

## 11. Payout math

**Rule:** a batch pays out at **delivered grade × destination price/kg**, held from `CONTRACTED`, released at a terminal state. **Farmer payout is never zero unless the batch is composted (true waste) or lost.**

- Premium contract fulfilled: each farmer gets `their_kg × premium_price/kg`, with their share of the Virtual Shipment's contribution.
- Batch rerouted A→B: that farmer gets `their_kg × secondary_price/kg`. The premium contract is now short by that kg — fulfillment % recomputes and is either backfilled from the remaining A-grade pool or marked short (visible to the buyer).
- True waste → composted: a **zero-amount Payout row is still created and released** (`composted→paid`), so the farmer sees an explicit, explained "$0 — batch spoiled in transit, routed to compost" rather than a silent gap. The batch is logged and feeds back as a demand signal (the pitch's "we proved the loss, we didn't hide it").
- Lost: no Payout row; the batch is logged as `LOST` with a reason.

**Buyer-side money (premium contract):** the buyer's deposit is held per-contract (not per-batch) at confirmation. At fulfillment, the buyer pays only for kg actually delivered at Grade A. If the contract finishes `short` (kg lost to reroutes/waste that couldn't be backfilled), the short portion is **refunded or never charged** — the buyer never pays for produce they didn't receive. The contract status (`fulfilled | short`) drives this, and the buyer dashboard shows the reconciliation. (Escrow/funds movement itself is out of scope for the MVP — the spec models the *obligation*; a payments provider is roadmap.)

---

## 12. Human-in-the-loop

Exactly **two** touchpoints, deliberately scoped:

1. **Contract confirmation** — a human (the premium buyer) confirms the proposed fulfillment plan before batches ship. (Real HITL; blocks the `contracted→shipped` transition.)
2. **Delivery dispute** — when a buyer flags a delivered batch as a quality mismatch, the batch goes to `DISPUTED` for human reconciliation referencing the audit trail. (Real HITL.)
3. *(Grading has no HITL — no audit queue, no confidence gate. The flow never stalls on a human to keep moving.)*

Pitch line: *"It self-heals autonomously — humans only touch the edges: contract sign-off and disputes."*

---

## 13. Demo & seed data

The MVP must demo well **live, recorded, and self-serve via URL.** A deterministic seed script resets PostgreSQL to a known state so the demo is reproducible across all three.

**Seed scenario:**
- **6 farmers** across a small geography, all growing **tomatoes**.
- **1 premium contract:** a resort wants 200 kg Grade A tomatoes by 4 pm.
- **1 secondary buyer:** a school feeding program (Grade B tomatoes).
- **1 composter** on the returning leg.
- **One batch pre-set to decay** the moment it ships, so the full cascade (ship → decay → re-grade → reroute → re-payout → Telegram reason) plays in ~3 minutes.

**Demo requirements:**
- The Admin view shows the cascade live via SSE.
- The farmer's Telegram receives the grade, then the reroute reason.
- The buyer sees their contract fulfillment tick down and back up as the system backfills.
- Labels, empty states, and a clearly-marked "run the demo" path so a stranger poking the URL cold can follow it without narration.

---

## 14. Error handling

- **Grading failure / malformed output:** the LLM is told a coin is in frame by the prompt (there is no separate coin-detection step — we removed OpenCV). If the farmer uploads a photo with no coin, the LLM will typically say so in its `reason`; for the MVP we accept this and do **not** gate on coin presence (no client-side CV check). LLM call failure, rate-limit, or malformed JSON → retry once, then hold the batch at `HARVESTED` with an error event in the audit trail (operator-visible).
- **No secondary buyer / no composter capacity:** batch goes to `LOST`, logged, feeds back as a demand signal.
- **Past spoilage window / no pickup capacity:** `LOST`.
- **Telegram delivery failure:** retried with backoff; never blocks the state machine (the audit trail still records the outcome).
- **SSE disconnect:** the frontend reconnects and re-syncs full batch state from REST on reconnect (SSE is a notification channel, not the source of truth).

---

## 15. Testing strategy

- **State machine:** table-driven tests asserting every legal transition advances and every illegal transition raises.
- **Grading:** golden-file tests on a small set of fixture images (fresh, blemished, decayed) asserting the expected grade; a separate test that the **image-degradation simulator** moves a known-A image to B/Waste.
- **Routing:** unit tests on `decide_route` for each branch (no-decay, A→B, A→Waste, no-capacity) and the returning-leg preference.
- **Payout:** tests that reroute recomputes the farmer's payout and the contract's fulfillment % correctly.
- **Seed scenario:** an end-to-end test that replays the seed and asserts the full cascade reaches the expected terminal states.
- **LLM calls:** mocked in CI; a small live-smoke test against OpenRouter behind a flag.

---

## 16. Roadmap (the "stepping stone" slide)

| MVP (today) | Roadmap upgrade |
|---|---|
| Plain Python state machine | LangGraph orchestration |
| Vision-LLM grader (temp 0) | YOLOv8 + vLLM (GPU) |
| Straight-line lat/lng | PostGIS routing |
| `AuditEvent` append-only log | Hash-chained provenance ledger |
| Deterministic rules for all decisions | Autonomous agents for non-money decisions |
| Deterministic single-crop seed | Planning Agent (demand-led planting) |
| Single demo geography | Multi-island + real fleet scheduling |

---

## 17. Open items (non-blocking)

- **Frontend framework:** to be chosen by the frontend team member. The backend REST + SSE contract is framework-agnostic and fixed by this spec.
- **Specific OpenRouter vision model:** pick the best price/quality at build time; the interface is model-agnostic.
- **Geography specifics:** demo lat/lng values to be chosen during seeding (a representative Caribbean island bounding box).
