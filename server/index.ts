import './restore-guard.js'; // must stay first: refuses to start during a restore
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';
import { DB_PATH } from './db/index.js';
import { getSetting } from './modules/settings/index.js';
import { holdServerLock } from './db/server-lock.js';
import { backupConfigFromEnv, scheduleDailyBackups } from './db/backup.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const app = await buildApp({ logger: true });

// Which data this is (ADR 0008) — the first thing to check in the log.
const dataset = await getSetting('dataset');
const label = dataset === 'production' ? 'PRODUCTION'
  : dataset === 'demo' ? 'DEMO (practice data, not real)'
  : 'UNLABELED (for a real shop database see docs/PRODUCTION-SETUP.md)';
app.log.info(`database ${path.resolve(DB_PATH)} | dataset: ${label}`);

// Heartbeat lock: db:restore refuses while it is fresh.
const lock = holdServerLock(DB_PATH);
if (lock.replacedLive) app.log.warn('another server process seems to be using this database too');

// Optional daily backup inside the app (BACKUP_HOUR set, as in the Docker image).
let stopBackups = () => {};
try {
  stopBackups = scheduleDailyBackups({
    dbPath: DB_PATH, config: backupConfigFromEnv(process.env, DB_PATH),
    log: { info: (m) => app.log.info(m), error: (m) => app.log.error(m) },
  });
} catch (err) {
  app.log.error(`BACKUP SCHEDULE NOT STARTED: ${(err as Error).message}`);
}

// In production the same process serves the built client — one container, one port.
if (process.env.NODE_ENV === 'production') {
  await app.register(fastifyStatic, { root: path.join(here, '..', 'dist') });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) {
      reply.code(404).send({ error: 'Not found' });
    } else {
      reply.sendFile('index.html'); // SPA fallback
    }
  });
}

// Clean stop (docker stop, Ctrl+C): finish in-flight requests, drop the lock.
const shutdown = async () => {
  stopBackups();
  await app.close().catch(() => undefined);
  lock.release();
  process.exit(0);
};
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
process.once('exit', () => lock.release());

const port = Number(process.env.PORT ?? 3000);
app.listen({ port, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
