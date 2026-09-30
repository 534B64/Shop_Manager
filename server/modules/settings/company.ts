// The company name (`companyName` setting) — what the app shows in its title,
// top bar, sign-in screen and printed sheets, next to the product name.
import { db, type Db } from '../../db/index.js';
import { customers, inventoryItems, invoices, jobs, payments } from '../../db/schema/index.js';
import { cleanCompanyName } from '../../../shared/branding.js';
import { getSetting, setSetting } from './service.js';

export const COMPANY_KEY = 'companyName';

/** The shop this software was first built for. Used ONLY as the default for an
 *  existing install that already holds business data but never named itself. */
export const ORIGINAL_SHOP_NAME = 'Decals Plus';

/** The company name; '' when none is set. */
export async function getCompanyName(dbx: Db = db): Promise<string> {
  return cleanCompanyName(await getSetting(COMPANY_KEY, dbx));
}

/** Default for an install that has no setting yet: the Setup-saved SHOP_NAME, else the
 *  original shop's name when the database already has business data, else blank. */
export function resolveDefaultCompanyName(o: { shopEnvName?: string | null; hasData: boolean }): string {
  return cleanCompanyName(o.shopEnvName) || (o.hasData ? ORIGINAL_SHOP_NAME : '');
}

/** True when the shop has really been used (customers, jobs, payments, stock or invoices). */
export async function hasShopData(dbx: Db = db): Promise<boolean> {
  for (const t of [customers, jobs, payments, inventoryItems, invoices]) {
    if ((await dbx.select({ one: t.id }).from(t).limit(1)).length > 0) return true;
  }
  return false;
}

/** Server start: write the default once, so it never changes later as data arrives. Not audited —
 *  it is the system adopting its own configuration, not a user's change. */
export async function ensureCompanyName(shopEnvName: string | null, dbx: Db = db): Promise<string> {
  if ((await getSetting(COMPANY_KEY, dbx)) != null) return getCompanyName(dbx);
  const name = resolveDefaultCompanyName({ shopEnvName, hasData: await hasShopData(dbx) });
  await setSetting(COMPANY_KEY, name, dbx);
  return name;
}
