-- Wave 1 fix (2026-09-26, ADR 0007): an invoice void records what it actually
-- cancelled — the invoice total and tax minus the returns already taken on it —
-- so a Z-report never counts returned goods twice (once as a return, again in
-- the void). Hand-written like 0009–0016.
ALTER TABLE `invoice_voids` ADD `net_total_cents` integer;--> statement-breakpoint
ALTER TABLE `invoice_voids` ADD `net_tax_cents` integer;--> statement-breakpoint
-- Backfill voids made before this migration (invoice_voids is append-only, so
-- the guard trigger is lifted just for this and put back unchanged).
DROP TRIGGER `invoice_voids_no_update`;--> statement-breakpoint
UPDATE `invoice_voids` SET
	`net_total_cents` = (SELECT i.`total_cents` FROM `invoices` i WHERE i.`id` = `invoice_voids`.`invoice_id`)
		- coalesce((SELECT sum(r.`total_cents`) FROM `returns` r WHERE r.`invoice_id` = `invoice_voids`.`invoice_id`), 0),
	`net_tax_cents` = (SELECT i.`tax_cents` FROM `invoices` i WHERE i.`id` = `invoice_voids`.`invoice_id`)
		- coalesce((SELECT sum(r.`tax_cents`) FROM `returns` r WHERE r.`invoice_id` = `invoice_voids`.`invoice_id`), 0);--> statement-breakpoint
CREATE TRIGGER `invoice_voids_no_update` BEFORE UPDATE ON `invoice_voids`
BEGIN SELECT RAISE(ABORT, 'invoice_voids is append-only'); END;
