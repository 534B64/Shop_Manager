import dgram from 'node:dgram';
import { describe, expect, it } from 'vitest';
import {
  buildResponse, encodeName, normalizeHostname, parseQuery, pickAddresses, startMdns, type Query,
} from './mdns.js';
import { addressList, parseEnvFile, readShopHostname } from './address.js';

/** A hand-built DNS question packet. */
function packet(id: number, qs: { name: string; type: number; cls?: number }[], flags = 0): Buffer {
  const head = Buffer.alloc(12);
  head.writeUInt16BE(id, 0);
  head.writeUInt16BE(flags, 2);
  head.writeUInt16BE(qs.length, 4);
  const body = qs.map((q) => {
    const t = Buffer.alloc(4);
    t.writeUInt16BE(q.type, 0);
    t.writeUInt16BE(q.cls ?? 1, 2);
    return Buffer.concat([encodeName(q.name), t]);
  });
  return Buffer.concat([head, ...body]);
}

describe('normalizeHostname', () => {
  it('accepts lowercase letters, digits and hyphens', () => {
    expect(normalizeHostname('decalsplus')).toBe('decalsplus');
    expect(normalizeHostname('  Decals-Plus2 ')).toBe('decals-plus2');
    expect(normalizeHostname('shop.local')).toBe('shop');
  });
  it('rejects everything else', () => {
    for (const bad of ['', 'a b', 'under_score', '-a', 'a-', 'a.b', 'x'.repeat(64), null, undefined, 'café']) {
      expect(normalizeHostname(bad as string)).toBeNull();
    }
  });
});

describe('parseQuery', () => {
  it('reads an A question', () => {
    const q = parseQuery(packet(0x1234, [{ name: 'decalsplus.local', type: 1 }]));
    expect(q).toEqual({ id: 0x1234, questions: [{ name: 'decalsplus.local', type: 1, unicast: false }] });
  });
  it('reads the unicast-response bit and several questions', () => {
    const q = parseQuery(packet(0, [{ name: 'a.local', type: 1, cls: 0x8001 }, { name: 'b.local', type: 28 }]))!;
    expect(q.questions.map((x) => [x.name, x.type, x.unicast])).toEqual([['a.local', 1, true], ['b.local', 28, false]]);
  });
  it('follows a compression pointer', () => {
    // question 1 = "x.local"; question 2 = "y" + pointer to "local" inside question 1
    const head = Buffer.alloc(12);
    head.writeUInt16BE(2, 4);
    const q1 = Buffer.concat([encodeName('x.local'), Buffer.from([0, 1, 0, 1])]);
    const localOffset = 12 + 2; // after the "x" label (len byte + 1 char)
    const q2 = Buffer.concat([Buffer.from([1, 0x79, 0xc0, localOffset]), Buffer.from([0, 1, 0, 1])]);
    const q = parseQuery(Buffer.concat([head, q1, q2]))!;
    expect(q.questions.map((x) => x.name)).toEqual(['x.local', 'y.local']);
  });
  it('ignores responses, other opcodes and junk', () => {
    expect(parseQuery(packet(1, [{ name: 'a.local', type: 1 }], 0x8400))).toBeNull();
    expect(parseQuery(packet(1, [{ name: 'a.local', type: 1 }], 0x2800))).toBeNull();
    expect(parseQuery(Buffer.from([1, 2, 3]))).toBeNull();
    expect(parseQuery(packet(1, [{ name: 'a.local', type: 1 }]).subarray(0, 16))).toBeNull();
  });
  it('survives a pointer loop', () => {
    const head = Buffer.alloc(12);
    head.writeUInt16BE(1, 4);
    expect(parseQuery(Buffer.concat([head, Buffer.from([0xc0, 12, 0, 1, 0, 1])]))).toBeNull();
  });
});

const ask = (name: string, type: number, unicast = false): Query => ({ id: 7, questions: [{ name, type, unicast }] });

