// PIN hashing + session tokens — node:crypto only (no new dependencies).
import { scrypt, randomBytes, timingSafeEqual, createHash } from 'node:crypto';

const KEYLEN = 32;

function scryptAsync(secret: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(secret, salt, KEYLEN, (err, key) => (err ? reject(err) : resolve(key))));
}

/** Hash a PIN (or legacy password) as "scrypt$<saltHex>$<hashHex>". */
export async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(pin, salt);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

// A fixed hash to verify against when the account doesn't exist, so a wrong
// name costs the same time as a wrong PIN (no account-existence timing leak).
const DUMMY = `scrypt$${'00'.repeat(16)}$${'00'.repeat(KEYLEN)}`;

/** Constant-time check of a PIN against a stored hash. null hash → false
 *  (after doing the same work). */
export async function verifyPin(pin: string, stored: string | null): Promise<boolean> {
  const [scheme, saltHex, hashHex] = (stored ?? DUMMY).split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scryptAsync(pin, Buffer.from(saltHex, 'hex'));
  const ok = expected.length === actual.length && timingSafeEqual(expected, actual);
  return ok && stored != null;
}

/** 32 random bytes, hex — the bearer token handed to the client. */
export function newToken(): string {
  return randomBytes(32).toString('hex');
}

/** What the sessions table stores: sha256 of the token. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
