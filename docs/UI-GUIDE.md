# UI guide — building a page on the Material 3 foundation

Read this before moving a page onto the new system. Why it's built this way: `docs/adr/0009-material-3-design-system.md`.
The reference page is the Dashboard (`src/pages/dashboard/`) — copy its shape.

## The five rules

1. **Colors come from role tokens only.** Use Tailwind role classes (`bg-surface`, `text-on-surface-variant`,
   `bg-primary text-on-primary`, `border-outline-variant`, `bg-primary/10` …). Never a hex value, never
   `text-white` / `bg-black`, never an inline `style={{ color }}`. Legacy classes (`bg-bg`, `text-ink`, `text-muted`,
   `border-line`, `bg-accent`, `text-warn/danger/ok`) still work but are deprecated — replace them as you touch a page.
2. **Contrast: only use the pairs the tests check.** Text goes on a surface with `on-surface` / `on-surface-variant` /
   an accent role (`primary`, `error`, `success`, `warning` …), or on a filled accent with its `on-*` partner
   (`bg-primary text-on-primary`, `bg-error-container text-on-error-container`). Those pairs meet WCAG AA in every
   theme for any accent (`src/lib/m3/m3.test.ts`). Need a new pairing? Add it to `pairs()` in that test first.
3. **Touch targets ≥ 48px on counter/POS screens.** Pass `touch` to `Button`, `IconButton`, `Chip`; list items,
   nav items, checkboxes and switches are already ≥ 48px. Elsewhere 40px buttons are fine (desk + mouse).
4. **No page file over ~300 lines.** A route gets a folder (`src/pages/<page>/` or `src/modules/<domain>/<page>/`)
   with a thin page component and small pieces: one card/section/dialog per file, pure logic in a `.ts` file with a test.
5. **Lists are server-paged.** Never fetch a whole table. Use `usePaged` + `DataTable` (below).

## Tokens

- Generated file: `src/styles/tokens.css` — **don't edit it**; it's `npm run tokens` output from `src/lib/m3/`.
  A test fails if it's stale.
- Colors: `--md-sys-color-<role>` (hex) and `--md-sys-color-<role>-rgb`. Roles: primary / secondary / tertiary /
  error / **success** / **warning** (each with `on-`, `-container`, `on-…-container`), surface, `surface-container-lowest…highest`,
  `surface-dim/bright`, `surface-variant`, `on-surface(-variant)`, `outline(-variant)`, `inverse-*`, `scrim`, `shadow`.
- Surfaces: page = `bg-surface`; outlined card = `bg-surface` + `border-outline-variant`; elevated card =
  `bg-surface-container-low shadow-elevation-1`; filled card / inputs = `bg-surface-container-highest`; dialogs = `-high`.
- Type: `text-display-large|medium|small`, `text-headline-*`, `text-title-*`, `text-body-*`, `text-label-*`
  (size + line height + weight + tracking in one class). Page title = `text-headline-medium`; card title =
  `text-title-large`; body = `text-body-large` (default) / `text-body-medium` for dense rows.
- Shape: `rounded-shape-extra-small|small|medium|large|extra-large|full`. Elevation: `shadow-elevation-0…5`.
- State layers: add `state-layer` to anything clickable that isn't an m3 component (hover/focus/press overlay at
  the token opacities). Focus rings are global (`:focus-visible`) — don't remove outlines.
  **Never put `state-layer` on a `<tr>`**: its `::before` box renders as an extra table cell and shifts the row.
  Clickable table rows use `hover:bg-on-surface/[0.08]` (DataTable does this for `onRowClick`); put
  `state-layer` on a button *inside* a cell instead.
- Themes: `data-theme="light" | "dark" | "minimal"` (High Contrast) on `<html>`. The account's accent is the seed
  of its scheme in all three themes (`src/lib/theme.ts` → `applyPrefs`). Check your page in all three.

## Components (`src/components/m3`, import from `'../components/m3'`)

| Component | Use |
|---|---|
| `Button` (`filled` · `tonal` · `outlined` · `text` · `elevated` · `danger`; `icon`, `touch`, `to`) | actions; `to` renders a router link |
| `IconButton` (`label` required) | icon-only actions |
| `TextField`, `Select` (`filled` · `outlined`; `label`, `supportingText`, `error`) | form fields — label is a real `<label>` |
| `Checkbox`, `Switch`, `Chip` (`assist` · `filter` + `selected`) | selection |
| `Card` (`elevated` · `filled` · `outlined`), `CardHeader` | containers |
| `Dialog` (focus trap, Escape, `actions`) | modals — the approval dialog uses it |
| `showSnackbar(msg, {actionLabel, onAction})` | "Saved", "Payment voided — Undo" (host is in the shell) |
| `Tabs` (route tabs with `to`, or state tabs) | sub-views; prefer route tabs so back/bookmarks work |
| `List`, `ListItem` | short lists (cards, pickers) |
| `DataTable` + `Pager` | long lists — server-paged, loading bar, empty + error states |
| `NavigationRail`, `NavigationDrawer`, `TopAppBar` | used by the shell only |
| `Badge`, `LinearProgress`, `CircularProgress`, `EmptyState`, `Icon` | feedback; add icon paths to `Icon.tsx` |

