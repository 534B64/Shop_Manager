// Fetch helper for sketchy wifi: small payloads, retry with backoff.
// Mutations are safe to retry because job creation is idempotent via clientRef.
//
// Auth (ADR 0004): every request carries the session token. A 401 clears the
// session and returns to sign-in; a 403 approval_required opens the shared
// Manager-approval dialog and retries the same request with `approval` added.

export class ApiError extends Error {
  constructor(public status: number, message: string, public data: Record<string, unknown> = {}) { super(message); }
}

const TOKEN_KEY = 'dp-token';
export const getToken = () => localStorage.getItem(TOKEN_KEY);
export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

// Registered by App: called when a session dies mid-use (expired/revoked).
let onUnauthorized: () => void = () => {};
export function setUnauthorizedHandler(fn: () => void) { onUnauthorized = fn; }

export interface Approval { name: string; pin: string; reason?: string }
// Registered by <ApprovalHost/>: shows the dialog, resolves null on cancel.
// `error` is set when the previous attempt had a wrong manager PIN.
type ApprovalPrompt = (action: string, error?: string) => Promise<Approval | null>;
let promptApproval: ApprovalPrompt = async () => null;
export function setApprovalPrompt(fn: ApprovalPrompt) { promptApproval = fn; }

async function send(path: string, init: RequestInit | undefined, retries: number): Promise<Response> {
  const token = getToken();
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetch(path, {
        ...init,
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(init?.headers ?? {}),
        },
      });
    } catch (err) {
      // Retry network failures only — HTTP errors are real answers.
      if (attempt >= retries) throw err;
      await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
    }
  }
}

export async function api<T>(path: string, init?: RequestInit, retries = 2): Promise<T> {
  let reqInit = init;
  let approvalError: string | undefined;
  for (;;) {
    const res = await send(path, reqInit, retries);
    if (res.ok) return (await res.json()) as T;
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    // (A wrong PIN at sign-in is also a 401 — that one is just an answer.)
    if (res.status === 401 && path !== '/api/auth/login' && path !== '/api/auth/setup') {
      setToken(null);
      onUnauthorized();
    }
    const code = body.error as string | undefined;
    if (res.status === 403 && (code === 'approval_required' || code === 'approval_invalid')) {
      if (code === 'approval_invalid') approvalError = (body.message as string) ?? 'Wrong manager name or PIN.';
      const approval = await promptApproval(String(body.action ?? ''), approvalError);
      if (!approval) throw new ApiError(403, 'Manager approval cancelled', body);
      const prev = reqInit?.body ? JSON.parse(String(reqInit.body)) : {};
      reqInit = { ...reqInit, body: JSON.stringify({ ...prev, approval }) };
      continue;
    }
    throw new ApiError(res.status, code ?? `HTTP ${res.status}`, body);
  }
}

export const get = <T,>(path: string) => api<T>(path);
export const post = <T,>(path: string, body: unknown) =>
  api<T>(path, { method: 'POST', body: JSON.stringify(body) });
export const put = <T,>(path: string, body: unknown) =>
  api<T>(path, { method: 'PUT', body: JSON.stringify(body) });
export const del = <T,>(path: string, body?: unknown) =>
  api<T>(path, { method: 'DELETE', ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });

/** Download a file (CSV exports) with the session header — a plain <a href>
 *  can't send Authorization, so fetch → blob → temporary link. */
export async function download(path: string, filename: string) {
  const res = await send(path, undefined, 2);
  if (res.status === 401) { setToken(null); onUnauthorized(); throw new ApiError(401, 'Sign in required'); }
  if (!res.ok) throw new ApiError(res.status, `HTTP ${res.status}`);
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
