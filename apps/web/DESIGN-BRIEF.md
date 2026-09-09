# Web Capture — Redesign Brief

**Read this as instructions, not description.** Part A is context so you know what
exists. Parts B–E are the job. Where they conflict with your instincts, Parts B–E win.

Scope: the **web app only** (`apps/web`, Next.js 15 App Router, Tailwind v4).
The Chrome extension is a separate surface — don't design it, but the web app must
look like the same product.

---

# PART A — Context: what exists today

## A1. The product

A Chrome extension saves images, screenshots, links and text from any page via
keyboard shortcut. This web app is where that material is **browsed, grouped and
revisited**.

Two organising concepts:

- **Captures** — individual saved items, typed by `kind`: `image`, `screenshot`,
  `link`, `text` (and `code`, which exists in data but is hidden from the UI).
- **Sessions** — the user explicitly starts a session; everything captured while it
  runs joins it; they finish it. Captures made with no session running are unfiled
  and appear in All Captures.

The core motion is **recognition, not search** — scanning a dense grid and going
"that one". Image area and grid density beat chrome and controls.

## A2. Screens that exist

| Route | What it is |
|---|---|
| `/` | Marketing landing page |
| `/sign-in/[[...sign-in]]` | Clerk hosted sign-in |
| `/dashboard` | All Captures — sidebar + kind tabs + search + grid |
| `/dashboard/sessions` | Grid of session cards |
| `/dashboard/sessions/[id]` | One session's contents |

Landing page sections, in order: `Header`, `Hero`, `Features` (3 cards),
`HowItWorks` (2 steps), `UseCases` (Developers, Designers), `Stats` (**currently
commented out, contains invented numbers**), `CTA`, `Footer`.

## A3. Components that exist

**`Sidebar`** — 240px, persistent across `/dashboard/*`. Logo + wordmark, Clerk
`UserButton` with name/email, **Browse** nav (All Captures, Sessions),
**Categories** list, **Tags** chip cloud (display-only, not clickable).

**`MasonryLayout`** — the most important component. Absolutely-positioned columns
measured with `ResizeObserver`. Column width 162px (<640) / 192px (<1024) / 280px.
Item height from aspect ratio, clamped 100–600px, 16px gap, ~80px footer with
source URL + tags. Hover actions: Maximize, Download, Change category, Delete.

**`TextWrapLayout`** — cards for text captures, truncated body, "Show more" opens
an overlay, footer strip with source hostname.

**`LinkList`** — grid, `minmax(240px, 1fr)`. Favicon, domain, title (2-line clamp),
description (2-line clamp), up to 3 tag chips.

**`LinkPreviewHover`** — 420px Radix hover card: preview image, site name, title,
description, author, published date, keywords, timestamps. 300ms delay, right side.
Only renders when preview data exists.

**`MaximizedImage`** / **`MaximizedText`** — full-screen overlays, backdrop-click to
close, X top-right.

**`ChangeCategoryDialog`** — centred modal, 448px max. Text input + clickable
suggestions; creates category then reassigns.

## A4. Data that appears on screen

| Entity | Fields with a visual surface |
|---|---|
| capture | `kind`, image URL, `pageUrl`, `alt`/`title`, `width`/`height`, `tags[]`, `category`, `domain`, `timestamp`, `content`, `href` |
| session | `name` or `autoName`, `startedAt`, `lastCaptureAt`, `endedAt`, `itemCount`, `domains[]`, `tags[]`, `running` |
| category | `name` |
| tag | `name`, `useCount` |
| link_preview | `title`, `description`, `imageUrl`, `faviconUrl`, `siteName`, `author`, `publishedDate`, `keywords[]` |

**Critical:** tags are auto-generated (CLIP zero-shot + source domain + aspect
ratio). Almost every capture carries **4–8 tags**. Design chips for that volume.

## A5. The current look (being replaced)

Dark neon / glassmorphism: a 5-stop background gradient
(`#0A0A0F → #1A0B2E → #16213E → #0F1B3C`), cyan `#00D9FF` + purple `#B026FF` +
green `#00FF94` accents, gradient clipped text, `blur(20px)` glass cards, neon box
shadows, floating animations, `scale(1.05)` hovers, offset "brutalist" shadows.

Typography is already fine and **stays**: Inter (300–900) + JetBrains Mono, wired
as `--font-geist-sans` / `--font-geist-mono`.

---

# PART B — The job

Redesign all five screens in the visual language of **Vercel, Linear and Neon**:
near-monochrome, near-black surfaces, hairline borders instead of shadows, a
single blue accent used sparingly, tight type, generous negative space, motion
that is fast and nearly unnoticeable. Confidence through restraint.

Produce, in this order:

1. **`/dashboard` (All Captures)** — populated with images. This is the screen that
   defines the system; do it first and let the rest follow.
2. **`/dashboard/sessions`** — populated, including one session actively recording.
3. **`/dashboard/sessions/[id]`** — session detail, populated.
4. **`/` landing page** — full page, all sections.
5. **States:** dashboard empty, dashboard loading, search-with-no-results,
   sessions empty.
6. **Overlays:** `MaximizedImage`, `ChangeCategoryDialog`.

Deliver each at desktop width (1440px). Also give `/dashboard` at 768px and 375px —
`MasonryLayout` already has breakpoints at those widths and must keep working.

---

# PART C — Design system (hard constraints)

These are exact values. Use them literally; do not substitute your own palette.

## C1. Neutrals — dark theme is primary

```
--bg              #08090A   app background
--surface         #0E0F11   cards, sidebar
--surface-hover   #131417   hover / raised
--border          #1F2023   hairline dividers, card edges
--border-strong   #2A2C30   inputs, focus outlines
--text            #EDEEF0   primary text
--text-muted      #8A8F98   meta, labels, secondary
--text-subtle     #62666D   timestamps, disabled
```

