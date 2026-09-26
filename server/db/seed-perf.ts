// Performance test-data seeder — NOT for real data. Fills a throwaway SQLite
// file with realistic shop volume so page/endpoint timings mean something:
//   ~5,000 inventory items (incl. roll SKUs), ~500 customers, ~3,000 jobs with
//   line items, ~20,000 inventory adjustments over the last 2 years, payments
//   for most jobs, plus weekly cycle counts. Also the demo accounts
//   (Josiah admin 1234, Amy manager 2222, Sam cashier 3333 — see seed-users.ts)
//   so perf:baseline can sign in.
//
// Usage:  DB_PATH=./data/perf-test.db npm run db:seed:perf
//
// Refuses to run unless DB_PATH is set explicitly AND does not contain
// "dp-erp.db" (the production filename). Refuses a DB that already has jobs
// or customers (delete the file and rerun). Deterministic: a seeded PRNG and a
// fixed anchor date, so every run produces identical data.
import { requireSafePerfDb } from './perf-guard.js';

requireSafePerfDb('db:seed:perf');

// Dynamic import: server/db/index.ts reads DB_PATH (and creates the file) at
// import time, so the guard above must run first.
const { db, runMigrations } = await import('./index.js');
const S = await import('./schema/index.js');
const { sql } = await import('drizzle-orm');
const { seedDemoUsers } = await import('./seed-users.js');
const { txnTypeForReason } = await import('../../shared/domain.js');
const { buildZReport } = await import('../../shared/invoice.js');

const ANCHOR = new Date('2026-09-25T17:00:00.000Z'); // fixed → repeatable data
const DAY = 86_400_000;
const BATCH = 200; // rows per INSERT — stays well under SQLite's variable limit

