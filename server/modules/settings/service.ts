// Settings access (ADR 0003). The one implementation of "read a setting" —
// previously duplicated across four route files. The admin gate that used to
// live here was replaced by roles (modules/auth, ADR 0004).
import { eq } from 'drizzle-orm';
import { db, type Db } from '../../db/index.js';
import { settings } from '../../db/schema/index.js';
import { DEFAULT_TAX_RATE_PCT } from '../../../shared/domain.js';

export async function getSetting(key: string, dbx: Db = db): Promise<string | null> {
  const [row] = await dbx.select().from(settings).where(eq(settings.key, key));
  return row?.value ?? null;
}

/** Upsert one setting. Pass the caller's transaction (ADR 0005). */
export async function setSetting(key: string, value: string, dbx: Db = db): Promise<void> {
  const [row] = await dbx.select().from(settings).where(eq(settings.key, key));
  if (row) await dbx.update(settings).set({ value }).where(eq(settings.key, key));
  else await dbx.insert(settings).values({ key, value });
}

/** Sales-tax rate — the default when never configured. */
export async function taxRatePct(dbx: Db = db): Promise<number> {
  const v = await getSetting('taxRatePct', dbx);
  return v != null ? Number(v) : DEFAULT_TAX_RATE_PCT;
}
