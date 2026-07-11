# TRACE Slice A — Frontend & UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Branch: `slice/frontend` off `main` (after Plan 0 lands).
> **Owner:** the frontend person. **You build against a mock API first** — never blocked on backend slices. Swap to real endpoints via an env flag.

**Goal:** Five web surfaces (admins + customers only; **no `/farmer` route**) in Next.js with the Hand-Drawn design system (Tailwind), Mantine for behavior primitives only, Zustand state. The `/admin` view is the pitch-hero live cascade.

**Architecture:** Next.js App Router, separate deploy (Vercel). A `lib/mock-api` replays the cascade over a fake SSE stream so the whole UI is demoable before any backend lands. Tokens handle capture; role sessions handle buyer/admin login. The Hand-Drawn look lives entirely in `components/handdrawn/*` (Tailwind); Mantine only for Modal/Select/DateInput/Notifications.

**Tech Stack:** Next.js (App Router), React, Tailwind CSS, `@mantine/core` + `@mantine/hooks`, Zustand, EventSource (SSE). Fonts: Kalam (700) + Patrick Hand.

**Specs:** [product spec §4a, §4b, §5, §13](../../specs/2026-07-11-trace-mvp-design.md) · [impl spec §4 Slice A, §5, §6](../../specs/2026-07-11-trace-implementation-design.md) · [the Hand-Drawn design system](PITCH.md) (full tokens in the team's design-system doc)

**Time budget:** ~full day. You can start immediately against the mock API — don't wait for backend.

---

## File structure

```
frontend/
  package.json, next.config.mjs, tailwind.config.ts, postcss.config.mjs
  app/
    layout.tsx                     # MantineProvider + Tailwind + Google fonts (Kalam, Patrick Hand)
    globals.css                    # paper-grain background, CSS vars, font imports
    login/page.tsx                 # role login (admin / buyer / composter)
    capture/[token]/page.tsx       # camera upload (no login) — the one friction
    admin/page.tsx                 # pitch-hero: live cascade via SSE + provenance timeline
    premium-buyer/page.tsx         # own contract, grade+produce framed, confirm + dispute
    secondary-buyer/page.tsx       # incoming offers
    composter/page.tsx             # waste pickups
  components/handdrawn/
    Button.tsx Card.tsx Input.tsx Badge.tsx Tape.tsx Thumbtack.tsx
  stores/
    authStore.ts batchesStore.ts sseStore.ts
  lib/
    api.ts mock-api.ts sse.ts tokens.ts
```

---

## Task 1: Scaffold + Hand-Drawn tokens

**Files:** `package.json`, `tailwind.config.ts`, `app/globals.css`, `app/layout.tsx`

- [ ] **Step 1:** `npx create-next-app@latest frontend --ts --app --tailwind` then `npm i @mantine/core @mantine/hooks zustand`.
- [ ] **Step 2:** In `tailwind.config.ts`, centralize tokens: `colors` (paper `#fdfbf7`, pencil `#2d2d2d`, muted `#e5e0d8`, red `#ff4d4d`, blue `#2d5da1`, postit `#fff9c4`); `borderRadius.wobbly = "255px 15px 225px 15px / 15px 225px 15px 255px"`, `wobblyMd` variant; `boxShadow.hard = "4px 4px 0 0 #2d2d2d"`, `hardLg = "8px 8px 0 0 #2d2d2d"`; `fontFamily.kalam` + `patrick`. Add the paper-grain background utility in `globals.css` (`background-image: radial-gradient(#e5e0d8 1px, transparent 1px); background-size: 24px 24px;`).
- [ ] **Step 3:** `layout.tsx`: load Kalam + Patrick Hand via `next/font/google`; wrap children in `<MantineProvider>`; set `<body>` to paper background + Patrick Hand body font + Kalam headings. Verify the page renders with the grain + fonts. Commit: `feat(fe): scaffold + Hand-Drawn tokens centralized`.

---

## Task 2: Hand-Drawn components (`components/handdrawn/*`)

**Files:** `components/handdrawn/{Button,Card,Input,Badge,Tape,Thumbtack}.tsx`

- [ ] **Step 1:** Build `Button` (wobbly radius, `border-[3px]`, white→red hover, hard shadow that reduces on hover, presses flat on active), `Card` (white, wobbly border, optional `decoration="tape"|"tack"`), `Input` (wobbly box, blue focus ring), `Badge` (wobbly, grade colors: A=red, B=blue, Waste=muted). Per the design-system doc exactly. Small rotations (`-rotate-1`/`rotate-1`) on cards.
- [ ] **Step 2:** Visual check: render each on a throwaway page against the paper background. Commit: `feat(fe): Hand-Drawn Button/Card/Input/Badge/Tape/Thumbtack`.

---

## Task 3: Mock API + SSE + Zustand stores

**Files:** `lib/{api.ts,mock-api.ts,sse.ts,tokens.ts}`, `stores/*.ts`

- [ ] **Step 1:** `lib/api.ts`: a thin fetch wrapper reading `NEXT_PUBLIC_API_URL` (real) **or** delegating to `mock-api.ts` when `NEXT_PUBLIC_USE_MOCK=1` (default on, so you're unblocked). All endpoints from impl spec §5.
- [ ] **Step 2:** `lib/mock-api.ts`: canned batches/contracts/payouts + `playCascade()` that, on a timer, walks one batch `graded_farm→pooled→contracted→shipped→graded_handoff(decay)→rerouted→delivered_secondary→paid` emitting events. Include a second mock batch for the route-disruption anomaly.
- [ ] **Step 3:** `lib/sse.ts`: an `EventSource` wrapper for `/admin/stream` (real) that falls back to the mock cascade stream. `stores/batchesStore.ts` + `sseStore.ts` (Zustand) hold state updated by SSE.
- [ ] **Step 4:** Verify: boot the app with mock on → the store populates + the cascade plays over ~30s. Commit: `feat(fe): mock API + SSE + Zustand stores`.

---

## Task 4: Login + `/capture/[token]`

**Files:** `app/login/page.tsx`, `app/capture/[token]/page.tsx`

- [ ] **Step 1:** `login/page.tsx`: Hand-Drawn form → `POST /auth/login` → store session → redirect by role (admin→`/admin`, premium→`/premium-buyer`, secondary→`/secondary-buyer`, composter→`/composter`). In mock mode, accept any of the seed emails.
- [ ] **Step 2:** `capture/[token]/page.tsx`: **no login**. `<input type="file" accept="image/*" capture="environment">` (opens phone camera), coin-in-frame instruction, `POST /capture/{token}` → show the returned `{grade, reason}` in a Hand-Drawn card ("Grade A — off to market! 🎉"). In mock mode, return a canned grade after a short delay. Commit: `feat(fe): role login + token-gated capture page`.

---

## Task 5: `/admin` — the pitch-hero cascade view

**Files:** `app/admin/page.tsx`

- [ ] **Step 1:** Build the live cascade: a board of batch cards (Hand-Drawn, rotated), each showing status, farm_grade → handoff_grade (the decay delta prominent), the reroute arrow, payout, and `market_category`. Subscribe to `sseStore` so cards animate state-to-state in real time. A provenance timeline pane shows `AuditEvent`s.
- [ ] **Step 2:** Make the **dual-purpose fleet visible**: a route diagram where the outbound leg (→ premium buyer) and returning leg (→ secondary/composter) are drawn, and rerouted/waste batches visibly move onto the returning leg. A "Run demo" button triggers the cascade (mock) or resets (real, via a future admin endpoint). A "Simulate route disruption" toggle plays anomaly 2.
- [ ] **Step 3:** Verify the whole cascade plays end-to-end in the mock, both anomalies visible. Commit: `feat(fe): admin pitch-hero cascade + dual-purpose fleet + provenance`.

---

## Task 6: Buyer + composter views

**Files:** `app/{premium-buyer,secondary-buyer,composter}/page.tsx`

- [ ] **Step 1:** `premium-buyer`: **their own contract only** (`GET /contracts/mine`), grade+produce framed ("your Grade A tomato contract: 78% fulfilled"), a confirm button (`POST /contracts/{id}/confirm`), and a dispute action (`POST /batches/{id}/dispute`). No farmer identities.
- [ ] **Step 2:** `secondary-buyer`: incoming reroute offers (`GET /offers`) — grade + kg + price, no contract. `composter`: waste pickups (`GET /pickups`) — kg + ETA on returning leg.
- [ ] **Step 3:** Verify each view against the mock API; confirm no contract/buyer leaks to secondary/composter. Commit: `feat(fe): premium/secondary/composter views`.

---

## Task 7: Swap to real API + a11y/responsive pass

- [ ] **Step 1:** Set `NEXT_PUBLIC_USE_MOCK=0`, point `NEXT_PUBLIC_API_URL` at the Railway backend, verify each view works against real endpoints as they land.
- [ ] **Step 2:** Responsive pass per the design-system doc: touch targets ≥48px, decorative arrows/squiggles `hidden md:block`, wobbly borders preserved on mobile, headings scale `text-4xl md:text-5xl`. Commit: `feat(fe): real-API swap + responsive/a11y pass`.

## Definition of Done

- [ ] All 5 routes render in the Hand-Drawn system, no `/farmer` route exists
- [ ] `/admin` plays both anomalies live via SSE with a visible dual-purpose returning leg
- [ ] Capture page works on a phone (camera, token, grade result)
- [ ] Mock API → real API swap is an env flag, not a rewrite
- [ ] No contract/buyer leaks to secondary/composter views; premium buyer sees only their own contract
- [ ] Deployed (Vercel); PR to `main`

## Critical reminders

- **Mantine only for Modal/Select/DateInput/Notifications.** If you're importing `Button`/`Card`/`Input` from Mantine for visible UI, stop — use `components/handdrawn/*`. Restyle any Mantine primitive you do use (wobbly radius + hard shadow) so it doesn't leak the clinical look.
- **No `/farmer` route.** Farmers are Telegram-only. If you find yourself building a farmer dashboard, you're off-spec.
- The mock API is your superpower — you can demo the entire UI today, before any backend exists. Prioritize `/admin` (the pitch hero) first; the buyer/composter views are polish.
- The `market_category` field is what you render for buyers/farmer-facing text — never display a raw destination or buyer name in any farmer-visible path (there are none here, but the discipline holds).
