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
On top of it, `src/lib/query.ts`:

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
- Paged today: `/api/inventory`, `/api/inventory/reorder`, `/api/inventory/usage`.
- Inventory filters (all three endpoints): `q` (name/color/vendor, contains), `kind=roll|other`, `materialId`,
  `color`, `widthIn`, `categoryId` (or `none`), `supplierId`, `low=1`, `stock=low|out|ok`.
- `/api/inventory` sort: `sort=name|count|threshold|created|value`, `dir=asc|desc` (default name asc).
  Reorder is always most-urgent-first; usage is fastest-moving first.
- New paged endpoints: use `server/lib/paging.ts` (`parsePage`, `parseSort`, `likePattern`), filter + sort in SQL,
  return `{ rows, total, limit, offset }`, keep the old unpaged shape when no paging params are sent, and add tests.

## Routes

All routes live in `src/routes.tsx`. To add a page:

1. `const MyPage = lazy(() => import('./modules/<domain>/MyPage'));` (default export) — each page is its own chunk.
2. Add `{ path: '/my/path', element: <MyPage />, min?: 'manager' }` to `DEFS` (`min` wraps it in `RoleGate`).
3. If it's a top-level section, add a `NAV` item (`icon` from `Icon.tsx`, optional `min` role).
4. Renaming a URL? Add a `<Navigate replace>` from the old path so bookmarks survive.
5. Read URL state with `useParams` / `useSearchParams` (filters and the open record belong in the URL).

Currently several routes point at the old all-in-one page (e.g. every `/inventory/*` renders `Inventory`,
`/quotes/:id` renders `Quotes`, `/customers/:id` renders `Customers`). When you split a page, make each route
render its own view and read `:id` from the URL. `/pos/*`, `/reports`, `/audit` are placeholders (`ComingSoon`).

## Checklist before you hand off

- [ ] No raw colors; no legacy token classes left in the files you touched.
- [ ] Light, dark and High Contrast checked; one non-default accent checked.
- [ ] Desktop (≥1280) and tablet (≈820) widths checked; counter/POS controls use `touch`.
- [ ] Keyboard: Tab order sensible, focus visible, dialogs trap focus and close on Escape.
- [ ] Lists use `usePaged` with a server-paged endpoint; empty and error states render.
- [ ] Every file ≤ ~300 lines; pure logic tested; `npx vitest run`, `npx tsc --noEmit`, `npx vite build` pass.
