/**
 * `lib/sse.ts` — live event stream wrapper.
 *
 * Real mode opens a browser `EventSource` against `GET /admin/stream`
 * (see `backend/app/routers/admin.py` / `backend/app/events.py`), which
 * emits frames shaped `data: {"event": "audit", "payload": {...}}\n\n`.
 * Mock mode subscribes to the in-memory mock event bus
 * (`lib/mock-api.ts#subscribeMock`) and kicks off `playCascade()` so the
 * stream actually has something to say — no backend, no EventSource, same
 * callback shape either way.
 *
 * Callers (namely `stores/sseStore.ts`) don't need to know which mode is
 * active: `connectStream()` returns a `StreamHandle` with a uniform
 * `close()` regardless of transport.
 */

import { API_BASE_URL, USE_MOCK } from "./api";
import { playCascade, subscribeMock, type MockEvent } from "./mock-api";

export interface StreamMessage {
  event: string;
  payload: Record<string, unknown>;
}

export type StreamListener = (message: StreamMessage) => void;

export interface StreamHandle {
  close(): void;
}

/**
 * Open the admin live stream. In mock mode this also starts `playCascade()`
 * so the very first `connectStream()` call is what kicks off the ~30s demo
 * cascade (matching the brief's "boot the app -> store populates -> cascade
 * plays" verification flow).
 */
export function connectStream(onMessage: StreamListener, onError?: (err: Event) => void): StreamHandle {
  if (USE_MOCK) {
    return connectMockStream(onMessage);
  }
  return connectRealStream(onMessage, onError);
}

function connectRealStream(
  onMessage: StreamListener,
  onError?: (err: Event) => void
): StreamHandle {
  const source = new EventSource(`${API_BASE_URL}/admin/stream`, {
    withCredentials: true,
  });

  source.onmessage = (evt: MessageEvent<string>) => {
    try {
      const parsed = JSON.parse(evt.data) as StreamMessage;
      onMessage(parsed);
    } catch {
      // Malformed frame — drop it rather than crash the stream.
    }
  };

  if (onError) {
    source.onerror = onError;
  }

  return {
    close: () => source.close(),
  };
}

function connectMockStream(onMessage: StreamListener): StreamHandle {
  const unsubscribe = subscribeMock((msg: MockEvent) => {
    onMessage({ event: msg.event, payload: msg.payload });
  });

  // Fire-and-forget: drives the cascade timer. playCascade() is idempotent
  // (a no-op if already running), so multiple connectStream() callers
  // (e.g. re-mounts) never double the cascade speed.
  void playCascade();

  return {
    close: () => unsubscribe(),
  };
}
