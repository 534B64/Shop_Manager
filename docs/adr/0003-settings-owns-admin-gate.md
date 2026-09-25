# ADR 0003 — The settings module owns the admin gate; users owns account verification

**Status:** accepted (2026-07-03)

## Context

The admin-password check (read `settings.adminPassword`, default `'admin'`,
compare) was re-implemented in four route files; the settings table was read
directly by five. `jobs.ts` imported `verifyUser` from the users route file.
This is LAN-trust attribution, not security (documented tradeoff) — but four
copies of the same check is four places to fix.

## Decision

- `server/modules/settings/index.ts` exposes `settingsRoutes`,
  `getSetting(key)`, `requireAdmin(password)` (boolean — callers decide the
  reply), and `taxRatePct()`.
- `server/modules/users/index.ts` exposes `userRoutes` and
  `verifyUser(name, password)`.
- All other modules consume these instead of reading the settings/users
  tables directly. Behavior is unchanged: same defaults, same comparisons,
  same response codes (asserted by the existing integration tests).

## Consequences

- The Phase-E trust fix ("force the admin password off the default on first
  login") now has exactly one implementation point.
- This was the one consolidation (not pure move) in the 2026-07-03 reorg
  pass — ruled in scope during grilling because the deletion test passes:
  removing the duplicates concentrates complexity rather than moving it.
