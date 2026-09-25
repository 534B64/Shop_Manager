// Fetch helper for sketchy wifi: small payloads, retry with backoff.
// Mutations are safe to retry because job creation is idempotent via clientRef.

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function api<T>(path: string, init?: RequestInit, retries = 2): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(path, {
        headers: { 'content-type': 'application/json' },
        ...init,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new ApiError(res.status, (body as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      return (await res.json()) as T;
    } catch (err) {
      // Retry network failures only — HTTP errors are real answers.
      if (err instanceof ApiError || attempt >= retries) throw err;
      await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
    }
  }
}

export const get = <T,>(path: string) => api<T>(path);
export const post = <T,>(path: string, body: unknown) =>
  api<T>(path, { method: 'POST', body: JSON.stringify(body) });
export const put = <T,>(path: string, body: unknown) =>
  api<T>(path, { method: 'PUT', body: JSON.stringify(body) });
export const del = <T,>(path: string, body?: unknown) =>
  api<T>(path, { method: 'DELETE', ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
