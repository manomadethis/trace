/**
 * Mock API: canned data + the live cascade simulation.
 *
 * This is what `lib/api.ts` delegates to when `NEXT_PUBLIC_USE_MOCK=1`
 * (the default). It exists so the whole frontend is demoable before any
 * backend slice lands (see impl spec §6 "Mock API").
 *
 * Shapes here mirror `backend/app/models.py` (Batch/Contract/Payout/
 * AuditEvent) closely enough that swapping to the real API is a data
 * source change, not a UI rewrite — field names match what the real
 * `/contracts/mine` handler already returns, and batch fields match the
 * `Batch` ORM model's columns.
 */

import type {
  AuditEvent,
  Batch,
  Contract,
  Offer,
  Payout,
  Pickup,
  TimelineEntry,
} from "./api";

// ---------------------------------------------------------------------------
// Canned batches
// ---------------------------------------------------------------------------

/**
 * Batch #0412 — the landing-page tracker's reference batch (matches the
 * mockup: Grade A farm / Grade B handoff, "Delivered" status, 4-entry
 * timeline). Reachable by human-friendly number "0412" as well as its id.
 * Parked already-DELIVERED so the tracker has something complete to show
 * without needing the cascade timer to run first.
 */
const batch0412: Batch = {
  id: "0412",
  batchNumber: "0412",
  crop: "Tomatoes",
  kg: 45,
  status: "DELIVERED",
  farmGrade: "A",
  handoffGrade: "B",
  finalGrade: "B",
  farmLocationLabel: "St. Elizabeth Cluster",
  handoffLocationLabel: "Transit Checked",
  decayEvent: null,
  marketCategory: "premium_market",
  createdAt: "2026-06-12T06:00:00Z",
  timeline: [
    { label: "Harvested", timestamp: "2026-06-12T06:00:00Z" },
    { label: "Handoff to Hub", timestamp: "2026-06-12T14:30:00Z" },
    { label: "Quality Check Passed", timestamp: "2026-06-13T09:00:00Z" },
    { label: "Delivered to Buyer", timestamp: "2026-06-14T05:45:00Z" },
  ],
};

/** The cascade demo batch: starts at GRADED_FARM, decays at handoff, reroutes, gets paid. */
const batchCascade: Batch = {
  id: "1001",
  batchNumber: "1001",
  crop: "Tomatoes",
  kg: 30,
  status: "GRADED_FARM",
  farmGrade: "A",
  handoffGrade: null,
  finalGrade: null,
  farmLocationLabel: "Farm Alpha, Kingston",
  handoffLocationLabel: null,
  decayEvent: null,
  marketCategory: null,
  createdAt: "2026-07-11T06:00:00Z",
  timeline: [{ label: "Harvested", timestamp: "2026-07-11T06:00:00Z" }],
};

/** Second cascade batch: exercises the route-disruption anomaly instead of decay. */
const batchDisruption: Batch = {
  id: "1002",
  batchNumber: "1002",
  crop: "Tomatoes",
  kg: 22,
  status: "GRADED_FARM",
  farmGrade: "A",
  handoffGrade: null,
  finalGrade: null,
  farmLocationLabel: "Farm Bravo, Kingston",
  handoffLocationLabel: null,
  decayEvent: null,
  marketCategory: null,
  createdAt: "2026-07-11T06:05:00Z",
  timeline: [{ label: "Harvested", timestamp: "2026-07-11T06:05:00Z" }],
};

const initialBatches: Batch[] = [batch0412, batchCascade, batchDisruption];

// ---------------------------------------------------------------------------
// Canned contracts / offers / pickups / payouts
// ---------------------------------------------------------------------------

const contracts: Contract[] = [
  {
    id: "1",
    crop: "tomato",
    grade: "A",
    kgTarget: 200,
    status: "fulfilling",
  },
];

const offers: Offer[] = [
  { id: "1", crop: "tomato", grade: "B", kg: 30, pricePerKg: 2.0 },
];

const pickups: Pickup[] = [
  { id: "1", crop: "tomato", kg: 22, etaMinutes: 45 },
];

let payouts: Payout[] = [];

// ---------------------------------------------------------------------------
// Mutable mock "DB" + audit log
// ---------------------------------------------------------------------------

let batches: Batch[] = initialBatches.map((b) => ({ ...b, timeline: [...b.timeline] }));
const auditLog: AuditEvent[] = [];

export function getMockBatches(): Batch[] {
  return batches;
}

