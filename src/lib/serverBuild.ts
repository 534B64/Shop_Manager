// Is the server older than the page in front of us? (GET /api/health → build)

/** The build id compiled into this client by `npm run build`; 'dev' under `vite`/tests. */
export const CLIENT_BUILD: string = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev';

export interface HealthInfo { build?: string | null; version?: string }

/**
 * True when the server reports a different build than this client, or none at all
 * (an older server that predates the check). Never true in development, or when
 * the health check itself failed (a flaky network must not show a false banner).
 */
export function serverIsOutOfDate(clientBuild: string, health: HealthInfo | null): boolean {
  if (clientBuild === 'dev' || !health) return false;
  return health.build !== clientBuild;
}

export const OUT_OF_DATE_MESSAGE = 'The server is out of date — run 5-Start-Hidden (restart).';
