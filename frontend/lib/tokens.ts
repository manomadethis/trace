/**
 * Session/role storage helpers.
 *
 * The real backend (`POST /auth/login`) authenticates via an httpOnly
 * signed cookie (`trace_session`, see `backend/app/auth.py`) — client JS
 * never reads or writes that cookie directly, and the browser attaches it
 * automatically on same-site requests (hence `credentials: "include"` in
 * `lib/api.ts`). What the client DOES need to remember locally is *which
 * role* the logged-in user has, so the UI can route to the right surface
 * (`admin` -> `/admin`, `premium_buyer` -> `/premium-buyer`, etc.) without
 * re-decoding the cookie or re-hitting the network on every navigation.
 *
 * This module is intentionally minimal: it stores/reads/clears that role
 * string (plus a display email, handy for "logged in as ...") in
 * `localStorage`. It does NOT store a bearer token — TRACE's real auth is
 * cookie-based, not token-based. Login UI itself is Task 4's job; this file
 * only provides the plumbing Task 4 will call.
 *
 * The farmer capture flow (`POST /capture/{token}`) is a *different* kind
 * of token — a per-batch, time-boxed value that lives in the URL
 * (`/capture/[token]`), authenticates a single unauthenticated request, and
 * is never persisted client-side. Nothing in this file handles it.
 */

import type { UserRole } from "./api";

const ROLE_KEY = "trace.session.role";
const EMAIL_KEY = "trace.session.email";

export interface SessionInfo {
  role: UserRole;
  email: string | null;
}

function hasStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

/** Persist the logged-in user's role (+ optional email) after a successful login. */
export function setSession(role: UserRole, email?: string | null): void {
  if (!hasStorage()) return;
  window.localStorage.setItem(ROLE_KEY, role);
  if (email) {
    window.localStorage.setItem(EMAIL_KEY, email);
  } else {
    window.localStorage.removeItem(EMAIL_KEY);
  }
}

/** Read back the current session info, or null if nobody is logged in (client-side only). */
export function getSession(): SessionInfo | null {
  if (!hasStorage()) return null;
  const role = window.localStorage.getItem(ROLE_KEY) as UserRole | null;
  if (!role) return null;
  return { role, email: window.localStorage.getItem(EMAIL_KEY) };
}

/** Clear the stored session (call on logout, or on a 401 from the API). */
export function clearSession(): void {
  if (!hasStorage()) return;
  window.localStorage.removeItem(ROLE_KEY);
  window.localStorage.removeItem(EMAIL_KEY);
}

/** Where to redirect a given role after login (Task 4 consumes this). */
export function homeRouteForRole(role: UserRole): string {
  switch (role) {
    case "admin":
      return "/admin";
    case "premium_buyer":
      return "/premium-buyer";
    case "secondary_buyer":
      return "/secondary-buyer";
    case "composter":
      return "/composter";
    default:
      return "/";
  }
}