export function getMockBatch(idOrNumber: string): Batch | null {
  return (
    batches.find((b) => b.id === idOrNumber || b.batchNumber === idOrNumber) ?? null
  );
}

export function getMockContracts(): Contract[] {
  return contracts;
}

export function getMockOffers(): Offer[] {
  return offers;
}

export function getMockPickups(): Pickup[] {
  return pickups;
}

export function getMockPayouts(): Payout[] {
  return payouts;
}

// ---------------------------------------------------------------------------
// Mock SSE-style event stream
// ---------------------------------------------------------------------------

export type MockEvent = { event: string; payload: Record<string, unknown> };
type MockListener = (msg: MockEvent) => void;

const listeners = new Set<MockListener>();

/** Subscribe to the mock event stream. Returns an unsubscribe function. */
export function subscribeMock(listener: MockListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(event: string, payload: Record<string, unknown>): void {
  const msg: MockEvent = { event, payload };
  for (const listener of listeners) listener(msg);
}

function updateBatch(id: string, patch: Partial<Batch>, timelineEntry?: TimelineEntry): Batch {
  batches = batches.map((b) => {
    if (b.id !== id) return b;
    const next: Batch = { ...b, ...patch };
    if (timelineEntry) next.timeline = [...b.timeline, timelineEntry];
    return next;
  });
  const updated = batches.find((b) => b.id === id)!;
  return updated;
}

function logAndEmit(batchId: string, eventType: string, payload: Record<string, unknown>): void {
  const entry: AuditEvent = {
    id: String(auditLog.length + 1),
    batchId,
    eventType,
    payload,
    createdAt: new Date().toISOString(),
  };
  auditLog.push(entry);
  emit("audit", { batchId, eventType, payload, createdAt: entry.createdAt });
}

export function getMockAuditLog(): AuditEvent[] {
  return auditLog;
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Step timings for the cascade (ms). Sums to well under 30s so a human (or
 * a test with a short timeout) can watch the whole thing play through, per
 * the brief's "verify the cascade plays over ~30s" requirement.
 */
const STEP_MS = 3000;

let cascadeRunning = false;

/**
 * Walk `batchCascade` through the full happy-path-with-decay lifecycle:
 * graded_farm -> pooled -> contracted -> shipped -> graded_handoff(decay)
 * -> rerouted -> delivered_secondary -> paid, emitting an SSE-style
 * "audit" event (mirroring the real `log_audit` shape) at each step.
 *
 * Concurrently walks `batchDisruption` through a shorter path that models
 * the route-disruption anomaly: graded_farm -> pooled -> contracted ->
 * shipped -> graded_handoff (grade holds, no decay) -> rerouted (for
 * disruption, not quality) -> delivered_secondary -> paid.
 *
 * Idempotent: calling it while already running is a no-op (returns the
 * existing run's promise timing isn't tracked, but re-entrancy is guarded).
 */
export async function playCascade(): Promise<void> {
  if (cascadeRunning) return;
  cascadeRunning = true;
  try {
    await Promise.all([runDecayCascade(), runDisruptionCascade()]);
  } finally {
    cascadeRunning = false;
  }
}

async function runDecayCascade(): Promise<void> {
  const id = batchCascade.id;

  await wait(STEP_MS);
  updateBatch(id, { status: "POOLED" }, { label: "Pooled with cluster", timestamp: now() });
  logAndEmit(id, "transition:POOLED", { from: "GRADED_FARM", to: "POOLED" });

  await wait(STEP_MS);
  updateBatch(
    id,
    { status: "CONTRACTED" },
    { label: "Contracted to SeaBreeze Resort", timestamp: now() }
  );
  logAndEmit(id, "transition:CONTRACTED", { from: "POOLED", to: "CONTRACTED", contract_id: "1" });

  await wait(STEP_MS);
  updateBatch(id, { status: "SHIPPED" }, { label: "Shipped for handoff", timestamp: now() });
  logAndEmit(id, "transition:SHIPPED", { from: "CONTRACTED", to: "SHIPPED", route_id: "1" });

  await wait(STEP_MS);
  updateBatch(
    id,
    { status: "GRADED_HANDOFF", handoffGrade: "B", decayEvent: "transit_decay" },
    { label: "Handoff re-grade: decayed to B", timestamp: now() }
  );
  logAndEmit(id, "transition:GRADED_HANDOFF", {
    from: "SHIPPED",
    to: "GRADED_HANDOFF",
    handoff_grade: "B",
    decay_event: "transit_decay",
  });

  await wait(STEP_MS);
  updateBatch(
    id,
    { status: "REROUTED", marketCategory: "secondary_market" },
    { label: "Rerouted to secondary market (quality mismatch)", timestamp: now() }
  );
  logAndEmit(id, "transition:REROUTED", {
    from: "GRADED_HANDOFF",
    to: "REROUTED",
    reason_code: "quality_mismatch",
    market_category: "secondary_market",
  });

  await wait(STEP_MS);
  updateBatch(
    id,
    { status: "DELIVERED_SECONDARY" },
    { label: "Delivered to secondary buyer", timestamp: now() }
  );
  logAndEmit(id, "transition:DELIVERED_SECONDARY", {
    from: "REROUTED",
    to: "DELIVERED_SECONDARY",
  });

  await wait(STEP_MS);
  updateBatch(id, { status: "PAID" }, { label: "Payout released", timestamp: now() });
  const payout: Payout = {
    id: `payout-${id}`,
    batchId: id,
    kg: batchCascade.kg,
    amount: batchCascade.kg * 2.0,
    marketCategory: "secondary_market",
    status: "released",
  };
  payouts = [...payouts, payout];
  logAndEmit(id, "transition:PAID", { from: "DELIVERED_SECONDARY", to: "PAID" });
  emit("payout", { ...payout });
}

async function runDisruptionCascade(): Promise<void> {
  const id = batchDisruption.id;

  await wait(STEP_MS * 1.2);
  updateBatch(id, { status: "POOLED" }, { label: "Pooled with cluster", timestamp: now() });
  logAndEmit(id, "transition:POOLED", { from: "GRADED_FARM", to: "POOLED" });

  await wait(STEP_MS);
  updateBatch(
    id,
    { status: "CONTRACTED" },
    { label: "Contracted to SeaBreeze Resort", timestamp: now() }
  );
  logAndEmit(id, "transition:CONTRACTED", { from: "POOLED", to: "CONTRACTED", contract_id: "1" });

  await wait(STEP_MS);
  updateBatch(id, { status: "SHIPPED" }, { label: "Shipped for handoff", timestamp: now() });
  logAndEmit(id, "transition:SHIPPED", { from: "CONTRACTED", to: "SHIPPED", route_id: "1" });

  await wait(STEP_MS);
  updateBatch(
    id,
    { status: "GRADED_HANDOFF", handoffGrade: "A" },
    { label: "Handoff re-grade: still A", timestamp: now() }
  );
  logAndEmit(id, "transition:GRADED_HANDOFF", {
    from: "SHIPPED",
    to: "GRADED_HANDOFF",
    handoff_grade: "A",
  });

  await wait(STEP_MS);
  updateBatch(
    id,
    { status: "REROUTED", marketCategory: "secondary_market" },
    { label: "Route disrupted — primary composter unreachable, rerouted", timestamp: now() }
  );
  logAndEmit(id, "transition:REROUTED", {
    from: "GRADED_HANDOFF",
    to: "REROUTED",
    reason_code: "route_disruption",
    market_category: "secondary_market",
  });
  emit("anomaly", { batchId: id, kind: "route_disruption" });

  await wait(STEP_MS);
  updateBatch(
    id,
    { status: "DELIVERED_SECONDARY" },
    { label: "Delivered via fallback route", timestamp: now() }
  );
  logAndEmit(id, "transition:DELIVERED_SECONDARY", {
    from: "REROUTED",
    to: "DELIVERED_SECONDARY",
  });

  await wait(STEP_MS);
  updateBatch(id, { status: "PAID" }, { label: "Payout released", timestamp: now() });
  const payout: Payout = {
    id: `payout-${id}`,
    batchId: id,
    kg: batchDisruption.kg,
    amount: batchDisruption.kg * 2.0,
    marketCategory: "secondary_market",
    status: "released",
  };
  payouts = [...payouts, payout];
  logAndEmit(id, "transition:PAID", { from: "DELIVERED_SECONDARY", to: "PAID" });
  emit("payout", { ...payout });
}

function now(): string {
  return new Date().toISOString();
}

/** Reset all mutable mock state back to its initial snapshot (test/demo "Run demo" reset). */
export function resetMockState(): void {
  batches = initialBatches.map((b) => ({ ...b, timeline: [...b.timeline] }));
  payouts = [];
  auditLog.length = 0;
  cascadeRunning = false;
}
