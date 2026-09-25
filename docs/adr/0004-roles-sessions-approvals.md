# ADR 0004 — Roles, server sessions, and manager approval replace the shared admin password

**Status:** accepted (2026-09-25). Supersedes the admin-gate half of ADR 0003
(`requireAdmin`) and the users-module `verifyUser`.

## Context

Until Phase 1a, auth was "LAN trust": the client kept the account name in
localStorage and the plain password in sessionStorage; `users.password` was
plain text; one shared `adminPassword` setting (default `admin`) gated
configuration and overrides, and routes took `adminPassword` / `editorName` +
`editorPassword` / `overrideBy` in request bodies. Many admin screens (materials,
categories, suppliers, settings PUTs) had **no** server check at all — only the
client-side `AdminGate`. Attribution fields (`createdBy`, `completedBy`) were
whatever the client typed. That is not safe for real sales: anyone who knows the
admin password can void money, and nothing records *which* person approved it.

Owner decisions (2026-09-25): per-user roles **cashier / manager / admin**;
hashed PINs; "manager approval" means a manager (or admin) types **their own
name + PIN** at the moment of the action and it is logged; the shared admin
password goes away; the feature set otherwise does not change.

## Decision

- **New module `server/modules/auth/`** (its `index.ts` is the only import
  surface) owns credentials, sessions, and the two permission checks. The users
  module keeps account admin (create, role, PIN reset, deactivate, own PIN,
  prefs) and consumes auth for hashing and session revocation.
- **Schema (migration `0013`)**: `users.role` (CHECK cashier|manager|admin,
  default cashier; every pre-existing user migrated to **admin** so nobody is
  locked out), `users.pin_hash` (`scrypt$<saltHex>$<hashHex>`, node:crypto);
  `sessions` (sha256 of a 32-byte random token as PK, user, created / last seen /
  expires / revoked); `approvals` (action, entity, entity_id, requested_by,
  approved_by, reason, details JSON, created_at) — **append-only**, enforced by
  UPDATE/DELETE triggers. The `adminPassword` settings row is deleted.
- **Startup upgrade** (`upgradePlaintextPasswords`, run by `buildApp`): a user
  with a plaintext `password` and no `pin_hash` gets it hashed into `pin_hash`;
  the plaintext is NULLed. Idempotent. The column stays for migration history
  and is never read for sign-in. A user with neither has no login until an
  admin sets a PIN. Legacy passwords keep working as that user's "PIN" until
  changed (new PINs must be 4–12 digits).
- **Sessions**: `POST /api/auth/login {name, pin}` → `{token, user}`;
  `POST /api/auth/logout`; `GET /api/auth/me`. Bearer token in
  `Authorization`. 12 h idle expiry (slides; `last_seen_at` written at most once
  a minute), 7-day absolute cap. A root `onRequest` hook resolves `req.user`
  for every `/api/*` route and returns 401 without a valid session. Public:
  `/api/health`, `/api/auth/login`, `/api/auth/status`, `/api/auth/setup`, and
  every non-`/api` path (built client, static files).
- **`/api/auth/status`** (public) returns the sign-in account picker (names of
  active accounts with a PIN) and `needsSetup`. **`/api/auth/setup`** (public)
  creates the first admin **only** while no active admin with a PIN exists
  (fresh install); 409 afterwards. Exposing names keeps the tap-your-name
  sign-in screen; names are not secrets in a 5-person shop.
- **Brute-force guard**: 10 failed PINs per name per 5 minutes → 429 (in
  memory; applies to sign-in and to approval PINs). PIN checks use
  `timingSafeEqual`, and an unknown name still pays a full scrypt.
- **`requireRole(req, reply, min)`** gates configuration; returns false after
  replying 403.
- **`requireApproval(req, reply, {action, entity, entityId, reason, details})`**
  gates money/override actions. A manager/admin passes on their own authority
  (approvals row with `approved_by = requested_by`). A cashier must include
  `approval: {name, pin, reason?}` from an active manager/admin; otherwise 403
  `{error:'approval_required', action}`. Wrong PIN / non-manager approver →
  403 `approval_invalid`. Every pass writes one approvals row. Approval checks
  sit **after** idempotency returns, so a wifi retry never double-logs.
