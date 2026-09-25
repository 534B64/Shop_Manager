UPDATE materials SET price_mode='per_inch_max', rate_cents=100 WHERE (name LIKE '%651%' OR name LIKE 'Calendered%') AND price_mode='custom';
--> statement-breakpoint
UPDATE materials SET price_mode='per_inch_max', rate_cents=200 WHERE name LIKE 'Cast%' AND price_mode='custom';
--> statement-breakpoint
UPDATE materials SET price_mode='per_sqft', rate_cents=600 WHERE name LIKE 'Banner%' AND price_mode='custom';
--> statement-breakpoint
UPDATE materials SET price_mode='per_unit', rate_cents=900, min_qty=2 WHERE (name LIKE 'HTV%' OR name LIKE 'Heat transfer%') AND price_mode='custom';
--> statement-breakpoint
UPDATE materials SET price_mode='per_unit', rate_cents=2400, rate2_cents=3000 WHERE (name LIKE 'T-shirt blank%' OR name LIKE 'T-shirt same day%') AND price_mode='custom';
--> statement-breakpoint
UPDATE materials SET price_mode='per_unit', rate_cents=1200 WHERE name LIKE 'T-shirt (customer%' AND price_mode='custom';
--> statement-breakpoint
UPDATE materials SET price_mode='flat', rate_cents=6500, color_multiplier=0 WHERE name LIKE 'Magnet%12x18%' AND price_mode='custom';
--> statement-breakpoint
UPDATE materials SET price_mode='flat', rate_cents=7500, color_multiplier=0 WHERE name LIKE 'Magnet%12x24%' AND price_mode='custom';
--> statement-breakpoint
INSERT INTO materials (name, unit, cost_per_unit_cents, price_mode, rate_cents, rate2_cents, min_qty, color_multiplier, created_at)
SELECT '651 Vinyl','sqft',85,'per_inch_max',100,NULL,1,1,strftime('%Y-%m-%dT%H:%M:%SZ','now')
WHERE NOT EXISTS (SELECT 1 FROM materials WHERE name LIKE '%651%' OR name LIKE 'Calendered%');
--> statement-breakpoint
INSERT INTO materials (name, unit, cost_per_unit_cents, price_mode, rate_cents, rate2_cents, min_qty, color_multiplier, created_at)
SELECT 'Cast vinyl (premium)','sqft',210,'per_inch_max',200,NULL,1,1,strftime('%Y-%m-%dT%H:%M:%SZ','now')
WHERE NOT EXISTS (SELECT 1 FROM materials WHERE name LIKE 'Cast%');
--> statement-breakpoint
INSERT INTO materials (name, unit, cost_per_unit_cents, price_mode, rate_cents, rate2_cents, min_qty, color_multiplier, created_at)
SELECT 'Banner 13oz','sqft',60,'per_sqft',600,NULL,1,1,strftime('%Y-%m-%dT%H:%M:%SZ','now')
WHERE NOT EXISTS (SELECT 1 FROM materials WHERE name LIKE 'Banner%');
--> statement-breakpoint
INSERT INTO materials (name, unit, cost_per_unit_cents, price_mode, rate_cents, rate2_cents, min_qty, color_multiplier, created_at)
SELECT 'T-shirt same day (blank included)','each',450,'per_unit',2400,3000,1,1,strftime('%Y-%m-%dT%H:%M:%SZ','now')
WHERE NOT EXISTS (SELECT 1 FROM materials WHERE name LIKE 'T-shirt blank%' OR name LIKE 'T-shirt same day%');
--> statement-breakpoint
INSERT INTO materials (name, unit, cost_per_unit_cents, price_mode, rate_cents, rate2_cents, min_qty, color_multiplier, created_at)
SELECT 'T-shirt (customer provided)','each',0,'per_unit',1200,NULL,1,1,strftime('%Y-%m-%dT%H:%M:%SZ','now')
WHERE NOT EXISTS (SELECT 1 FROM materials WHERE name LIKE 'T-shirt (customer%');
--> statement-breakpoint
INSERT INTO materials (name, unit, cost_per_unit_cents, price_mode, rate_cents, rate2_cents, min_qty, color_multiplier, created_at)
SELECT 'Heat transfer sheet (ordered shirts)','sheet',250,'per_unit',900,NULL,2,1,strftime('%Y-%m-%dT%H:%M:%SZ','now')
WHERE NOT EXISTS (SELECT 1 FROM materials WHERE name LIKE 'HTV%' OR name LIKE 'Heat transfer%');
--> statement-breakpoint
INSERT INTO materials (name, unit, cost_per_unit_cents, price_mode, rate_cents, rate2_cents, min_qty, color_multiplier, created_at)
SELECT 'Magnet 12x18','each',1200,'flat',6500,NULL,1,0,strftime('%Y-%m-%dT%H:%M:%SZ','now')
WHERE NOT EXISTS (SELECT 1 FROM materials WHERE name LIKE 'Magnet%12x18%');
--> statement-breakpoint
INSERT INTO materials (name, unit, cost_per_unit_cents, price_mode, rate_cents, rate2_cents, min_qty, color_multiplier, created_at)
SELECT 'Magnet 12x24','each',1600,'flat',7500,NULL,1,0,strftime('%Y-%m-%dT%H:%M:%SZ','now')
WHERE NOT EXISTS (SELECT 1 FROM materials WHERE name LIKE 'Magnet%12x24%');
--> statement-breakpoint
INSERT INTO materials (name, unit, cost_per_unit_cents, price_mode, rate_cents, rate2_cents, min_qty, color_multiplier, created_at)
SELECT 'Aluminum sign','each',0,'custom',0,NULL,1,1,strftime('%Y-%m-%dT%H:%M:%SZ','now')
WHERE NOT EXISTS (SELECT 1 FROM materials WHERE name LIKE 'Aluminum%');
--> statement-breakpoint
INSERT INTO materials (name, unit, cost_per_unit_cents, price_mode, rate_cents, rate2_cents, min_qty, color_multiplier, created_at)
SELECT 'Full color print','sqft',0,'custom',0,NULL,1,1,strftime('%Y-%m-%dT%H:%M:%SZ','now')
WHERE NOT EXISTS (SELECT 1 FROM materials WHERE name LIKE 'Full color%');
