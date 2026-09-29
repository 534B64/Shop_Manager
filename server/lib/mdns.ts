// A tiny mDNS responder (RFC 6762), so other devices can open http://<shopname>.local
// without anyone typing an IP address. No dependencies: node:dgram + node:os.
//
// It answers ONLY questions for "<hostname>.local":
//   A     -> this PC's current LAN IPv4 address(es), read fresh on every question
//   AAAA  -> "no such record" (an NSEC record), so clients don't wait for IPv6
// Every other name is ignored. It never sends anything unless asked, except one
// announcement when it starts.
import dgram from 'node:dgram';
import os from 'node:os';

export const MDNS_GROUP = '224.0.0.251';
export const MDNS_PORT = 5353;
const TYPE_A = 1;
const TYPE_AAAA = 28;
const TYPE_ANY = 255;
const TYPE_NSEC = 47;
const CLASS_IN = 1;
const CACHE_FLUSH = 0x8000;
const TTL = 120;
const LEGACY_TTL = 10; // RFC 6762 6.7: answers to non-mDNS resolvers stay short
const MAX_QUESTIONS = 8; // queries with more questions are ignored
const MAX_ECHOED = 4; // a legacy reply repeats at most this many questions

/** Lowercase letters, digits and hyphens only; 1-63 chars, no leading/trailing hyphen. Else null. */
export function normalizeHostname(input: string | null | undefined): string | null {
  const s = (input ?? '').trim().toLowerCase().replace(/\.local\.?$/, '');
  return /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(s) ? s : null;
}

export interface Question { name: string; type: number; unicast: boolean }
export interface Query { id: number; questions: Question[] }

/** Read a (possibly compressed) DNS name starting at `offset`. */
function readName(buf: Buffer, offset: number): { name: string; next: number } | null {
  const labels: string[] = [];
  let pos = offset;
  let next = -1;
  for (let jumps = 0; jumps < 64;) {
    if (pos >= buf.length) return null;
    const len = buf[pos];
    if (len === 0) {
      return { name: labels.join('.'), next: next === -1 ? pos + 1 : next };
    }
    if ((len & 0xc0) === 0xc0) { // pointer
      if (pos + 1 >= buf.length) return null;
      if (next === -1) next = pos + 2;
      pos = ((len & 0x3f) << 8) | buf[pos + 1];
      jumps++;
      continue;
    }
    if (len > 63 || pos + 1 + len > buf.length) return null;
    labels.push(buf.toString('latin1', pos + 1, pos + 1 + len));
    pos += 1 + len;
    if (labels.join('.').length > 253) return null;
  }
  return null;
}

/** Parse a DNS packet; returns the questions of a standard query, or null for anything else. */
export function parseQuery(buf: Buffer): Query | null {
  if (buf.length < 12) return null;
  const flags = buf.readUInt16BE(2);
  if (flags & 0x8000) return null; // a response, not a question
  if (((flags >> 11) & 0xf) !== 0) return null; // not a standard query
  const count = buf.readUInt16BE(4);
  if (count > MAX_QUESTIONS) return null; // a many-question packet is junk or an amplification attempt
  const questions: Question[] = [];
  let pos = 12;
  for (let i = 0; i < count; i++) {
    const n = readName(buf, pos);
    if (!n || n.next + 4 > buf.length) return null;
    const type = buf.readUInt16BE(n.next);
    const cls = buf.readUInt16BE(n.next + 2);
    questions.push({ name: n.name, type, unicast: (cls & 0x8000) !== 0 });
    pos = n.next + 4;
  }
  return { id: buf.readUInt16BE(0), questions };
}

/** Encode a dotted name as DNS labels. */
export function encodeName(name: string): Buffer {
  const parts: Buffer[] = [];
  for (const label of name.split('.').filter(Boolean)) {
    const b = Buffer.from(label, 'latin1');
    parts.push(Buffer.from([b.length]), b);
  }
  parts.push(Buffer.from([0]));
  return Buffer.concat(parts);
}

function record(name: string, type: number, cls: number, ttl: number, data: Buffer): Buffer {
  const head = Buffer.alloc(10);
  head.writeUInt16BE(type, 0);
  head.writeUInt16BE(cls, 2);
  head.writeUInt32BE(ttl, 4);
  head.writeUInt16BE(data.length, 8);
  return Buffer.concat([encodeName(name), head, data]);
}

const ipBytes = (ip: string) => Buffer.from(ip.split('.').map(Number));
/** NSEC: "this name has an A record and nothing else" (RFC 6762 6.1) - the graceful AAAA answer. */
const nsecFor = (name: string) => Buffer.concat([encodeName(name), Buffer.from([0, 1, 0x40])]);

/**
 * The reply to `query` for our own name, or null when nothing in it is ours.
 * `legacy` = the asker is an ordinary DNS resolver (source port is not 5353): echo its id and
 * questions, short TTL, no cache-flush bit.
 */
