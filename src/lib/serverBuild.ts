// Is the server older than the page in front of us? (GET /api/health → build)

/** The build id compiled into this client by `npm run build`; 'dev' under `vite`/tests. */
export const CLIENT_BUILD: string = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev';

export interface HealthInfo { build?: string | null; version?: string }

/** When a build id was made: its last part is the build time in base 36 (see vite.config.ts). */
export function buildTime(id: string | null | undefined): number | null {
  if (!id || !id.includes('-')) return null;
  const n = parseInt(id.slice(id.lastIndexOf('-') + 1), 36);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export type ServerState = 'ok' | 'server-older' | 'server-newer';

/**
 * How the server compares with this page.
 *   server-older: an update was installed but the server was not restarted (or it is an older
 *                 server with no build id at all) -> tell them to restart.
 *   server-newer: this tab was opened before a restart -> just reload the page.
 * Always 'ok' in development, or when the health check failed (a flaky network must not show a false banner).
 */
export function serverState(clientBuild: string, health: HealthInfo | null): ServerState {
  if (clientBuild === 'dev' || !health) return 'ok';
  if (health.build === clientBuild) return 'ok';
  const server = buildTime(health.build);
  const client = buildTime(clientBuild);
  if (server != null && client != null && server > client) return 'server-newer';
  return 'server-older';
}

/** True when the server needs restarting (kept for callers that only need yes/no). */
export function serverIsOutOfDate(clientBuild: string, health: HealthInfo | null): boolean {
  return serverState(clientBuild, health) === 'server-older';
}

export const NEW_VERSION_MESSAGE = 'A new version is ready — reload this page.';
export const OUT_OF_DATE_MESSAGE = 'The server is out of date — run 5-Start-Hidden (restart).';
