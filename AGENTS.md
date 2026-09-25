# Agent Instructions

Read `CLAUDE.md` first — it is the project guide.

## Environment

1. Node lives at `~/.local/node/bin` and may not be on PATH:
   `export PATH="$HOME/.local/node/bin:$PATH"` before any node/npm/npx command.
   Do not use anything under `/mnt/c`.
2. If `node_modules` is missing in your worktree, symlink it (never run npm install/ci):
   `ln -s /home/josia/shop-manager/node_modules node_modules`

## Verify

- `npx vitest run` — all tests pass
- `npx tsc --noEmit` — clean
- `npx vite build --outDir /tmp/sm-build` — checks the client build without touching `dist/`

## Guardrails

- Never touch `data/` or any real `.db` file. Perf tooling (`db:seed:perf`,
  `perf:baseline`) needs an explicit `DB_PATH` that is not `dp-erp.db`.
- Server code follows the domain-module layout (ADR 0001): `server/modules/<domain>/`,
  with `index.ts` as the only import surface.