export function buildResponse(query: Query, ourName: string, ips: string[], legacy: boolean): Buffer | null {
  const ours = `${ourName}.local`;
  const mine = query.questions.filter((q) => q.name.toLowerCase() === ours);
  if (!ips.length) return null;
  const wantA = mine.some((q) => q.type === TYPE_A || q.type === TYPE_ANY);
  const wantNone = mine.some((q) => q.type === TYPE_AAAA);
  if (!wantA && !wantNone) return null;

  const cls = legacy ? CLASS_IN : CLASS_IN | CACHE_FLUSH;
  const ttl = legacy ? LEGACY_TTL : TTL;
  const answers: Buffer[] = [];
  if (wantA) for (const ip of ips) answers.push(record(ours, TYPE_A, cls, ttl, ipBytes(ip)));
  if (wantNone) answers.push(record(ours, TYPE_NSEC, cls, ttl, nsecFor(ours)));

  const head = Buffer.alloc(12);
  head.writeUInt16BE(legacy ? query.id : 0, 0);
  head.writeUInt16BE(0x8400, 2); // response + authoritative
  const echoed = legacy ? mine.filter((q) => q.type === TYPE_A || q.type === TYPE_ANY || q.type === TYPE_AAAA).slice(0, MAX_ECHOED) : [];
  head.writeUInt16BE(echoed.length, 4);
  head.writeUInt16BE(answers.length, 6);
  const qs = echoed.map((q) => {
    const tail = Buffer.alloc(4);
    tail.writeUInt16BE(q.type, 0);
    tail.writeUInt16BE(CLASS_IN, 2);
    return Buffer.concat([encodeName(q.name), tail]);
  });
  return Buffer.concat([head, ...qs, ...answers]);
}

export interface Iface { address: string; netmask: string }

/** Adapters that are not the shop network: WSL/Hyper-V, VirtualBox, VMware, Docker, VPNs. */
const VIRTUAL_NAME = /vethernet|wsl|hyper-v|virtualbox|vmware|vbox|docker|tailscale|zerotier|vpn|tap-windows|\btun\d|loopback/i;

/** This PC's usable LAN IPv4 interfaces (not loopback, not link-local 169.254.x.x). */
export function lanInterfaces(): Iface[] {
  const out: Iface[] = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    if (VIRTUAL_NAME.test(name)) continue;
    for (const i of list ?? []) {
      if (i.family !== 'IPv4' || i.internal || i.address.startsWith('169.254.')) continue;
      out.push({ address: i.address, netmask: i.netmask });
    }
  }
  return out;
}

const toInt = (ip: string) => ip.split('.').reduce((n, p) => (n << 8) + Number(p), 0) >>> 0;

/** Addresses to give an asker: the ones on its own subnet when there are any, else all of them. */
export function pickAddresses(ifaces: Iface[], remote: string): Iface[] {
  const r = toInt(remote);
  const same = ifaces.filter((i) => ((toInt(i.address) & toInt(i.netmask)) >>> 0) === ((r & toInt(i.netmask)) >>> 0));
  return same.length ? same : ifaces;
}

export interface MdnsOptions {
  hostname: string;
  /** UDP port to listen on (default 5353; tests pass 0). */
  port?: number;
  /** Bind address (default all interfaces). */
  bindAddress?: string;
  /** Join the 224.0.0.251 group and announce. False = unicast only (tests, or a loopback-only run). */
  multicast?: boolean;
  /** Where the LAN addresses come from; read again on every question. */
  getInterfaces?: () => Iface[];
  log?: { info: (m: string) => void; warn: (m: string) => void };
}

export interface MdnsHandle { stop: () => void; port: number }

/** Start answering for `<hostname>.local`. Resolves once listening; never throws for network trouble. */
export function startMdns(opts: MdnsOptions): Promise<MdnsHandle | null> {
  const hostname = normalizeHostname(opts.hostname);
  const log = opts.log ?? { info: () => {}, warn: () => {} };
  if (!hostname) { log.warn(`mDNS not started: "${opts.hostname}" is not a valid name`); return Promise.resolve(null); }
  const multicast = opts.multicast ?? true;
  const getInterfaces = opts.getInterfaces ?? lanInterfaces;
  const port = opts.port ?? MDNS_PORT;
  const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });

  const joinAll = () => {
    for (const i of getInterfaces()) {
      try { sock.addMembership(MDNS_GROUP, i.address); } catch { /* already joined, or interface went away */ }
    }
  };
  const sendMulticast = (buf: Buffer, from: string) => {
    try { sock.setMulticastInterface(from); } catch { /* ignore */ }
    sock.send(buf, MDNS_PORT, MDNS_GROUP, () => {});
  };

  sock.on('message', (msg, rinfo) => {
    try {
      const q = parseQuery(msg);
      if (!q) return;
      const ifaces = getInterfaces();
      const chosen = pickAddresses(ifaces, rinfo.address);
      const legacy = rinfo.port !== MDNS_PORT;
      const reply = buildResponse(q, hostname, chosen.map((i) => i.address), legacy);
      if (!reply) return;
      const unicast = legacy || q.questions.every((x) => x.unicast);
      if (unicast || !multicast) sock.send(reply, rinfo.port, rinfo.address, () => {});
      else sendMulticast(reply, chosen[0].address);
    } catch (err) { log.warn(`mDNS: ignored a bad packet (${(err as Error).message})`); }
  });
  sock.on('error', (err) => log.warn(`mDNS problem: ${err.message}`));

  return new Promise((resolve) => {
    sock.once('error', () => resolve(null)); // bind failed (port taken / not allowed)
    sock.bind(port, opts.bindAddress, () => {
      let timer: NodeJS.Timeout | undefined;
      if (multicast) {
        try { sock.setMulticastTTL(255); sock.setMulticastLoopback(true); } catch { /* ignore */ }
        joinAll();
        timer = setInterval(joinAll, 60_000); // pick up a network that came back
        timer.unref();
        const ifaces = getInterfaces();
        const hello = buildResponse({ id: 0, questions: [{ name: `${hostname}.local`, type: TYPE_A, unicast: false }] },
          hostname, ifaces.map((i) => i.address), false);
        if (hello && ifaces.length) sendMulticast(hello, ifaces[0].address);
      }
      log.info(`mDNS: answering for ${hostname}.local`);
      resolve({
        port: sock.address().port,
        stop: () => { if (timer) clearInterval(timer); try { sock.close(); } catch { /* already closed */ } },
      });
    });
  });
}
