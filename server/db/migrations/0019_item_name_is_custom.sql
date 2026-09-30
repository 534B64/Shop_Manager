-- Optional item names (2026-09-29): an item's name is built from its color,
-- category and size unless the owner typed a custom one. Every existing row
-- was named by hand, so it backfills as custom (DEFAULT 1) and nothing changes.
-- New rows default to generated (0) through the app's insert.
-- Hand-written like 0009–0018.
ALTER TABLE `inventory_items` ADD `name_is_custom` integer NOT NULL DEFAULT 1;
