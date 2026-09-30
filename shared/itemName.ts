// Display name for an inventory item, built from its structured fields —
// the one place that decides what "Red 651 15″" looks like. The server stores
// this in `inventory_items.name` when no custom name was given; the client
// uses it for the "Leave blank to use: …" hint.

export interface ItemNameParts {
  color?: string | null;
  /** Category name (e.g. "651", "Cast", "T-shirt blank"). */
  categoryName?: string | null;
  /** Roll SKUs (material + color + width) use the material's name in place of the category. */
  materialName?: string | null;
  sizeText?: string | null;
  nominalWidthIn?: number | null;
  countUnit?: string | null;
}

const INCH = '″';
const PLAIN_INCHES = /^(\d+(?:\.\d+)?)\s*(?:in|inch|inches|"|″|”)?$/i;

const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

/** "15", "15in", '15"' → "15″"; anything else ("L", "12x18") stays as typed. */
export function formatSize(sizeText?: string | null, nominalWidthIn?: number | null): string {
  const text = clean(sizeText);
  if (text) {
    const m = PLAIN_INCHES.exec(text);
    return m ? `${m[1]}${INCH}` : text;
  }
  return nominalWidthIn != null && Number.isFinite(nominalWidthIn) ? `${nominalWidthIn}${INCH}` : '';
}

/** True when there is enough structure (category, material, color or size) to build a name. */
export function canBuildItemName(p: ItemNameParts): boolean {
  return [p.materialName, p.categoryName, p.color, formatSize(p.sizeText, p.nominalWidthIn)].some((x) => clean(x) !== '');
}

/**
 * Color, then category (or material), then size — blanks skipped, repeats dropped.
 * The count unit is appended only when there is no category/material to say what
 * the thing is ("Red 15″ roll") and it isn't the bland default "each".
 */
export function itemDisplayName(p: ItemNameParts): string {
  const what = clean(p.materialName) || clean(p.categoryName);
  const parts = [clean(p.color), what, formatSize(p.sizeText, p.nominalWidthIn)].filter(Boolean);
  const unit = clean(p.countUnit);
  if (!what && parts.length > 0 && unit && unit.toLowerCase() !== 'each') parts.push(unit);
  const seen = new Set<string>();
  return parts.filter((x) => {
    const k = x.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).join(' ');
}
