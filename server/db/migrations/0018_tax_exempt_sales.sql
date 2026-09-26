-- Owner decision D10 (2026-09-26, ADR 0007): counter sales are taxed by
-- default; a sale rung up tax-exempt records that on its invoice with the
-- reason given (resale certificate, nonprofit, ...). Hand-written like
-- 0009–0017. Adding columns doesn't touch the invoices guard triggers.
ALTER TABLE `invoices` ADD `tax_exempt` integer NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE `invoices` ADD `tax_exempt_reason` text;
