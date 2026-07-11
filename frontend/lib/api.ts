/**
 * `lib/api.ts` — the single data-layer seam every page/store imports.
 *
 * A thin fetch wrapper over the real FastAPI backend (`NEXT_PUBLIC_API_URL`)
 * that transparently delegates to `lib/mock-api.ts` when
 * `NEXT_PUBLIC_USE_MOCK` is unset or `"1"` (mock is the default, so the
 * frontend is never blocked on a backend slice landing — impl spec §6).
 *
 * Every exported function here has a stable signature that later tasks
 * (login, capture, admin cascade, buyer views) code against — swapping mock
 * for real is meant to be an env-flag flip, not a rewrite (Task 7).
 *
 * Endpoint coverage mirrors impl spec §5 / `backend/app/routers/*.py`:
 *   POST /auth/login            -> login()
 *   GET  /admin/stream          -> lib/sse.ts (not here; see that file)
 *   GET  /batches               -> getBatches()   [admin-only, real backend]
 *   (no public per-batch endpoint — see getBatch() doc below)
 *   GET  /contracts             -> getContracts()          [admin-only]
 *   GET  /contracts/mine        -> getMyContracts()        [premium buyer]
 *   POST /contracts/{id}/confirm -> confirmContract()
 *   POST /batches/{id}/dispute  -> disputeBatch()
 *   GET  /offers                -> getOffers()             [secondary buyer]
 *   GET  /pickups                -> getPickups()            [composter]
 *   GET  /payouts                -> getPayouts()            [admin-only]
 *   POST /capture/{token}       -> uploadCapture()
 *   GET  /demand                 -> getDemand()             [admin-only]
 */

import {
  getMockAuditLog,
  getMockBatch,
  getMockBatches,
  getMockContracts,
  getMockOffers,
  getMockPayouts,
  getMockPickups,
} from "./mock-api";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export type UserRole = "admin" | "premium_buyer" | "secondary_buyer" | "composter";

export type BatchStatus =
  | "HARVESTED"
  | "GRADED_FARM"
  | "POOLED"
  | "CONTRACTED"
  | "SHIPPED"
  | "GRADED_HANDOFF"
  | "REROUTED"
  | "DELIVERED"
  | "DELIVERED_SECONDARY"
  | "COMPOSTED"
  | "PAID"
  | "DISPUTED"
  | "LOST";

export type Grade = "A" | "B" | "Waste";

export type MarketCategory = "premium_market" | "secondary_market" | "composted";

export interface TimelineEntry {
  label: string;
  timestamp: string; // ISO 8601
}

export interface Batch {
  id: string;
  /** Human-friendly lookup key shown to farmers/buyers (e.g. "0412"). Mock-only concept today. */
  batchNumber: string;
  crop: string;
  kg: number;
  status: BatchStatus;
  farmGrade: Grade | null;
  handoffGrade: Grade | null;
  finalGrade: Grade | null;
  farmLocationLabel: string | null;
  handoffLocationLabel: string | null;
  decayEvent: string | null;
  marketCategory: MarketCategory | null;
  createdAt: string;
  timeline: TimelineEntry[];
}

export interface Contract {
  id: string;
  crop: string;
  grade: string;
  kgTarget: number;
  status: "open" | "fulfilling" | "fulfilled" | "short";
}

export interface Offer {
  id: string;
  crop: string;
  grade: string;
  kg: number;
  pricePerKg: number;
}

export interface Pickup {
  id: string;
  crop: string;
  kg: number;
  etaMinutes: number;
}

export interface Payout {
  id: string;
  batchId: string;
  kg: number;
  amount: number;
  marketCategory: MarketCategory;
  status: "held" | "released";
}

