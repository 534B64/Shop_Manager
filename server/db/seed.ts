// Realistic dev seed data for Decals Plus.
// Idempotent: materials only when the table is empty; sample jobs only when there are none;
// demo accounts only when missing by name.
//
// Demo accounts (DEV ONLY — roles + PINs, ADR 0004):
//   Josiah — admin   — PIN 1234
//   Amy    — manager — PIN 2222
//   Sam    — cashier — PIN 3333
import { sql } from 'drizzle-orm';
import { db, runMigrations, withTx } from './index.js';
import { customers, materials, jobs, payments, invoices, invoiceLines } from './schema/index.js';
import { seedDemoUsers } from './seed-users.js';

await runMigrations();
const usersAdded = await seedDemoUsers();

// The price book may already be inserted by the migrations — only seed materials
// when the table is empty, so we never create duplicate rows.
if ((await db.select().from(materials)).length === 0) {
await db.insert(materials).values([
  { name: '651 Vinyl', unit: 'sqft', costPerUnitCents: 85, priceMode: 'per_inch_max', rateCents: 100, usesRoll: true },
  { name: 'Cast vinyl (premium)', unit: 'sqft', costPerUnitCents: 210, priceMode: 'per_inch_max', rateCents: 200, usesRoll: true },
  { name: 'Banner 13oz', unit: 'sqft', costPerUnitCents: 60, priceMode: 'per_sqft', rateCents: 600 },
  { name: 'T-shirt same day (blank included)', unit: 'each', costPerUnitCents: 450, priceMode: 'per_unit', rateCents: 2400, rate2Cents: 3000 },
  { name: 'T-shirt (customer provided)', unit: 'each', costPerUnitCents: 0, priceMode: 'per_unit', rateCents: 1200 },
  { name: 'Heat transfer sheet (ordered shirts)', unit: 'sheet', costPerUnitCents: 250, priceMode: 'per_unit', rateCents: 900, minQty: 2 },
  { name: 'Magnet 12x18', unit: 'each', costPerUnitCents: 1200, priceMode: 'flat', rateCents: 6500, colorMultiplier: false },
  { name: 'Magnet 12x24', unit: 'each', costPerUnitCents: 1600, priceMode: 'flat', rateCents: 7500, colorMultiplier: false },
  { name: 'Aluminum sign', unit: 'each', costPerUnitCents: 0, priceMode: 'custom', rateCents: 0 },
  { name: 'Full color print', unit: 'sqft', costPerUnitCents: 0, priceMode: 'custom', rateCents: 0 },
  // Add-on line items — picked on a line, priced flat (no color multiplier).
  { name: 'T-shirt blank', unit: 'each', costPerUnitCents: 350, priceMode: 'flat', rateCents: 600, colorMultiplier: false, isAddon: true },
  { name: 'Squeegee', unit: 'each', costPerUnitCents: 150, priceMode: 'flat', rateCents: 400, colorMultiplier: false, isAddon: true },
  { name: 'Other (manual price)', unit: 'each', costPerUnitCents: 0, priceMode: 'custom', rateCents: 0, colorMultiplier: false, isAddon: true },
]);
}

// Sample customers + jobs are dev-only example data. Add them only when there are no
// jobs yet, so seeding after migrations (or re-running the seed) never duplicates them.
if ((await db.select().from(jobs)).length > 0) {
  console.log('Seed skipped — sample jobs already present.');
  process.exit(0);
}

const custRows = await db
  .insert(customers)
  .values([
    { name: 'Hendricks Plumbing', phone: '555-0142', notes: 'Repeat — van decals yearly' },
    { name: 'Riverside HS Boosters', phone: '555-0177', notes: 'Tax-exempt; PO required' },
    { name: 'Walk-in', notes: 'Generic walk-in counter customer' },
  ])
  .returning({ id: customers.id });

const today = new Date();
const iso = (offsetDays: number) => {
  const d = new Date(today);
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
};

const jobRows = await db.insert(jobs).values([
  {
    customerId: custRows[0].id,
    type: 'decal',
    title: 'Van door decals x2 (logo + phone)',
    status: 'in_progress',
    dueDate: iso(2),
    suggestedPriceCents: 14500,
    finalPriceCents: 15000,
  },
  {
    customerId: custRows[1].id,
    type: 'apparel',
    title: 'Booster club tees, 24 ct, 2-color front',
    status: 'approved',
    useProofFlow: true,
    dueDate: iso(7),
    suggestedPriceCents: 36000,
    finalPriceCents: 34800,
    notes: 'Proof to treasurer before press',
  },
  {
    customerId: custRows[0].id,
    type: 'magnet',
    title: 'Magnet plates 12x18 pair',
    status: 'done',
    dueDate: iso(-1),
    finalPriceCents: 9000,
  },
  {
    customerId: custRows[2].id,
    type: 'sign',
    title: '4x8 banner — grand opening',
    status: 'acknowledged',
    dueDate: iso(4),
    suggestedPriceCents: 12800,
    finalPriceCents: 12800,
  },
  {
    customerId: custRows[2].id,
    type: 'retail',
    title: 'Stock flag decal, 5in',
    status: 'picked_up',
    finalPriceCents: 800,
  },
]).returning();

// The picked-up counter sale is sold: paid by card and invoiced (Phase 3,
// ADR 0007) — the invoice number comes from the gap-free sequence.
const sold = jobRows.find((j) => j.status === 'picked_up')!;
await withTx(async (tx) => {
  const [{ n }] = await tx.all<{ n: number }>(sql`UPDATE number_sequences SET next_value = next_value + 1
    WHERE name = 'invoice' RETURNING next_value - 1 AS n`);
  const [inv] = await tx.insert(invoices).values({
    number: Number(n), jobId: sold.id, customerId: sold.customerId, customerName: 'Walk-in', title: sold.title,
    source: 'counter_sale', taxRatePct: 8.25, subtotalCents: 800, taxCents: 0, totalCents: 800, createdBy: 'Josiah',
  }).returning();
  await tx.insert(invoiceLines).values({ invoiceId: inv.id, lineNo: 1, description: sold.title, qty: 1,
    unitPriceCents: 800, subtotalCents: 800, taxable: false, taxRatePct: 0, taxCents: 0, totalCents: 800 });
  await tx.insert(payments).values({ jobId: sold.id, amountCents: 800, method: 'card', createdBy: 'Josiah' });
});

console.log(`Seed complete: price book ensured, ${usersAdded} demo account(s) added, sample customers/jobs ensured.`);
process.exit(0);
