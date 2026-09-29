import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// Tests run in the shop's time zone for the whole run (date filters mean the
// shop's local day). Set here, before test workers start.
if (process.env.VITEST) process.env.TZ = 'America/Chicago';

/** A new id for every `npm run build`: git short hash when git exists, plus the build time.
 *  The server reads it back from dist/build-id.json (server/lib/build-info.ts). */
function newBuildId(): string {
  let hash = 'nogit';
  try {
    hash = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || hash;
  } catch { /* no git on this machine: the time alone is unique enough */ }
  return `${hash}-${Date.now().toString(36)}`;
}

export default defineConfig(({ command }) => {
  const buildId = command === 'build' ? newBuildId() : 'dev';
  return {
    plugins: [
      react(),
      {
        name: 'write-build-id',
        apply: 'build' as const,
        writeBundle(options) {
          const dir = options.dir ?? 'dist';
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(path.join(dir, 'build-id.json'), JSON.stringify({ build: buildId, builtAt: new Date().toISOString() }));
        },
      },
    ],
    define: { __BUILD_ID__: JSON.stringify(buildId) },
    server: {
      proxy: { '/api': 'http://localhost:3000' },
    },
    build: {
      outDir: 'dist',
    },
  };
});
