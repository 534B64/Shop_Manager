-- Roll SKU data integrity (Phase 11, promoted in the 2026-06-30 triage).
-- One SKU per material + color + nominal width, enforced by the DB itself —
-- the old app-level duplicate check was racy (two counter PCs could both pass
-- the check, then both insert). Color compares case-insensitively so
-- 'Red' and 'red' can never coexist. Scoped to ACTIVE roll SKUs so a retired
-- (deactivated) SKU never blocks re-adding the same roll later.
CREATE UNIQUE INDEX IF NOT EXISTS `roll_sku_unique`
  ON `inventory_items` (`material_id`, lower(`color`), `nominal_width_in`)
  WHERE `material_id` IS NOT NULL AND `nominal_width_in` IS NOT NULL AND `active` = 1;
