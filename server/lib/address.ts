// Where this shop's server can be reached: the shop name from Setup, the port it actually
// listened on, and the LAN IP fallback. Used for the startup log, /api/health and the
// Settings -> Shop "Open on other devices" card.
import fs from 'node:fs';
import path from 'node:path';
import { lanInterfaces, normalizeHostname } from './mdns.js';

/** Parse simple KEY=value lines (# comments allowed). */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trim().startsWith('#')) out[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
  }
  return out;
}

/** Setup keeps the shop's choices in data/shop.env, next to the database (never touched by updates). */
export function shopEnvPath(dbPath: string): string {
  return path.join(path.dirname(path.resolve(dbPath)), 'shop.env');
}

/** The hostname: env SHOP_HOSTNAME wins, else data/shop.env, else null (no friendly address). */
export function readShopHostname(env: NodeJS.ProcessEnv, dbPath: string): string | null {
  const fromEnv = normalizeHostname(env.SHOP_HOSTNAME);
  if (fromEnv) return fromEnv;
  try {
    return normalizeHostname(parseEnvFile(fs.readFileSync(shopEnvPath(dbPath), 'utf8')).SHOP_HOSTNAME);
  } catch { return null; }
}

/** The shop name Setup saved (SHOP_NAME in env or data/shop.env), or null. */
export function readShopName(env: NodeJS.ProcessEnv, dbPath: string): string | null {
  const fromEnv = env.SHOP_NAME?.trim();
  if (fromEnv) return fromEnv;
  try {
    return parseEnvFile(fs.readFileSync(shopEnvPath(dbPath), 'utf8')).SHOP_NAME?.trim() || null;
  } catch { return null; }
}

/** `http://name.local` and `http://1.2.3.4` (":port" only when it is not 80). */
export function addressList(hostname: string | null, port: number, ips: string[]): string[] {
  const suffix = port === 80 ? '' : `:${port}`;
  return [...(hostname ? [`http://${hostname}.local${suffix}`] : []), ...ips.map((ip) => `http://${ip}${suffix}`)];
}

let listenPort: number | null = null;
/** Called by server/index.ts once the server is listening. */
export function setListenPort(port: number) { listenPort = port; }

/** The addresses to show right now (empty until the server is listening, e.g. in tests). */
export function reachableAddresses(dbPath: string, env: NodeJS.ProcessEnv = process.env) {
  const hostname = readShopHostname(env, dbPath);
  if (listenPort === null) return { hostname, port: null, addresses: [] as string[] };
  return { hostname, port: listenPort, addresses: addressList(hostname, listenPort, lanInterfaces().map((i) => i.address)) };
}

/**
 * The port to listen on. PORT always wins. Otherwise port 80 ONLY for an install that Setup
 * configured (production with a shop hostname); everything else stays on 3000 exactly as before,
 * so an existing install that is merely updated keeps its address.
 */
export function chooseListenPort(env: NodeJS.ProcessEnv, isProd: boolean, hostname: string | null): { port: number; fromEnv: boolean } {
  const fromEnv = env.PORT ? Number(env.PORT) : null;
  if (fromEnv !== null && Number.isInteger(fromEnv) && fromEnv > 0 && fromEnv < 65536) return { port: fromEnv, fromEnv: true };
  return { port: isProd && hostname ? 80 : 3000, fromEnv: false };
}
