// Which version and which client build this server is running (GET /api/health).
// `npm run build` writes dist/build-id.json (see vite.config.ts) and compiles the
// same id into the client. The server reads it ONCE, at start. If the client in
// the browser carries a different id — or the server is an older one that has no
// id at all — the server is out of date and the client says so.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface BuildInfo { version: string; build: string | null }

const here = path.dirname(fileURLToPath(import.meta.url));

/** version from package.json; build from <distDir>/build-id.json (null when there is no build, e.g. dev). */
export function loadBuildInfo(distDir: string, packageJson: string): BuildInfo {
  let version = 'unknown';
  try { version = String(JSON.parse(fs.readFileSync(packageJson, 'utf8')).version ?? 'unknown'); } catch { /* keep unknown */ }
  let build: string | null = null;
  try {
    const b = JSON.parse(fs.readFileSync(path.join(distDir, 'build-id.json'), 'utf8')).build;
    if (typeof b === 'string' && b) build = b;
  } catch { /* no dist yet */ }
  return { version, build };
}

/** Read at server start and kept: a rebuild after the server started must NOT change it. */
export const BUILD_INFO: BuildInfo = loadBuildInfo(path.join(here, '..', '..', 'dist'), path.join(here, '..', '..', 'package.json'));