- **Attribution comes from the session**: `jobs.createdBy`,
  `payments.createdBy`, `inventory_adjustments.createdBy`,
  `cycle_counts.completedBy`, counter-sale rows. Body fields of those names are
  no longer in the schemas (Fastify strips them). `overrideBy` is gone — the
  approvals row (and the job-notes line "manager override by X (for Y)")
  replaces it.
- **Client**: `src/lib/api.ts` sends the token (`localStorage['dp-token']`),
  sends 401s back to sign-in, and on 403 `approval_required` opens the one
  shared **Manager approval** dialog (`src/components/ApprovalDialog.tsx`,
  mounted once in `App`) and retries the same request with `approval` added.
  CSV exports download through `fetch` (an `<a href>` can't send the header).
  `AdminGate` is replaced by `RoleGate` (hide-by-role; server enforces).

### Route → role / approval

| Route | Before | Now |
|---|---|---|
| `PUT /api/settings/tax`, `/levels`, `/inventory` | none server-side (AdminGate UI) | **admin** |
| `PUT /api/settings/units` | none server-side (AdminGate UI) | **manager** — the unit list is inventory taxonomy, edited on the Taxonomy page |
| `GET /api/settings/*` | open | any signed-in user (quotes need them) |
| `POST/PUT/DELETE /api/materials…` incl. colors | none server-side (AdminGate UI) | **admin** (pricing is the owner's) |
| `POST/PUT /api/categories…`, sizes add/remove | none server-side | **manager** |
| `DELETE /api/categories/:id` | admin password | **admin** |
| `POST/PUT /api/suppliers…` | none server-side | **manager** |
| `DELETE /api/suppliers/:id` | admin password | **admin** |
| `PUT /api/customers/:id/level` | admin password | **manager** (discount tiers are day-to-day sales decisions) |
| `DELETE /api/customers/:id` | admin password | **approval** `customer.delete` |
| `POST /api/customers/:id/credit` | none | **approval** `customer.credit_adjust` (store credit is money) |
| `POST /api/payments` kind `refund` | none | **approval** `payment.refund` |
| `POST /api/payments` kind `payment` | none | any signed-in user |
| `POST /api/payments/:id/void` | none | **approval** `payment.void` |
| `PUT /api/jobs/:id/status` → `picked_up` with balance due | admin password + `overrideBy` | 402 first; retry with `override: true` → **approval** `job.pickup_unpaid` |
| `DELETE /api/jobs/:id` | account password | **approval** `job.delete` |
| `PUT /api/jobs/:id` (full edit) | account password | any signed-in user (session is the attribution) |
| `POST /api/inventory/:id/adjust` reason `received` | none | any signed-in user (receiving is daily work) |
| `POST /api/inventory/:id/adjust` any other reason | none | **approval** `inventory.adjust` |
| `POST /api/cycle-counts/:id/complete` | none | any signed-in user (the reconciler; its own reason-code gate) |
| `POST /api/users`, `PUT /api/users/:id`, `PUT /api/users/:id/pin`, `DELETE /api/users/:id` | admin password | **admin**; last active admin can't be demoted/deactivated (409) |
| `PUT /api/users/me/pin` | — | self, current PIN required |
| `PUT /api/users/prefs` | name + password | self (session) |
| `POST /api/users/verify`, `/api/admin/status`, `/api/admin/login`, `/api/admin/password` | existed | **removed** |
| everything else under `/api` | open | any signed-in user |

## Consequences

- Every sensitive action now has a named approver in an append-only table; the
  shared secret that everyone knew is gone.
- A fresh install boots to a first-run "create the owner account" screen;
  upgraded installs sign in with existing names/passwords (everyone admin) and
  the owner downgrades staff in Settings → Accounts.
- Deactivating a user, resetting their PIN, or changing their role revokes
  their sessions immediately. Changing your own PIN signs out your other PCs.
- The rate limiter is per process and resets on restart — acceptable for one
  server on a LAN; a 4-digit PIN is still a small keyspace, so the owner should
  prefer 6 digits for managers/admins.
- Role hiding in the client is convenience only; the server is the authority.
- No approvals viewer/export yet — rows are queryable in SQLite; a CSV export
  should follow per the "every money table gets a CSV" rule.
