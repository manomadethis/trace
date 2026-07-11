/**
 * `stores/batchesStore.ts` — holds the batch list rendered by `/admin` (and
 * any other view that needs the live batch board).
 *
 * Populated by an initial `GET /batches` fetch and then kept live by
 * `sseStore`'s "audit" events patching individual batches in place (see
 * `applyAuditEvent`). Kept separate from `sseStore` (connection lifecycle)
 * on purpose: this store only knows about batch data, not how it arrives.
 */

import { create } from "zustand";
import { getBatches, type Batch, type TimelineEntry } from "@/lib/api";

interface AuditPayload {
  batch_id?: string;
  batchId?: string;
  event_type?: string;
  eventType?: string;
  payload?: Record<string, unknown>;
  createdAt?: string;
}

interface BatchesState {
  batches: Batch[];
  loading: boolean;
  error: string | null;
  /** Fetch the initial batch list (mock or real, per `NEXT_PUBLIC_USE_MOCK`). */
  fetchBatches: () => Promise<void>;
  /** Replace/merge a single batch (e.g. after a direct API mutation). */
  upsertBatch: (batch: Batch) => void;
  /** Apply a raw SSE "audit" event's payload to the matching batch in place. */
  applyAuditEvent: (raw: AuditPayload) => void;
  reset: () => void;
}

export const useBatchesStore = create<BatchesState>((set, get) => ({
  batches: [],
  loading: false,
  error: null,

  fetchBatches: async () => {
    set({ loading: true, error: null });
    try {
      const batches = await getBatches();
      set({ batches, loading: false });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : "Failed to load batches",
      });
    }
  },

  upsertBatch: (batch: Batch) => {
    const existing = get().batches;
    const idx = existing.findIndex((b) => b.id === batch.id);
    if (idx === -1) {
      set({ batches: [...existing, batch] });
    } else {
      const next = existing.slice();
      next[idx] = batch;
      set({ batches: next });
    }
  },

  applyAuditEvent: (raw: AuditPayload) => {
    const batchId = raw.batch_id ?? raw.batchId;
    if (!batchId) return;
    const eventType = raw.event_type ?? raw.eventType ?? "";
    const payload = raw.payload ?? {};

    set((state) => ({
      batches: state.batches.map((b) => {
        if (b.id !== batchId) return b;
        return { ...b, ...patchFromEvent(b, eventType, payload, raw.createdAt) };
      }),
    }));
  },

  reset: () => set({ batches: [], loading: false, error: null }),
}));

/**
 * Translate a `transition:<STATE>` audit event's payload into a Batch patch
 * — mirrors the fields `statemachine.transition()` writes to `ctx` on the
 * real backend (`from`, `to`, plus guard-specific keys like `handoff_grade`,
 * `decay_event`, `reason_code`).
 */
function patchFromEvent(
  batch: Batch,
  eventType: string,
  payload: Record<string, unknown>,
  createdAt?: string
): Partial<Batch> {
  const patch: Partial<Batch> = {};

  const to = typeof payload.to === "string" ? payload.to : undefined;
  if (to && eventType.startsWith("transition:")) {
    patch.status = to as Batch["status"];
  }
  if (typeof payload.handoff_grade === "string") {
    patch.handoffGrade = payload.handoff_grade as Batch["handoffGrade"];
  }
  if (typeof payload.decay_event === "string") {
    patch.decayEvent = payload.decay_event;
  }
  if (typeof payload.market_category === "string") {
    patch.marketCategory = payload.market_category as Batch["marketCategory"];
  }

  const label = eventType.startsWith("transition:")
    ? `Transitioned to ${to ?? "?"}`
    : eventType;
  const entry: TimelineEntry = {
    label,
    timestamp: createdAt ?? new Date().toISOString(),
  };
  patch.timeline = [...batch.timeline, entry];

  return patch;
}