// mulberry32 — tiny deterministic PRNG.
let seed = 0x5eed_1234;
function rand(): number {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
const pick = <T>(a: readonly T[]): T => a[Math.floor(rand() * a.length)];
const chance = (p: number) => rand() < p;
const isoAgo = (daysAgo: number) =>
  new Date(ANCHOR.getTime() - daysAgo * DAY - int(0, DAY - 1)).toISOString();
const code = (prefix: string, n: number) => `${prefix}${String(n).padStart(6, '0')}`;
// EAN-ish 12-digit numeric barcode, deterministic from n.
const barcode = (n: number) => String(400_000_000_000 + n * 7919).slice(0, 12);

async function insertBatched<T extends Record<string, unknown>>(
  tx: { insert: (t: any) => any }, table: unknown, rows: T[], returningIds: boolean,
): Promise<number[]> {
  const ids: number[] = [];
  for (let i = 0; i < rows.length; i += BATCH) {
    const q = tx.insert(table).values(rows.slice(i, i + BATCH));
    if (returningIds) {
      const out = (await q.returning({ id: (table as any).id })) as { id: number }[];
      for (const r of out) ids.push(r.id);
    } else {
      await q;
    }
  }
  return ids;
}

const t0 = Date.now();
await runMigrations();

const [{ jobs: nJobs, customers: nCust, items: nItems }] = (await db.all(
  sql`select (select count(*) from jobs) as jobs, (select count(*) from customers) as customers, (select count(*) from inventory_items) as items`,
)) as { jobs: number; customers: number; items: number }[];
if (nJobs > 0 || nCust > 0 || nItems > 0) {
  console.error(`db:seed:perf: ${process.env.DB_PATH} already has data (jobs=${nJobs}, customers=${nCust}, items=${nItems}). Delete the file and rerun.`);
  process.exit(1);
}

await seedDemoUsers();

// ---------------- reference data ----------------
const CATEGORY_NAMES = ['Vinyl Rolls', 'T-Shirt Blanks', 'Hardware', 'Sign Blanks', 'Magnets', 'Ink & Consumables', 'Banner & Mesh', 'Packaging'];
const SUPPLIER_NAMES = ['Grimco', 'Coastal Vinyl Supply', 'Blank Apparel Direct', 'Sign Warehouse', 'Uline', 'Magnum Magnetics'];
const COLORS = ['Black', 'White', 'Red', 'Blue', 'Yellow', 'Green', 'Orange', 'Silver', 'Gold', 'Gray', 'Brown', 'Purple', 'Pink', 'Navy', 'Lt Blue'];
const WIDTHS = [12, 15, 24, 30, 48];

await db.transaction(async (tx) => {
  const catIds = await insertBatched(tx, S.categories,
    CATEGORY_NAMES.map((name, i) => ({ name, sort: i, tracksColor: i === 0, defaultUnit: i === 0 ? 'roll' : 'each' })), true);
  const supIds = await insertBatched(tx, S.suppliers,
    SUPPLIER_NAMES.map((name, i) => ({ name, leadTimeDays: 3 + i * 2, contact: `orders@${name.toLowerCase().replace(/[^a-z]+/g, '')}.example` })), true);

  // Materials: reuse the price book the migrations installed; make sure there
  // are at least three roll materials to hang roll SKUs on.
  let mats = await tx.select().from(S.materials);
  const rollNames = ['651 Vinyl', 'Cast Vinyl (Premium)', 'Reflective Vinyl'];
  const haveRoll = mats.filter((m) => m.usesRoll);
  const toAdd = rollNames.slice(haveRoll.length);
  if (toAdd.length) {
    await insertBatched(tx, S.materials, toAdd.map((name) => ({
      name, unit: 'sqft', costPerUnitCents: int(80, 300), priceMode: 'per_inch_max', rateCents: int(100, 250), usesRoll: true,
    })), false);
    mats = await tx.select().from(S.materials);
  }
  const rollMats = mats.filter((m) => m.usesRoll).slice(0, 4);
  const quotable = mats.filter((m) => m.active && !m.isAddon);
  const colorRows = rollMats.flatMap((m) => COLORS.map((name) => ({ materialId: m.id, name })));
  await insertBatched(tx, S.materialColors, colorRows, false);

  // ---------------- inventory items (5,000) ----------------
  const items: (typeof S.inventoryItems.$inferInsert)[] = [];
  let n = 0;
  for (const m of rollMats) {
    for (const color of COLORS) {
      for (const w of WIDTHS) {
        n++;
        items.push({
          name: `${m.name.split(' ')[0]} · ${color} · ${w}in`, count: int(0, 12), lowStockThreshold: int(1, 3),
          materialId: m.id, color, nominalWidthIn: w, categoryId: catIds[0], supplierId: supIds[int(0, 1)],
          purchaseUnit: 'roll', countUnit: 'roll', purchaseToCountFactor: 1, reorderMaxQty: int(6, 15),
          lastCostCents: int(4000, 21000), avgDailyUse: chance(0.7) ? Math.round(rand() * 30) / 100 : null,
          custom: `UPC ${barcode(n)}`, createdAt: isoAgo(int(400, 730)),
        });
      }
    }
  }
  const NOUNS: Record<number, string[]> = {
    1: ['Gildan 5000 Tee', 'Bella 3001 Tee', 'Gildan 18500 Hoodie', 'Port Co Polo', 'Youth Tee'],
    2: ['Hex Bolt', 'Nylon Washer', 'Mounting Bracket', 'Zip Tie', 'Rivet', 'Sign Post Clamp', 'Wall Anchor'],
    3: ['Aluminum Blank', 'Coroplast Sheet', 'PVC Board', 'ACM Panel', 'Yard Sign H-Stake'],
    4: ['Magnet Sheet', 'Magnet Roll', 'Pre-cut Magnet'],
    5: ['Eco-Sol Ink Cartridge', 'Squeegee Felt', 'Transfer Tape', 'Cutting Blade', 'Weeding Tool', 'Cleaning Wipes'],
    6: ['13oz Banner Roll', 'Mesh Banner Roll', 'Grommet Kit', 'Hem Tape'],
    7: ['Poly Mailer', 'Shipping Tube', 'Carton', 'Packing Tape', 'Label Sheet'],
  };
  const SIZES = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4in', '6in', '12in', '18in', '24in', '#8', '#10', '1/4"', '3/8"', '5/16"'];
  while (items.length < 5000) {
    n++;
    const ci = int(1, 7);
    const noun = pick(NOUNS[ci]);
    const size = pick(SIZES);
    const color = ci === 1 || ci === 4 ? pick(COLORS) : null;
    items.push({
      name: `${noun}${color ? ` ${color}` : ''} ${size} #${n}`, count: int(0, 400), lowStockThreshold: int(0, 40),
      categoryId: catIds[ci], supplierId: supIds[int(0, supIds.length - 1)], sizeText: size, color,
      purchaseUnit: pick(['each', 'box', 'case']), countUnit: 'each', purchaseToCountFactor: pick([1, 1, 12, 25, 100]),
      reorderMaxQty: chance(0.6) ? int(50, 600) : null, lastCostCents: int(25, 9000),
      avgDailyUse: chance(0.5) ? Math.round(rand() * 500) / 100 : null,
      custom: `UPC ${barcode(n)}`, orderNote: chance(0.05) ? 'Backorder risk — order early' : null,
      createdAt: isoAgo(int(30, 730)),
    });
  }
  // On-hand only moves through the ledger (ADR 0006): items go in at 0 and
  // reach their target count via the ledger rows built further down.
  const targetCounts = items.map((i) => i.count as number);
  for (const i of items) {
    i.count = 0;
    const f = i.purchaseToCountFactor && i.purchaseToCountFactor > 0 ? i.purchaseToCountFactor : 1;
    i.avgCostCents = i.lastCostCents != null ? Math.round(i.lastCostCents / f) : 0;
  }
  const itemIds = await insertBatched(tx, S.inventoryItems, items, true);

  // ---------------- customers (500) ----------------
  const FIRST = ['Mike', 'Sarah', 'Dave', 'Linda', 'Chris', 'Tanya', 'Jose', 'Priya', 'Ken', 'Ana', 'Tom', 'Beth', 'Raj', 'Lily', 'Omar'];
  const LAST = ['Hendricks', 'Nguyen', 'Alvarez', 'Miller', 'Patel', 'Johnson', 'Okafor', 'Kim', 'Brown', 'Reyes', 'Schmidt', 'Walker'];
  const BIZ = ['Plumbing', 'Roofing', 'Landscaping', 'Auto Repair', 'Diner', 'HS Boosters', 'Electric', 'Bakery', 'Fitness', 'Towing', 'Realty', 'Farms'];
  const custs = Array.from({ length: 500 }, (_, i) => {
    const biz = chance(0.6);
    const name = biz ? `${pick(LAST)} ${pick(BIZ)}` : `${pick(FIRST)} ${pick(LAST)}`;
    return {
      name: `${name}`, phone: `(555) ${int(200, 999)}-${String(int(0, 9999)).padStart(4, '0')}`,
      email: `contact${i + 1}@${pick(LAST).toLowerCase()}${i}.example`, level: chance(0.85) ? 0 : int(1, 3),
      notes: chance(0.15) ? 'Repeat customer' : null, createdAt: isoAgo(int(1, 730)),
    };
  });
  const custIds = await insertBatched(tx, S.customers, custs, true);

  // ---------------- jobs (3,000) + job_items + payments ----------------
  const STATUS_MIX = ['quote', 'acknowledged', 'in_progress', 'done', 'picked_up'] as const;
  const TYPES = ['decal', 'sign', 'apparel', 'magnet', 'retail'] as const;
  const TITLES = ['Van door decals', 'Storefront window vinyl', '4x8 banner', 'Yard signs x25', 'Team shirts x18', 'Magnet set', 'Vehicle wrap partial', 'Trailer lettering', 'A-frame insert', 'Cut vinyl lettering'];
  const poSeq = new Map<string, number>();
  const jobRows: (typeof S.jobs.$inferInsert)[] = [];
  const jobMeta: { total: number; status: string; createdAt: string; deleted: boolean }[] = [];
  for (let i = 0; i < 3000; i++) {
    const daysAgo = Math.floor(rand() * rand() * 730 * 1.0 + rand() * 60); // skew recent
    const createdAt = isoAgo(Math.min(daysAgo, 729));
    const d = new Date(createdAt);
    const day = String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0') + String(d.getFullYear()).slice(2);
    const seq = (poSeq.get(day) ?? 0) + 1;
    poSeq.set(day, seq);
    // Old jobs are overwhelmingly finished; recent ones spread across the pipeline.
    const status = daysAgo > 45 ? (chance(0.97) ? 'picked_up' : pick(STATUS_MIX)) : pick(STATUS_MIX);
    const mat = pick(quotable);
    const final = int(25, 1500) * 100; // $25–$1,500
    const total = Math.round(final * 1.07);
    const deleted = chance(0.02);
    jobRows.push({
      clientRef: `perf-${String(i).padStart(8, '0')}-${(i * 2654435761 >>> 0).toString(16)}`,
      customerId: custIds[int(0, custIds.length - 1)], po: `${day}${String(seq).padStart(3, '0')}`,
      type: pick(TYPES), title: `${pick(TITLES)} #${i + 1}`, tags: chance(0.3) ? 'rush,repeat' : null,
      status, quantity: int(1, 25), widthIn: int(4, 96), heightIn: int(4, 48), mainColorMult: pick([1, 1, 1, 2, 3]),
      materialId: mat.id, materialCostSnapshotCents: mat.costPerUnitCents, suggestedPriceCents: final, finalPriceCents: final,
      totalCents: total, taxRatePct: 7, taxable: true, createdBy: pick(['josiah', 'amy', 'counter']),
      dueDate: new Date(d.getTime() + int(1, 14) * DAY).toISOString().slice(0, 10),
      deletedAt: deleted ? createdAt : null, createdAt,
    });
    jobMeta.push({ total, status, createdAt, deleted });
  }
  const jobIds = await insertBatched(tx, S.jobs, jobRows, true);

  const itemRows: (typeof S.jobItems.$inferInsert)[] = [];
  const payRows: (typeof S.payments.$inferInsert)[] = [];
  const invoiceable: { i: number; jobId: number }[] = [];
  jobIds.forEach((jobId, i) => {
    const meta = jobMeta[i];
    for (let k = int(0, 3); k > 0; k--) {
      const m = pick(quotable);
      itemRows.push({
        jobId, type: pick(TYPES), title: pick(TITLES), materialId: m.id, widthIn: int(2, 60), heightIn: int(2, 36),
        colorMult: pick([1, 1, 2]), qty: int(1, 20), priceCents: int(500, 40000),
      });
    }
    // Payments for most jobs: paid/picked-up mostly settle in 1–2 payments;
    // in-progress jobs often carry a deposit; quotes carry nothing.
    if (meta.status === 'quote' || meta.deleted) return;
    const settled = meta.status === 'picked_up' || (meta.status === 'done' && chance(0.6));
    const methods = ['cash', 'check', 'card', 'card', 'cash', 'other'];
    if (settled) {
      invoiceable.push({ i, jobId });
      if (chance(0.3)) {
        const dep = Math.round(meta.total * 0.5);
        payRows.push({ clientRef: `perfpay-${i}-a`, jobId, amountCents: dep, method: pick(methods), createdAt: meta.createdAt });
        payRows.push({ clientRef: `perfpay-${i}-b`, jobId, amountCents: meta.total - dep, method: pick(methods), createdAt: meta.createdAt });
      } else {
        payRows.push({ clientRef: `perfpay-${i}-a`, jobId, amountCents: meta.total, method: pick(methods), createdAt: meta.createdAt });
      }
      if (chance(0.01)) payRows.push({ clientRef: `perfpay-${i}-r`, jobId, amountCents: Math.round(meta.total * 0.2), method: 'cash', kind: 'refund', createdAt: meta.createdAt });
      if (chance(0.01)) payRows.push({ clientRef: `perfpay-${i}-v`, jobId, amountCents: 500, method: 'cash', voidedAt: meta.createdAt, voidReason: 'entered wrong', createdAt: meta.createdAt });
    } else if (chance(0.5)) {
      payRows.push({ clientRef: `perfpay-${i}-d`, jobId, amountCents: Math.round(meta.total * 0.5), method: pick(methods), createdAt: meta.createdAt });
    }
  });
  await insertBatched(tx, S.jobItems, itemRows, false);
  await insertBatched(tx, S.payments, payRows, false);

  // ---------------- invoices (Phase 3, ADR 0007) ----------------
  // Every settled job has its invoice, numbered in date order (no PRNG draws,
  // so the rest of the data is unchanged). The gap-free trigger only accepts
  // the number the sequence just handed out, so invoices go in one at a time
  // inside this transaction; their lines are batched.
  const custName = new Map(custIds.map((id, k) => [id, custs[k].name]));
  invoiceable.sort((a, b) => (jobRows[a.i].createdAt as string).localeCompare(jobRows[b.i].createdAt as string) || a.i - b.i);
  const lineRows: (typeof S.invoiceLines.$inferInsert)[] = [];
  for (const { i, jobId } of invoiceable) {
    const j = jobRows[i];
    const sub = j.finalPriceCents as number;
    const total = jobMeta[i].total;
    const [{ n }] = (await tx.all(sql`UPDATE number_sequences SET next_value = next_value + 1
      WHERE name = 'invoice' RETURNING next_value - 1 AS n`)) as { n: number }[];
    const [inv] = await tx.insert(S.invoices).values({
      number: Number(n), jobId, customerId: j.customerId, customerName: custName.get(j.customerId as number) ?? null,
      jobPo: j.po, title: j.title, source: 'job', taxRatePct: 7, subtotalCents: sub, taxCents: total - sub,
      discountPct: 0, discountCents: 0, totalCents: total, createdBy: j.createdBy, createdAt: j.createdAt,
    }).returning({ id: S.invoices.id });
    const qty = (j.quantity as number) || 1;
    lineRows.push({
      invoiceId: inv.id, lineNo: 1, description: j.title, qty, unitPriceCents: Math.round(sub / qty),
      subtotalCents: sub, suggestedCents: j.suggestedPriceCents, taxable: true, taxRatePct: 7,
      taxCents: total - sub, discountCents: 0, totalCents: total,
    });
  }
  await insertBatched(tx, S.invoiceLines, lineRows, false);

  // ---------------- drawer sessions (one closed session per day, 1 yr) ----------------
  const [owner] = await tx.select().from(S.users).where(sql`role = 'admin'`).limit(1);
  const drawerRows = Array.from({ length: 365 }, (_, k) => {
    const day = new Date(ANCHOR.getTime() - (365 - k) * DAY);
    const openedAt = new Date(day.setUTCHours(14, 0, 0, 0)).toISOString();
    const closedAt = new Date(day.setUTCHours(23, 0, 0, 0)).toISOString();
    const z = buildZReport({ openingFloatCents: 15000, payments: [], invoices: [], voids: [], returns: [],
      countedCashCents: 15000, countedChecksCents: null });
    return { registerId: 1, status: 'closed' as const, openedAt, openedBy: owner.id, openingFloatCents: 15000,
      closedAt, closedBy: owner.id, expectedCashCents: 15000, countedCashCents: 15000, overShortCents: 0,
      expectedChecksCents: 0, zReportJson: JSON.stringify(z) };
  });
  await insertBatched(tx, S.drawerSessions, drawerRows, false);

  // ---------------- cycle counts (weekly, 2 yrs) ----------------
  const ccRows = Array.from({ length: 104 }, (_, w) => {
    const at = isoAgo((104 - w) * 7 - 7);
    return { scheduledFor: at.slice(0, 10), completedAt: at, completedBy: 'josiah',
      status: 'posted', submission: 1, submittedAt: at, submittedBy: 'josiah', postedBy: 'amy' };
  });
  ccRows.push({ scheduledFor: new Date(ANCHOR.getTime() + 7 * DAY).toISOString().slice(0, 10), completedAt: null as any,
    completedBy: null as any, status: 'counting', submission: 0, submittedAt: null as any, submittedBy: null as any, postedBy: null as any });
  await insertBatched(tx, S.cycleCounts, ccRows, false);

  // ---------------- inventory transactions (20,000 + openings) ----------------
  // Reason mix roughly shop-shaped: lots of sales/usage, periodic receipts + counts.
  // One 'opening' row per item makes the ledger sum land on its target count;
  // rows go in oldest-first and the DB trigger maintains balances + counts.
  const REASONS = ['sold', 'sold', 'used', 'used', 'received', 'received', 'cycle_count', 'production_use', 'waste_scrap', 'damaged', 'correction', 'theft_loss', 'receiving_error', 'other'] as const;
  const adjRows: (typeof S.inventoryAdjustments.$inferInsert)[] = [];
  for (let i = 0; i < 20_000; i++) {
    const reason = pick(REASONS);
    const receipt = reason === 'received';
    const itemIdx = int(0, itemIds.length - 1);
    const delta = receipt ? int(1, 60) : -int(1, 12) * (reason === 'cycle_count' && chance(0.4) ? -1 : 1);
    const note = chance(0.1) ? 'perf seed' : null;
    const createdBy = pick(['josiah', 'amy']);
    const cost = receipt ? int(100, 20000) : null;
    const f = items[itemIdx].purchaseToCountFactor ?? 1;
    adjRows.push({
      itemId: itemIds[itemIdx], delta, reason, note, createdBy,
      txnType: reason === 'cycle_count' ? 'count' : txnTypeForReason(reason), locationId: 1,
      sourceType: receipt ? 'receipt' : 'manual',
      purchaseUnitCostCents: cost, unitCostCents: cost != null ? Math.round(cost / f) : items[itemIdx].avgCostCents,
      supplierId: receipt ? supIds[int(0, supIds.length - 1)] : null,
      createdAt: isoAgo(int(0, 729)),
    });
  }
  const sums = new Map<number, number>();
  for (const r of adjRows) sums.set(r.itemId, (sums.get(r.itemId) ?? 0) + r.delta);
  itemIds.forEach((itemId, k) => {
    const opening = targetCounts[k] - (sums.get(itemId) ?? 0);
    if (opening === 0) return;
    adjRows.push({
      itemId, delta: opening, reason: 'opening balance', txnType: 'opening', locationId: 1,
      sourceType: 'migration', unitCostCents: items[k].avgCostCents, createdAt: items[k].createdAt as string,
    });
  });
  adjRows.sort((a, b) => (a.createdAt as string).localeCompare(b.createdAt as string));
  await insertBatched(tx, S.inventoryAdjustments, adjRows, false);
});

// ---------------- summary ----------------
const tables = ['users', 'categories', 'suppliers', 'materials', 'material_colors', 'inventory_items', 'inventory_adjustments',
  'customers', 'jobs', 'job_items', 'payments', 'invoices', 'invoice_lines', 'drawer_sessions', 'cycle_counts'];
console.log(`\nSeeded ${process.env.DB_PATH} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
for (const t of tables) {
  const [{ c }] = (await db.all(sql.raw(`select count(*) as c from ${t}`))) as { c: number }[];
  console.log(`  ${t.padEnd(22)} ${String(c).padStart(7)}`);
}
process.exit(0);
