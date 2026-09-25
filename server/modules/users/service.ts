// Account verification — LAN-trust attribution, not security (see the note
// in routes.ts). The one implementation other modules may consume.
import { eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { users } from '../../db/schema/index.js';

export async function verifyUser(name: string, password: string): Promise<boolean> {
  const [u] = await db.select().from(users).where(eq(users.name, name));
  if (!u || !u.active) return false;
  return (u.password ?? '') === password;
}