export interface AuditEvent {
  id: string;
  batchId: string | null;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface DemandRow {
  crop: string;
  grade: string;
  qtyBand: string;
  urgency: string;
}

export interface LoginResult {
  role: UserRole;
}

export interface CaptureResult {
  grade: Grade;
  reason: string;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

/** Mock mode is the default (unblocked frontend dev) — explicit "0" opts out. */
export const USE_MOCK = process.env.NEXT_PUBLIC_USE_MOCK !== "0";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    credentials: "include", // real backend auth is an httpOnly session cookie
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText);
    throw new ApiError(detail || res.statusText, res.status);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export async function login(email: string, password: string): Promise<LoginResult> {
  if (USE_MOCK) {
    return mockLogin(email, password);
  }
  return request<LoginResult>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export async function logout(): Promise<void> {
  if (USE_MOCK) return;
  await request<{ ok: boolean }>("/auth/logout", { method: "POST" });
}

/** Seed emails from `backend/app/seed.py`, all mapped to their real role. Accepts any password in mock mode. */
const MOCK_USERS: Record<string, UserRole> = {
  "admin@trace.demo": "admin",
  "resort@trace.demo": "premium_buyer",
  "school@trace.demo": "secondary_buyer",
  "compost@trace.demo": "composter",
};

async function mockLogin(email: string, password: string): Promise<LoginResult> {
  void password; // mock mode accepts any password for a known seed email
  await delay(200);
  const role = MOCK_USERS[email.trim().toLowerCase()];
  if (!role) {
    throw new ApiError("Invalid email or password", 401);
  }
  return { role };
}

// ---------------------------------------------------------------------------
// Batches
// ---------------------------------------------------------------------------

/** `GET /batches` — admin-only, ALL batches. */
export async function getBatches(): Promise<Batch[]> {
  if (USE_MOCK) {
    await delay(150);
    return getMockBatches();
  }
  return request<Batch[]>("/batches");
}

/**
 * Look up a single batch by its human-friendly number OR its id.
 *
 * IMPORTANT: there is no public `GET /batches/{id}` (or by-number) endpoint
 * on the real backend today — `GET /batches` is admin-only and returns
 * every batch, and no single-batch lookup is planned yet (see task brief).
 * This function is what the landing-page tracker calls; its behavior
 * differs by mode:
 *   - mock mode: looks up directly against the canned mock batches, no
 *     network call — instant, matches the mockup's "Batch #0412" demo.
 *   - real mode (`NEXT_PUBLIC_USE_MOCK=0`): falls back to `GET /batches`
 *     (admin-only!) and filters client-side. Since that route requires an
 *     admin session, this will 401/403 for the public landing page against
 *     a real deployment — that's expected and documented, not a bug. It
 *     throws the same `ApiError` `getBatches()` would throw, so callers get
 *     a clear, typed failure rather than a silent null.
 */
export async function getBatch(idOrNumber: string): Promise<Batch | null> {
  if (USE_MOCK) {
    await delay(150);
    return getMockBatch(idOrNumber);
  }
  const all = await request<Batch[]>("/batches");
  return all.find((b) => b.id === idOrNumber || b.batchNumber === idOrNumber) ?? null;
}

export async function disputeBatch(batchId: string): Promise<void> {
  if (USE_MOCK) {
    await delay(150);
    return;
  }
  await request<void>(`/batches/${batchId}/dispute`, { method: "POST" });
}

// ---------------------------------------------------------------------------
// Contracts
// ---------------------------------------------------------------------------

/** `GET /contracts` — admin-only, all contracts. */
export async function getContracts(): Promise<Contract[]> {
  if (USE_MOCK) {
    await delay(150);
    return getMockContracts();
  }
  return request<Contract[]>("/contracts");
}

/** `GET /contracts/mine` — scoped to the calling premium buyer. */
export async function getMyContracts(): Promise<Contract[]> {
  if (USE_MOCK) {
    await delay(150);
    return getMockContracts();
  }
  return request<Contract[]>("/contracts/mine");
}

export async function confirmContract(contractId: string): Promise<void> {
  if (USE_MOCK) {
    await delay(150);
    return;
  }
  await request<void>(`/contracts/${contractId}/confirm`, { method: "POST" });
}

// ---------------------------------------------------------------------------
// Offers / Pickups / Payouts / Demand
// ---------------------------------------------------------------------------

/** `GET /offers` — secondary-buyer incoming reroute offers. */
export async function getOffers(): Promise<Offer[]> {
  if (USE_MOCK) {
    await delay(150);
    return getMockOffers();
  }
  return request<Offer[]>("/offers");
}

/** `GET /pickups` — composter's inbound waste pickups. */
export async function getPickups(): Promise<Pickup[]> {
  if (USE_MOCK) {
    await delay(150);
    return getMockPickups();
  }
  return request<Pickup[]>("/pickups");
}

/** `GET /payouts` — admin-only, carries `marketCategory` per spec. */
export async function getPayouts(): Promise<Payout[]> {
  if (USE_MOCK) {
    await delay(150);
    return getMockPayouts();
  }
  return request<Payout[]>("/payouts");
}

/** `GET /demand` — admin-only anonymized demand feed. */
export async function getDemand(): Promise<DemandRow[]> {
  if (USE_MOCK) {
    await delay(150);
    return [
      { crop: "tomato", grade: "A", qtyBand: "100-200kg", urgency: "high" },
      { crop: "tomato", grade: "B", qtyBand: "50-100kg", urgency: "medium" },
    ];
  }
  return request<DemandRow[]>("/demand");
}

/** Admin-only provenance/audit log, mock-only convenience (real data arrives via SSE, not REST). */
export async function getAuditLog(): Promise<AuditEvent[]> {
  if (USE_MOCK) {
    await delay(50);
    return getMockAuditLog();
  }
  // No REST endpoint for historical audit events exists yet — SSE (`lib/sse.ts`)
  // is the only real-mode source for provenance events.
  return [];
}

// ---------------------------------------------------------------------------
// Capture (token-gated, no login)
// ---------------------------------------------------------------------------

/** `POST /capture/{token}` — farmer photo upload, authenticated by URL token. */
export async function uploadCapture(token: string, file: File): Promise<CaptureResult> {
  if (USE_MOCK) {
    await delay(1200);
    return { grade: "A", reason: "uniform ripe, no damage" };
  }
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API_BASE_URL}/capture/${token}`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText);
    throw new ApiError(detail || res.statusText, res.status);
  }
  return (await res.json()) as CaptureResult;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
