/**
 * `stores/sseStore.ts` — owns the live-stream connection lifecycle
 * (`lib/sse.ts#connectStream`) and fans incoming messages out to whichever
 * other stores care (today: `batchesStore` for "audit" events).
 *
 * Kept separate from `batchesStore` so the `/admin` cascade view can show
 * connection status (connected/error) independently of batch data, and so
 * other future consumers (a raw event-log pane, a payout ticker) can read
 * `events` without owning the connection themselves.
 */

import { create } from "zustand";
import { connectStream, type StreamHandle, type StreamMessage } from "@/lib/sse";
import { useBatchesStore } from "./batchesStore";

export type ConnectionStatus = "idle" | "connecting" | "open" | "error" | "closed";

interface SseState {
  status: ConnectionStatus;
  events: StreamMessage[];
  /** Open the stream (idempotent — a second call while open/connecting is a no-op). */
  connect: () => void;
  /** Close the stream and reset status to "closed". */
  disconnect: () => void;
}

let handle: StreamHandle | null = null;

export const useSseStore = create<SseState>((set, get) => ({
  status: "idle",
  events: [],

  connect: () => {
    if (get().status === "open" || get().status === "connecting") return;
    set({ status: "connecting" });

    handle = connectStream(
      (message: StreamMessage) => {
        set((state) => ({
          status: "open",
          // Cap the in-memory log so a long-running admin session doesn't
          // grow unbounded; the last 200 events is plenty for the timeline.
          events: [...state.events, message].slice(-200),
        }));

        if (message.event === "audit") {
          useBatchesStore.getState().applyAuditEvent(message.payload);
        }
      },
      () => set({ status: "error" })
    );
  },

  disconnect: () => {
    handle?.close();
    handle = null;
    set({ status: "closed" });
  },
}));
