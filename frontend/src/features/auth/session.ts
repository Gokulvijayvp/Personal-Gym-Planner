import { useSyncExternalStore } from "react";

/**
 * Who is signed in on this device. The real proof is the httpOnly cookie the server sets, which JavaScript
 * cannot read, so this only mirrors the answer of GET /auth/me. Nothing secret is kept in the browser.
 * It imports nothing from the services, so the API client can clear it on a 401 without a circular import.
 */
export interface SessionUser { id?: number; email: string; full_name?: string | null; role?: "admin" | "user" }
export type SessionState = { status: "loading" } | { status: "in"; user: SessionUser } | { status: "out" };

let state: SessionState = { status: "loading" };
const listeners = new Set<() => void>();

const whoChanged: (() => void)[] = [];
/** Run `fn` whenever a different person (or nobody) becomes the signed-in user, so per-user data cached in the page is dropped. */
export function onSignedInUserChange(fn: () => void): void { whoChanged.push(fn); }
const idOf = (s: SessionState) => (s.status === "in" ? (s.user.id ?? s.user.email) : null);

export function getSession(): SessionState { return state; }
export function setSession(user: SessionUser | null) {
  const before = idOf(state);
  state = user ? { status: "in", user } : { status: "out" };
  if (before !== null && before !== idOf(state)) whoChanged.forEach((fn) => fn());      // logout, or someone else signing in
  listeners.forEach((l) => l());
}
export const clearSession = () => setSession(null);
/** Test helper: back to "still checking". */
export function resetSession() { state = { status: "loading" }; listeners.forEach((l) => l()); }

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const useSession = () => useSyncExternalStore(subscribe, getSession, getSession);

/** True only for the signed-in admin. (The server also refuses admin-only actions from anyone else.) */
export function useIsAdmin(): boolean {
  const s = useSession();
  return s.status === "in" && s.user.role === "admin";
}
