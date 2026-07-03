// Sign-in is shop-level auth on a LAN: account passwords gate actions
// (edits, deletions); the admin password gates configuration.
import { put } from './api';
import { getPrefs, applyPrefs, type Prefs } from './theme';

export function currentUser(): string | null {
  return localStorage.getItem('dp-user');
}
export function currentPassword(): string | null {
  return sessionStorage.getItem('dp-pass');
}
export function setSession(name: string | null, password?: string) {
  if (name) {
    localStorage.setItem('dp-user', name);
    if (password !== undefined) sessionStorage.setItem('dp-pass', password);
  } else {
    localStorage.removeItem('dp-user');
    sessionStorage.removeItem('dp-pass');
  }
}
/** Persist prefs to the signed-in account (and locally). */
export async function savePrefs(prefs: Prefs) {
  applyPrefs(prefs);
  const name = currentUser(); const password = currentPassword();
  if (name && password) {
    try { await put('/api/users/prefs', { name, password, prefs }); } catch { /* offline ok */ }
  }
}
export { getPrefs };
export function isCounterMode(): boolean {
  return localStorage.getItem('dp-counter-mode') === '1';
}
export function setCounterMode(on: boolean) {
  localStorage.setItem('dp-counter-mode', on ? '1' : '0');
}
export function isAdminUnlocked(): boolean {
  return sessionStorage.getItem('dp-admin') === '1';
}
export function setAdminUnlocked(on: boolean) {
  if (on) sessionStorage.setItem('dp-admin', '1');
  else sessionStorage.removeItem('dp-admin');
}
