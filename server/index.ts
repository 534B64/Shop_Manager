import './restore-guard.js'; // must stay first: refuses to start during a restore
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';
import { DB_PATH } from './db/index.js';
import { getSetting } from './modules/settings/index.js';
import { holdServerLock } from './db/server-lock.js';
import { backupConfigFromEnv, scheduleDailyBackups } from './db/backup.js';
import { startMdns, lanInterfaces, MDNS_PORT } from './lib/mdns.js';
import { readShopHostname, addressList, setListenPort } from './lib/address.js';

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

const isProd = process.env.NODE_ENV === 'production';
const hostname = readShopHostname(process.env, DB_PATH);
let stopMdns = () => {};

// Clean stop (docker stop, Ctrl+C): finish in-flight requests, drop the lock.
const shutdown = async () => {
  stopBackups();
  stopMdns();
  await app.close().catch(() => undefined);
  lock.release();
  process.exit(0);
};
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
process.once('exit', () => lock.release());

// Port: PORT if set; otherwise 80 in production (so the address needs no ":3000") and 3000 in
// development. If 80 is busy or not allowed, fall back to 3000 and say so.
const portFromEnv = process.env.PORT ? Number(process.env.PORT) : null;
const host = process.env.HOST ?? '0.0.0.0';
const wanted = portFromEnv ?? (isProd ? 80 : 3000);
let port = wanted;
try {
  await app.listen({ port, host });
} catch (err) {
  const code = (err as NodeJS.ErrnoException).code;
  if (portFromEnv === null && wanted === 80 && (code === 'EADDRINUSE' || code === 'EACCES' || code === 'EPERM')) {
    app.log.warn(`Port 80 is not available (${code}), so Shop Manager is using port 3000 instead.`);
    port = 3000;
    try { await app.listen({ port, host }); } catch (err2) { app.log.error(err2); process.exit(1); }
  } else {
    app.log.error(err);
    process.exit(1);
  }
}
setListenPort(port);
const ips = lanInterfaces().map((i) => i.address);
app.log.info(`Shop Manager is running. Open it at: ${addressList(hostname, port, ips).join('  or  ') || `http://localhost:${port}`}`);

// The friendly <name>.local address (production only, when Setup chose a name).
if (isProd && hostname) {
  // MDNS_PORT other than 5353 = loopback test mode (no multicast); real use leaves it unset.
  const testPort = process.env.MDNS_PORT ? Number(process.env.MDNS_PORT) : null;
  const m = await startMdns({
    hostname,
    port: testPort ?? MDNS_PORT,
    multicast: testPort === null,
    bindAddress: testPort === null ? undefined : '127.0.0.1',
    log: { info: (x) => app.log.info(x), warn: (x) => app.log.warn(x) },
  });
  if (m) stopMdns = m.stop;
  else app.log.warn(`Could not start the ${hostname}.local name service (UDP ${MDNS_PORT} busy or blocked). Use the IP address instead.`);
}