## Data

`src/lib/api.ts` stays the only fetch layer (token, 401 → sign-in, manager-approval retry, network retry).
On top of it, `src/lib/query.ts` (and the helpers listed under "Shared hooks and helpers" below):

```tsx
const q = useQuery<Summary>('/api/dashboard');          // { data, error, loading, reload, setData }
const items = usePaged<Item>('/api/inventory', { q: search, low: lowOnly, sort: 'name' }, { pageSize: 50 });
<DataTable label="Inventory" columns={cols} rows={items.rows} rowKey={(r) => r.id}
  loading={items.loading} error={items.error} onRetry={items.reload} paging={items} />
```

Changing the params object (search, filters, sort) goes back to page 1. Mutations still use `post/put/del`, then
`reload()`; show the result with `showSnackbar`.

### Server paging contract

Opt-in per request — without `limit`/`offset` the old response (bare array) is unchanged.

```
GET /api/inventory?limit=25&offset=50&q=red&sort=count&dir=desc
→ 200 { "rows": [...], "total": 5000, "limit": 25, "offset": 50 }
→ 400 { "error": "bad_paging", "message": "limit must be a whole number from 1 to 200" }
```

- `limit` 1–200 (default 25 if only `offset` is given), `offset` ≥ 0.
- New paged endpoints: use `server/lib/paging.ts` (`parsePage`, `parseSort`, `likePattern`), filter + sort in SQL,
  return `{ rows, total, limit, offset }`, keep the old unpaged shape when no paging params are sent, and add tests.

### Paged endpoints (what each page uses)

Offset-paged — `{ rows, total, limit, offset }`:

| Endpoint | Filters / sort | Used by |
|---|---|---|
| `/api/inventory` | `q` + `match=contains\|starts\|ends\|exact` (name/color/vendor), `ids=1,2,…` (≤ 200), `kind=roll\|other`, `materialId`, `color`, `widthIn`, `categoryId` (or `none`), `supplierId`, `low=1`, `stock=low\|out\|ok`; `sort=name\|count\|threshold\|created\|value\|size\|color\|low`, `dir`; `group=material\|color\|size\|unit\|category` orders by the group first and adds `groupKey`/`groupLabel` per row + `groups: [{key,label,count,low}]` (no key = "Other / Consumables", last) | `/inventory` (default `group=material`), counts, pickers |
| `/api/inventory/reorder`, `/api/inventory/usage` | the item filters; reorder = most urgent first, usage = fastest first | `/inventory/reorder` |
| `/api/customers` | `q` (name / email / phone digits), `includeArchived=1`, `sort=recent\|name\|created`, `dir` | `/customers`, the customer pickers (`?q=…&limit=10&offset=0`) |
| `/api/jobs` | `q`, `status` (one or a comma list); newest first. **Quirk:** paged only when `offset` is sent — `?limit=` alone keeps the old bare array (usePaged always sends `offset`, so pages are fine) | Orders list, Quotes "recent jobs" |
| `/api/balances` | `q`; largest balance first; also `totalOwedCents` | Payments "Owed", Dashboard owed card |
| `/api/payments` | `q` (job title / customer); newest first | Payments, POS "Today" card (`?limit=12&offset=0`) |
| `/api/cycle-counts` | history, newest first (default 25) | `/inventory/counts` |

Keyset-paged, newest first — `?limit=&before=<id>` → `{ rows, nextBefore }` (no total; show "Page N"):

| Endpoint | Filters | Used by |
|---|---|---|
| `/api/invoices` | `from`, `to`, `customerId`, `jobId`, `number`, `status=issued\|voided` | `/pos/invoices`, customer detail |
| `/api/returns` | `from`, `to` | `/pos/returns` |
| `/api/drawer` | — | `/pos/drawer`, Reports |
| `/api/audit` (admin) | `entity`, `entityId`, `userId`, `from`, `to` | `/audit` |
| `/api/approvals` (admin) | `action`, `entity`, `entityId`, `userId`, `from`, `to` | `/audit` (Approvals tab) |
| `/api/inventory/transactions` (manager+) | `type`, `itemId`, `from`, `to` | `/inventory/adjustments`, Receiving's recent receipts |
| `/api/inventory/:id/transactions` | — | item detail |

