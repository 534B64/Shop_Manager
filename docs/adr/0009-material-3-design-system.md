# ADR 0009 — Material 3 design system, route-level pages, server paging

**Status:** accepted (2026-09-26)

## Context

The client grew as a handful of very large pages (Inventory and Quotes ~900 lines each) on a small set of
hand-picked CSS variables, all bundled together, and the Inventory page downloaded the whole
`inventory_items` table (2.1 MB for 5,000 items — `docs/perf-baseline.md`) over the shop's flaky wifi.
The owner decided (final):

- Rebuild the UI on **Google Material Design 3**, keeping the blue-and-white look (primary `#2456c4`), defined
  once as tokens shared by every page.
- Keep **light, dark and high-contrast** themes and the **per-account accent picker** — the accent is the seed of
  that account's scheme.
- **WCAG AA** on every token pair in every theme and for any accent a user can pick; adjust tones, never fail.
- **≥ 48px** touch targets on counter/POS screens.
- One page/route per module or workflow, lazy-loaded, with real links; long lists paged or virtualized.

## Decision

1. **Color from a seed, in our own code.** `src/lib/m3/` generates tonal palettes (primary, secondary, tertiary,
   neutral, neutral-variant, error, plus fixed-hue success and warning) and maps them to M3 scheme roles for the
   three themes. A *tone* is CIELAB L\*, exactly as in M3; hue/chroma come from **OKLCH** rather than HCT.
   The solver hits the requested tone exactly and gives up chroma (never tone) when the gamut can't reach it.
   Because WCAG contrast depends only on luminance, and L\* is a function of luminance, **contrast is fixed by the
   tone pairs**, so any accent — yellow, gray, neon — passes. Tests check every pair components use, in all three
   themes, for the default and ten sample seeds (high contrast holds 7:1 for text).
2. **Tokens as CSS custom properties** (`--md-sys-color-*`, `--md-sys-typescale-*`, `--md-sys-shape-corner-*`,
   `--md-sys-elevation-level*`, `--md-sys-state-*`). `src/styles/tokens.css` is generated for the default seed so
   first paint is right without JS; `lib/theme.ts` overrides the color roles inline for a non-default accent.
   Tailwind maps role names to the tokens (with `<alpha-value>` so `bg-primary/10` works) and adds the type scale.
   The old variable names are aliases onto roles so un-migrated pages follow the theme.
3. **Our own small component kit** (`src/components/m3`) on Tailwind, not Material Web / MUI: no new npm
   dependencies, small bundle, full control over density and the shop's type size (17px root).
4. **One route table** (`src/routes.tsx`) with `React.lazy` per page, an `AppShell` (nav rail ≥ 768px, modal
   drawer below, top app bar with the account menu), role-filtered nav, and redirects from old URLs.
5. **Opt-in server paging**: `limit`/`offset` switch a list endpoint to `{ rows, total, limit, offset }` with
   filtering and sorting in SQL; without them the old bare-array response is unchanged, so pages migrate one at
   a time. Offset + total (not cursors): lists are small enough (thousands) that OFFSET is cheap (6.5 ms for the
   last page of 5,000), and "page X of Y" plus arbitrary sort columns are simpler for page builders.

## Alternatives considered

- **Material Web components / MUI** — rejected: new dependencies (the project is dependency-lean), web
  components fight React forms, and both default to a lower density than the shop wants.
- **HCT (Material Color Utilities port)** — faithful but ~1,500 lines of CAM16 math to vendor. OKLCH + L\* tones
  gives the same contrast guarantee (the property we need) with ~150 lines. Hues differ slightly from Google's
  generator; nothing depends on matching it exactly.
- **Fixed accent in High Contrast** (the old behavior) — dropped: the accent tells accounts apart, and the tone
  map keeps HC at 7:1 with any accent.
- **Cursor paging** — kept for later if a list grows past tens of thousands of rows.

## Consequences

- Every page must use role tokens and the kit; `docs/UI-GUIDE.md` is the rulebook for page builders.
- A new text/background pairing must be added to the contrast test before use.
- The legacy aliases (`bg-bg`, `text-muted`, …) and the unpaged list responses are transitional: remove them once
  every page has moved.
- The runtime scheme generator ships in the main bundle (small; only runs when the accent changes).
