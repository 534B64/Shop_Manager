// Session (ADR 0004): the server issues a bearer token at sign-in (stored in
// localStorage 'dp-token' by api.ts); the signed-in account — name + role — is
// cached here for the UI and refreshed from /api/auth/me on every app load.
// The server re-checks every role/approval; hiding a button is convenience.
import { put, post, setToken } from './api';
import { getPrefs, applyPrefs, type Prefs } from './theme';

export type Role = 'cashier' | 'manager' | 'admin';
export interface SessionUser { id: number; name: string; role: Role }

const USER_KEY = 'dp-user';
const RANK: Record<Role, number> = { cashier: 0, manager: 1, admin: 2 };

export function sessionUser(): SessionUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    const u = raw ? JSON.parse(raw) : null;
    return u && typeof u === 'object' && u.role ? (u as SessionUser) : null;
  } catch { return null; }
}
/** Signed-in account name (display only — the server attributes by session). */
export function currentUser(): string | null {
  return sessionUser()?.name ?? null;
}
/** True when the signed-in account is at least `min`. */
export function hasRole(min: Role): boolean {
  const u = sessionUser();
  return !!u && RANK[u.role] >= RANK[min];
}
export function setSession(token: string, user: SessionUser) {
  setToken(token);
  localStorage.setItem(USER_KEY, JSON.stringify({ id: user.id, name: user.name, role: user.role }));
}
export function updateSessionUser(user: SessionUser) {
  localStorage.setItem(USER_KEY, JSON.stringify({ id: user.id, name: user.name, role: user.role }));
}
export function clearSession() {
  setToken(null);
  localStorage.removeItem(USER_KEY);
}
/** Revoke the server session (best effort), then forget it locally. */
export async function signOut() {
  try { await post('/api/auth/logout', {}); } catch { /* offline — token dies on idle expiry */ }
  clearSession();
}
/** Persist prefs to the signed-in account (and locally). */
export async function savePrefs(prefs: Prefs) {
  applyPrefs(prefs);
  if (sessionUser()) {
    try { await put('/api/users/prefs', { prefs }); } catch { /* offline ok */ }
  }
}
export { getPrefs };
export function isCounterMode(): boolean {
  return localStorage.getItem('dp-counter-mode') === '1';
}
export function setCounterMode(on: boolean) {
  localStorage.setItem('dp-counter-mode', on ? '1' : '0');
}