Single-call summaries (added up in SQL, never walked in the browser): `/api/dashboard`, `/api/jobs/board`
(every lane's first `limit` + counts), `/api/jobs/due-soon`, `/api/inventory/valuation`,
`/api/reports/summary?from&to` (payments; a plain `YYYY-MM-DD` is the shop's local day on every date filter — send local dates from `todayIso`/`lastDays`, never `toISOString().slice(0, 10)`),
`/api/reports/sales?from&to` (manager+, invoices/voids/returns — the Z-report rule).

### Shared hooks and helpers

| Where | What |
|---|---|
| `lib/query.ts` | `useQuery(url \| null)`, `usePaged(url, params, {pageSize})` (`data` = the whole last response for extras like inventory `groups`), `withParams`, `startsGroup` |
| `lib/keysetPaging.ts` | `useKeyset(url \| null, params, pageSize)` (one page + Previous/Next) and `useKeysetMore(url \| null, params, limit)` ("Load more", rows accumulate); `KeysetPage` type |
| `components/KeysetPager.tsx` | the one pager for keyset lists; pass `touch` on POS screens |
| `components/ConfirmDialog.tsx` | yes/no dialog (never `window.confirm/prompt/alert`); shows the error inline, ignores a cancelled approval |
| `components/DateRangeFields.tsx` | From/To date pair (`DateRange`), used by Reports, invoices, returns, audit |
| `lib/errorText.ts` | `errorText(e, fallback)` (the one error-to-words function), `approvalCancelled`, `isDrawerClosed`, `lockedInvoice`, `isNetworkError` |
| `modules/pos/lib/TaxExemptField.tsx` | the sale-level Tax exempt switch + reason (reason chips, free text); `/pos` only, the one counter-sale screen. Pair it with `cartTotals` (`priceCounterSale`) so the preview equals the invoice |
| drawer prompt | every tender needs an open drawer (409 `drawer_closed`, `isDrawerClosed`): show `OpenDrawerForm compact` inline — counter, Record payment, Refund — don't send people to another page |
| `lib/ref.ts` | `newRef()` for every `clientRef` / client id — `crypto.randomUUID` does not exist on the shop's plain-http LAN origin, so it falls back to `getRandomValues` |
| `DataTable` `groupOf` / `renderGroup` / `hideRow` | header rows where the group key changes (inventory group-by) |

## Routes

All routes live in `src/routes.tsx`. To add a page:

1. `const MyPage = lazy(() => import('./modules/<domain>/MyPage'));` (default export) — each page is its own chunk.
2. Add `{ path: '/my/path', element: <MyPage />, min?: 'manager' }` to `DEFS` (`min` wraps it in `RoleGate`).
3. If it's a top-level section, add a `NAV` item (`icon` from `Icon.tsx`, optional `min` role).
4. Renaming a URL? Add a `<Navigate replace>` from the old path so bookmarks survive.
5. Read URL state with `useParams` / `useSearchParams` (filters and the open record belong in the URL).

### Route map (wave 2)

| Path | Page | Min role |
|---|---|---|
| `/` | Dashboard (`pages/dashboard/`) | |
| `/quotes` → `/quotes/new`, `/quotes/:id` | quote / order editor (`modules/jobs/quote/`) | |
| `/orders` | board + list (`modules/jobs/orders/`) | |
| `/pos` | counter sale (`modules/pos/counter/`); `/pos/counter` and `/quick` redirect here (Quick Order retired into it, D15) | |
| `/pos/drawer`, `/pos/drawer/:id` | cash drawer + Z-report (`modules/pos/drawer/`) | close = manager (server) |
| `/pos/invoices`, `/pos/invoices/:number` | invoices + detail/void (`modules/pos/invoices/`) | void = approval |
| `/pos/returns`, `/pos/returns/new`, `/pos/returns/:id` | returns (`modules/pos/returns/`) | refund over threshold = approval |
| `/payments` | Payments (`modules/payments/`) | |
| `/customers`, `/customers/:id` | customer list + detail (`modules/customers/`) | |
| `/inventory` | item list (`modules/inventory/list/`) | |
| `/inventory/:id` | item detail (`modules/inventory/item/`) | |
| `/inventory/receiving`, `/inventory/counts`, `/inventory/counts/:id`, `/inventory/reorder` | receiving, cycle counts, needs ordering | |
| `/inventory/adjustments` | ledger across items | manager |
| `/reports` | Reports hub (`pages/reports/`; the sales card shows for manager+) | |
| `/settings` | My account + theme (`pages/settings/account/`) | |
| `/settings/users`, `/settings/shop`, `/settings/materials`, `/settings/locations` | admin settings | admin |
| `/settings/taxonomy`, `/settings/suppliers` | taxonomy, suppliers | manager |
| `/audit` | audit log + approvals (`pages/audit/`) | admin |
| `/materials`, `/taxonomy` | redirects to their `/settings/…` pages | |

## Checklist before you hand off

- [ ] No raw colors; no legacy token classes left in the files you touched.
- [ ] Light, dark and High Contrast checked; one non-default accent checked.
- [ ] Desktop (≥1280) and tablet (≈820) widths checked; counter/POS controls use `touch`.
- [ ] Keyboard: Tab order sensible, focus visible, dialogs trap focus and close on Escape.
- [ ] Lists use `usePaged` with a server-paged endpoint; empty and error states render.
- [ ] Every file ≤ ~300 lines; pure logic tested; `npx vitest run`, `npx tsc --noEmit`, `npx vite build` pass.
