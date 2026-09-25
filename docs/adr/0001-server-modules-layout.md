# ADR 0001 — Domain modules live under `server/modules/<domain>`, imported only via `index.ts`

**Status:** accepted (2026-07-03)

## Context

The 2026-07-03 reorg pass moves the server from technical layers
(`routes/`, one flat `db/schema.ts`) to domain modules (jobs, materials,
customers, inventory, payments, settings, users). Two placements were
considered: a new top-level `/modules` (the literal target pattern) or
`server/modules/`. The NAS deploy drill has never been run — the Dockerfile
(`COPY server ./server`, `COPY shared ./shared`), tsconfig `include`, and the
prod static-serving path all assume the current top-level dirs.

## Decision

- Modules live at `server/modules/<domain>/{routes,service,queries,types,index}.ts`
  (files only as needed — a module without service logic skips `service.ts`).
- **`index.ts` is each module's only interface.** Nothing outside the folder
  imports `queries.ts`/`service.ts`/`routes.ts` directly; `app.ts` registers
  route plugins re-exported through `index.ts`.
- Table definitions live at `server/db/schema/<domain>.ts`, barreled through
  `server/db/schema/index.ts` (drizzle-kit's entry point). A module's
  `queries.ts` imports its own tables directly; foreign tables come via the
  owning module's interface functions, or (for plain FK joins) the schema
  barrel.
- `shared/` does not move: it is the real client+server seam (pricing, rolls,
  stock check, status flow) and is already deep and tested.
- Client pages group by the same domains under `src/modules/<domain>/` —
  whole-file moves only, no JSX splits (Quotes.tsx restructure waits for the
  Phase 9 reskin). Dashboard, Settings, `src/lib`, `src/components` stay
  app-level.

## Consequences

- Zero Dockerfile/tsconfig/deploy changes — nothing new to prove before the
  deploy drill.
- API URL paths are unchanged; this pass is invisible to the client and to
  any saved bookmarks.
- `server/db/index.ts` must stay where it is (it resolves the migrations
  folder relative to its own file).
- Migration `.sql`/snapshot files are untouched; the schema split keeps table
  definitions byte-identical, so no migration is generated.