## C2. Accent — one blue, nothing else

```
--blue-50   #EFF5FF     --blue-500  #3B82F6   ← primary
--blue-100  #DBE8FE     --blue-600  #2563EB   ← hover / pressed
--blue-200  #BFD7FE     --blue-700  #1D4ED8
--blue-300  #93BEFD     --blue-800  #1E40AF
--blue-400  #609CFA     --blue-900  #1B3A87
                        --blue-950  #152554
```

Semantic only: recording/success `#3FB950`, danger `#F85149`, warning `#D29922`.

## C3. Type

- Inter. Tracking `-0.011em` body, `-0.02em` on headings ≥24px.
- Scale: 11 / 12 / 13 / 14 / 16 / 20 / 24 / 32 / 48.
- Body 13–14px. Meta 12px. Micro-labels 11px uppercase, `0.06em`.
- Weights **400 / 500 / 600 only**. Never 700+.
- JetBrains Mono for URLs, domains, keyboard shortcuts, code captures.

## C4. Shape, depth, motion

- Radius: 6px inputs/chips, 8px cards, 12px modals. Nothing larger.
- **No shadows for elevation on flat surfaces.** Depth = background step + 1px
  border. Modals get one soft shadow; nothing else does.
- Motion 120–160ms `ease-out`. Hover changes background or border only.
- Focus: 2px `--blue-500` at 40%, 2px offset. Never removed.

## C5. Density

Data tool, not a marketing site. Sidebar rows 32px. Buttons 32px default / 28px
small. Card padding 16px. Section padding 24px. Tighter than the current design.

---

# PART D — Rules

## D1. Always

- Blue means **interactive or active** — buttons, active nav, focus, links,
  selection. Maximum **one** blue element competing for attention per view.
- Tag chips are **neutral** (`--surface-hover` bg, `--text-muted` text). There are
  too many of them for accent colour.
- Active nav row: `--surface-hover` fill + `--text` + a 2px `--blue-500` left rule.
- Structure with 1px `--border`. It is the primary structural device.
- Every list needs a designed empty state. The app is empty until the extension is
  installed, so the dashboard empty state should sell the extension.
- Give overlays a visible close target ≥32px and support Escape.

## D2. Never

- No gradients. Not on backgrounds, text, buttons, or borders.
- No glassmorphism, no backdrop blur except one overlay scrim.
- No glow, neon, or coloured shadows.
- No `scale()` hovers, floating, or pulsing — except the recording dot.
- No purple, cyan, green, or pink. Green appears **only** as the recording state.
- No font weight above 600. The current `font-black` hero is off-brand.
- Don't hide scrollbars. The current global `::-webkit-scrollbar { display:none }`
  is a bug in a scrolling grid app — design a thin styled scrollbar instead.
- Don't give Categories equal weight with Sessions (see D3).

## D3. Decisions already made

- **Sessions is the organising system.** Categories are legacy; every capture is
  still written `category: "unsorted"`. Demote categories to a secondary group in
  the sidebar, or drop them.
- **The `Code` tab stays hidden.** Tabs are: Images, Screenshots, Links, Text.
- **`Stats` is cut** — its numbers are invented. Don't design around them.
- **Dark theme is primary.** If you propose light, dark still leads.

---

# PART E — Screen specs

## E1. `/dashboard` — do this first

Sidebar 240px, `--surface`, 1px right border. Logo mark (simple, not a gradient
tile) + wordmark. Clerk user row at top or bottom. Groups: **Browse** (All
Captures, Sessions), then Tags. Categories demoted or gone.

Main column: header row with kind tabs — an underlined or segmented control, **not
pills** — plus a search input with a `⌘K` affordance, ~320px.

Content: the masonry grid is the hero. Minimise chrome around it, maximise image
area. Item footer 11–12px `--text-muted`: source domain + max 3 tag chips + "+n".

Hover on a grid item: compact action bar top-right — four 28px icon buttons
(maximize, download, recategorise, delete) over a subtle scrim. Not always-visible.

## E2. `/dashboard/sessions`

Cards on `--surface` with 1px `--border`.

**Fix the filmstrip.** It currently renders up to 5 equal-width thumbnails, which
looks broken with one or two images. Design something that degrades: a 2×2 mosaic,
or one hero thumbnail with a `+n` counter.

Card body: title (inline-renameable, pencil on hover), meta line
`Today · 7 items · 23 min`, domain list truncated, up to 5 neutral tag chips.

**A recording session needs real prominence** — it is the app's only live state.
Green dot plus a distinct border or fill on that card.

## E3. `/dashboard/sessions/[id]`

Header as a document title block: large session name, muted meta row (timestamp,
item count, domains), tags beneath, hairline divider, then the grid. Back link
above the title. Visual captures in the masonry; a separate "Text & links" list
below for captures with no image.

## E4. `/` landing

Invert the current energy. Flat `--bg`, one blue CTA, hairline section dividers,
no gradient text, no floating animation. Let a product screenshot carry the visual
weight. Sections: Header, Hero, Features (3), HowItWorks (2), UseCases (2), CTA,
Footer. No Stats.

## E5. Overlays

Backdrop `rgba(8,9,10,0.85)` with light blur — the one permitted blur. Image capped
90vw/90vh. `ChangeCategoryDialog`: 448px, 12px radius, one soft shadow, text input
plus suggestion list.

---

# PART F — Open questions

Answer these in your proposal rather than assuming:

1. **Light mode** — ship one, or dark-only? It changes how the token layer is built.
2. **Categories** — retire completely, or keep as a manual layer above Sessions?
3. **Public session sharing** — the intended growth feature, not yet built. Worth
   designing the shell now so it isn't bolted on later.
