// Product and company branding. "Shop Manager" is the product; the company
// name comes from the admin-editable `companyName` setting — never hardcode a
// company anywhere else.

export const PRODUCT_NAME = 'Shop Manager';
export const COMPANY_NAME_MAX = 80;

/** Trim and collapse whitespace; anything that is not a string becomes ''. */
export const cleanCompanyName = (v: unknown): string =>
  (typeof v === 'string' ? v : '').replace(/\s+/g, ' ').trim().slice(0, COMPANY_NAME_MAX);

/** "Acme Signs · Shop Manager", or just "Shop Manager" when no company is set. */
export function brandName(company: string | null | undefined): string {
  const c = cleanCompanyName(company);
  return c ? `${c} · ${PRODUCT_NAME}` : PRODUCT_NAME;
}

/** The company name for a printed sheet's heading (the product name when unset). */
export const printHeading = (company: string | null | undefined): string => cleanCompanyName(company) || PRODUCT_NAME;

/** Two-letter badge for the nav rail: "Decals Plus" → "DP", "Acme" → "AC", none → "SM". */
export function brandInitials(company: string | null | undefined): string {
  const words = cleanCompanyName(company).split(' ').filter(Boolean);
  if (words.length === 0) return 'SM';
  const letters = words.length > 1 ? words[0][0] + words[1][0] : words[0].slice(0, 2);
  return letters.toUpperCase();
}