describe('buildResponse', () => {
  it('answers A for our name with every address (multicast form)', () => {
    const r = buildResponse(ask('DecalsPlus.LOCAL', 1), 'decalsplus', ['192.168.1.20', '10.0.0.5'], false)!;
    expect(r.readUInt16BE(0)).toBe(0); // id 0
    expect(r.readUInt16BE(2)).toBe(0x8400);
    expect(r.readUInt16BE(4)).toBe(0); // no question section
    expect(r.readUInt16BE(6)).toBe(2); // two answers
    const name = encodeName('decalsplus.local');
    expect(r.subarray(12, 12 + name.length).equals(name)).toBe(true);
    const at = 12 + name.length;
    expect(r.readUInt16BE(at)).toBe(1); // A
    expect(r.readUInt16BE(at + 2)).toBe(0x8001); // IN + cache flush
    expect(r.readUInt32BE(at + 4)).toBe(120);
    expect([...r.subarray(at + 10, at + 14)]).toEqual([192, 168, 1, 20]);
  });
  it('answers ANY with A records', () => {
    const r = buildResponse(ask('decalsplus.local', 255), 'decalsplus', ['1.2.3.4'], false)!;
    expect(r.readUInt16BE(6)).toBe(1);
  });
  it('answers a legacy (non-mDNS) asker with its id, its question, a short TTL', () => {
    const r = buildResponse(ask('decalsplus.local', 1), 'decalsplus', ['1.2.3.4'], true)!;
    expect(r.readUInt16BE(0)).toBe(7);
    expect(r.readUInt16BE(4)).toBe(1);
    const name = encodeName('decalsplus.local');
    const at = 12 + name.length + 4 + name.length; // header + question + answer name
    expect(r.readUInt16BE(at + 2)).toBe(1); // class IN, no cache flush
    expect(r.readUInt32BE(at + 4)).toBe(10);
  });
  it('answers AAAA with an NSEC "no IPv6" record, not an address', () => {
    const r = buildResponse(ask('decalsplus.local', 28), 'decalsplus', ['1.2.3.4'], false)!;
    expect(r.readUInt16BE(6)).toBe(1);
    const at = 12 + encodeName('decalsplus.local').length;
    expect(r.readUInt16BE(at)).toBe(47); // NSEC
    const rdata = r.subarray(at + 10);
    expect([...rdata.subarray(rdata.length - 3)]).toEqual([0, 1, 0x40]); // window 0, 1 byte, only type A
  });
  it('stays silent for names that are not ours, other types, or when there is no address', () => {
    expect(buildResponse(ask('printer.local', 1), 'decalsplus', ['1.2.3.4'], false)).toBeNull();
    expect(buildResponse(ask('decalsplus.example.com', 1), 'decalsplus', ['1.2.3.4'], false)).toBeNull();
    expect(buildResponse(ask('decalsplus.local', 16), 'decalsplus', ['1.2.3.4'], false)).toBeNull(); // TXT
    expect(buildResponse(ask('decalsplus.local', 1), 'decalsplus', [], false)).toBeNull();
  });
});

describe('pickAddresses', () => {
  const ifaces = [
    { address: '192.168.1.20', netmask: '255.255.255.0' },
    { address: '10.0.0.5', netmask: '255.255.0.0' },
  ];
  it('prefers the interface on the asker\'s subnet', () => {
    expect(pickAddresses(ifaces, '10.0.9.9').map((i) => i.address)).toEqual(['10.0.0.5']);
    expect(pickAddresses(ifaces, '192.168.1.77').map((i) => i.address)).toEqual(['192.168.1.20']);
  });
  it('falls back to all of them', () => {
    expect(pickAddresses(ifaces, '172.16.0.1')).toHaveLength(2);
  });
});

describe('responder over UDP (loopback)', () => {
  it('answers our name and ignores others', async () => {
    let ips = ['192.168.1.20'];
    const h = await startMdns({
      hostname: 'decalsplus', port: 0, bindAddress: '127.0.0.1', multicast: false,
      getInterfaces: () => ips.map((address) => ({ address, netmask: '255.255.255.0' })),
    });
    expect(h).not.toBeNull();
    const client = dgram.createSocket('udp4');
    const query = (name: string, type: number) => new Promise<Buffer | null>((resolve) => {
      const t = setTimeout(() => { client.removeAllListeners('message'); resolve(null); }, 300);
      client.once('message', (m) => { clearTimeout(t); resolve(m); });
      client.send(packet(99, [{ name, type }]), h!.port, '127.0.0.1');
    });
    try {
      const a = await query('decalsplus.local', 1);
      expect(a).not.toBeNull();
      expect(a!.readUInt16BE(0)).toBe(99);
      expect([...a!.subarray(a!.length - 4)]).toEqual([192, 168, 1, 20]);
      expect(await query('someoneelse.local', 1)).toBeNull();
      ips = ['192.168.1.99']; // the IP changed: the next answer must use it
      const b = await query('decalsplus.local', 1);
      expect([...b!.subarray(b!.length - 4)]).toEqual([192, 168, 1, 99]);
    } finally {
      client.close();
      h!.stop();
    }
  });
  it('refuses an invalid hostname', async () => {
    expect(await startMdns({ hostname: 'bad name', port: 0, multicast: false })).toBeNull();
  });
});

describe('shop address helpers', () => {
  it('parses shop.env', () => {
    expect(parseEnvFile('# c\nSHOP_NAME="Decals Plus"\r\nSHOP_HOSTNAME=decalsplus\n')).toEqual({
      SHOP_NAME: 'Decals Plus', SHOP_HOSTNAME: 'decalsplus',
    });
  });
  it('env beats the file; junk is ignored', () => {
    expect(readShopHostname({ SHOP_HOSTNAME: 'Front-Desk' }, '/nonexistent/x.db')).toBe('front-desk');
    expect(readShopHostname({ SHOP_HOSTNAME: 'bad name' }, '/nonexistent/x.db')).toBeNull();
    expect(readShopHostname({}, '/nonexistent/x.db')).toBeNull();
  });
  it('lists the friendly name first, IPs after, port only when not 80', () => {
    expect(addressList('decalsplus', 80, ['192.168.1.20'])).toEqual(['http://decalsplus.local', 'http://192.168.1.20']);
    expect(addressList('decalsplus', 3000, ['192.168.1.20'])).toEqual(['http://decalsplus.local:3000', 'http://192.168.1.20:3000']);
    expect(addressList(null, 80, ['1.2.3.4'])).toEqual(['http://1.2.3.4']);
  });
});
