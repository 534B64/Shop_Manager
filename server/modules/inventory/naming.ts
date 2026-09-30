// Item names: a custom name the owner typed, or one built from the item's
// structured fields (shared/itemName.ts) and stored in `name` so every reader
// (search, reports, CSV, POS lines) keeps working.
import { and, eq } from 'drizzle-orm';
import type { Db } from '../../db/index.js';
import { categories, inventoryItems, materials } from '../../db/schema/index.js';
import { canBuildItemName, itemDisplayName, type ItemNameParts } from '../../../shared/itemName.js';

export const NAME_NEEDS_STRUCTURE = 'Give the item a name, or pick a category, color or size so one can be built from them.';

type ItemFields = {
  categoryId?: number | null; materialId?: number | null; color?: string | null;
  sizeText?: string | null; nominalWidthIn?: number | null; countUnit?: string | null;
};

/** The name parts for an item's fields (category and material names looked up). */
async function nameParts(f: ItemFields, tx: Db): Promise<ItemNameParts> {
  const [cat] = f.categoryId != null ? await tx.select().from(categories).where(eq(categories.id, f.categoryId)) : [];
  const [mat] = f.materialId != null ? await tx.select().from(materials).where(eq(materials.id, f.materialId)) : [];
  return { color: f.color, categoryName: cat?.name, materialName: mat?.name,
    sizeText: f.sizeText, nominalWidthIn: f.nominalWidthIn, countUnit: f.countUnit };
}

/** The generated name for these fields, or null when there is nothing to build it from. */
export async function generatedItemName(f: ItemFields, tx: Db): Promise<string | null> {
  const parts = await nameParts(f, tx);
  return canBuildItemName(parts) ? itemDisplayName(parts) : null;
}

/** Re-sync every generated (non-custom) item's name, optionally only for one category or material. */
export async function refreshGeneratedNames(tx: Db, scope: { categoryId?: number; materialId?: number }): Promise<number> {
  const where = scope.categoryId != null ? eq(inventoryItems.categoryId, scope.categoryId) : eq(inventoryItems.materialId, scope.materialId ?? -1);
  const rows = await tx.select().from(inventoryItems).where(and(eq(inventoryItems.nameIsCustom, false), where));
  let changed = 0;
  for (const r of rows) {
    const name = await generatedItemName(r, tx);
    if (name && name !== r.name) {
      await tx.update(inventoryItems).set({ name }).where(eq(inventoryItems.id, r.id));
      changed++;
    }
  }
  return changed;
}
