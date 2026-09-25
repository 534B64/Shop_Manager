// Barrel — the single import surface for the data model (and drizzle-kit's
// schema entry point). One file per domain; table definitions are unchanged
// from the original single-file schema.ts (split 2026-07-03, no migration).
export * from './customers.js';
export * from './materials.js';
export * from './jobs.js';
export * from './payments.js';
export * from './inventory.js';
export * from './users.js';
export * from './settings.js';
