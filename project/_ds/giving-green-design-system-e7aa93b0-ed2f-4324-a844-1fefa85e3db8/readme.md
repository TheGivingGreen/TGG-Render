# Giving Green Design System

Giving Green is a nonprofit climate charity evaluator (thegivinggreen.org / givinggreen.earth). It runs an intensive, multi-step research process to identify the highest-impact climate nonprofits, publishes an annual "Top Climate Nonprofits" list, and operates the **Giving Green Fund**, a re-granting vehicle that lets donors support all recommended organizations in one donation with no management fee. It also offers climate consulting to individuals, foundations, and businesses. Giving Green is a research organization, not an advocacy group — its job is to translate research into a small number of confident, high-leverage giving recommendations.

This project is a **design system**: visual foundations, tokens, reusable UI components, and a UI kit recreation of Giving Green's site, built for producing on-brand prototypes, decks, and mocks.

## Sources

- **VoltAgent/awesome-design-md**, `design-md/nike/DESIGN.md` (github.com/VoltAgent/awesome-design-md) — a structural analysis of Nike's commerce design system (typography scale, spacing rhythm, radius/pill vocabulary, elevation model, component inventory). This system borrows Nike's *structure* — extreme type contrast, pill CTAs, flat card chrome, 8px spacing rhythm — and re-skins it entirely in Giving Green's own palette and nonprofit content. No Nike brand assets, copy, or imagery are used anywhere in this project.
- Public Giving Green pages (givinggreen.earth — home, Top Climate Nonprofits, Give, FAQ, Research) — read for organizational facts, program names, and copy tone used in this system's specimen content. Explore these directly for more/current source copy.
- Brand color brief supplied by the user (Forest Green, Cream, Giving Green Red, Gold, White, Soft Green) — the base hues for every token in this system.

No Figma file, codebase, or slide deck was attached for Giving Green itself, and no logo file was provided — see **Iconography** below for how that gap is handled.

## Index

- `styles.css` — root stylesheet; import this one file. Pulls in `tokens/colors.css`, `tokens/typography.css`, `tokens/spacing.css`, `tokens/base.css`.
- `tokens/` — color, type, spacing/radius/elevation tokens.
- `guidelines/` — foundation specimen cards (Colors, Type, Spacing, Brand groups in the Design System tab).
- `components/core/` — Button, Chip, Badge, SearchInput.
- `components/cards/` — CharityCard, ImpactTile, CauseIconCard, FundBenefitCard.
- `components/navigation/` — NavBar, UtilityBar, FilterSidebar, Footer.
- `components/disclosure/` — DisclosureRow, FaqRow.
- `components/indicators/` — StepDot.
- `ui_kits/website/` — click-through recreation of the Giving Green marketing site (home, Top Climate Nonprofits list, charity detail, Fund page).
- `assets/` — wordmark treatment (no real logo supplied), placeholder photography guidance.
- `SKILL.md` — portable skill file for use in Claude Code or other agent environments.

## Intentional additions

The Nike source's component inventory is retail-specific (`swatch-dot`, `product-card`, `pdp-disclosure-row`, `member-benefit-card`, …). Every family was carried over and recontextualized for a research/donation nonprofit rather than dropped or invented from scratch:

| Nike source | Giving Green component | Reason |
|---|---|---|
| `button-primary/secondary/outline-on-image/icon-circular` | `Button` | Same 4 variants, same pill geometry |
| `search-pill` | `SearchInput` | Same shape/behavior, searches the nonprofit directory |
| `filter-chip` | `Chip` | Filters the Top Climate Nonprofits list by sector |
| `badge-promo` / `badge-sale-text` | `Badge` | "Top Pick" / "New for 2026" tags; highlight-red text badge for funding gaps instead of sale price |
| `product-card` | `CharityCard` | A recommended nonprofit stands in for a product |
| `swatch-dot` | `StepDot` | Nike's colorway picker has no nonprofit analog; repurposed as the 5-step research process indicator, same concentric-ring "active" treatment |
| `campaign-tile` | `ImpactTile` | Full-bleed editorial hero, e.g. "TOP CLIMATE NONPROFITS 2026" |
| `category-icon-card` | `CauseIconCard` | Sector categories (Clean Energy, Alternative Proteins, Industrial Decarbonization…) instead of shoe categories |
| `member-benefit-card` | `FundBenefitCard` | Giving Green Fund benefits, 3-up |
| `faq-row` / `pdp-disclosure-row` | `FaqRow` / `DisclosureRow` | Same accordion pattern; `DisclosureRow` generalized for charity-detail sections ("Our Evaluation", "Room for Funding") |
| `utility-bar` / `primary-nav` / `filter-sidebar` / `footer` | `UtilityBar` / `NavBar` / `FilterSidebar` / `Footer` | Same chrome, Giving Green nav items |

No primitives were invented beyond this 1:1 remapping.

## Content fundamentals

Tone drawn from Giving Green's own published copy (givinggreen.earth):

- **Voice: confident, research-led, plain.** Sentences state findings directly — "We assess every recommended climate nonprofit against the criteria of scale, feasibility, and funding need." No hedging, no jargon, no exclamation points.
- **"We" for the org, "you"/"your" for the donor.** E.g. "We thoroughly research climate initiatives so you can give with confidence." The organization always speaks in first-person plural; it never refers to itself in the third person in body copy.
- **Numbers do the persuading, not adjectives.** Copy leads with concrete multipliers and totals — "$63.5 million," "50 high-impact climate nonprofits," "$1 unlocks $25.90" — rather than superlatives like "amazing" or "incredible."
- **Humility about certainty.** Giving Green explicitly avoids claiming a single "best" answer: "We do not believe that there are 'best charities.' We do believe, however, that there are some organizations where your donations can be more strongly felt." Use this hedge pattern when writing recommendation copy — confident about the process, modest about absolute claims.
- **Systemic framing over individual guilt.** Copy centers "systemic change," "policy," and "scale" rather than individual-consumer framing (no "reduce your footprint" language). Climate change is framed as a solvable, structural problem.
- **No emoji, no slang, no urgency gimmicks.** No countdown timers, no "act now!!" copy. Urgency is expressed through information (funding need, room for more funding) not pressure tactics.
- **Section labels are plain nouns, sentence case**, not marketing taglines: "Research," "Give," "Top Climate Nonprofits," "FAQ" — mirrored in this system's nav copy.
- **CTA verbs are literal and specific:** "Give," "Learn more," "Read the report," "See our recommendations" — never "Unlock," "Discover," "Get Started Now."

## Visual foundations

- **Color discipline, Nike-style.** Nearly all chrome runs on two surfaces — Forest Green (`--forest-green`, full-bleed dark sections, nav, footer-adjacent moments) and Cream (`--surface-canvas`, the default page background and every card's "studio"). White is reserved for card surfaces and for maximum-contrast type on Forest Green. Giving Green Red is spent almost exclusively on the primary CTA pill and on highlight/urgency text (funding gaps, "give now" moments) — it never becomes a background tint. Gold marks achievement only: totals raised, milestone stats, "Top Pick" badges. Soft Green is the workhorse for charts, secondary icons, and muted text — never a CTA color.
- **Type is the loudest thing on the page.** A single 96px/0.92 uppercase Anton display tier is reserved for editorial campaign headlines (home hero, annual list announcement) — never for section headers or card titles. Everything else runs on Work Sans 14–32px. The jump from `--text-heading-xl` (32px) straight to `--text-body-strong` (16px) is intentional, same as the Nike source: billboard above, catalog below.
- **Spacing runs on an 8px base**, with a 64px "section" rhythm separating major page blocks (hero → featured list → cause categories → fund callout → footer). No decorative dividers between sections — the background color change (cream ↔ forest) is the divider.
- **Backgrounds:** full-bleed photography in editorial hero/impact tiles; flat Cream or Forest Green everywhere else. No gradients, no repeating patterns, no textures. Photography (where used) should read as documentary/field photojournalism — real people and landscapes tied to climate work — not stock-photo gloss. Use neutral placeholder blocks in cream-deep until real photography is supplied.
- **Animation is minimal and purposeful.** Standard UI transitions (hover, focus, accordion expand) run 150–200ms ease-out. No bounce, no parallax, no looping decorative motion — this is a research organization, not a consumer brand.
- **Hover states:** buttons darken one step (`--giving-red` → `--giving-red-deep`, `--forest-green` → `--forest-green-deep`); cards lift with `--shadow-raised`; links underline.
- **Press states:** Nike's source signature "tap collapse" (`scale(0.5) / opacity 0.5`) is preserved on primary buttons — a fast, confident collapse-and-release rather than a color change.
- **Borders / shadows:** flat by default, same as the source. `--hairline` (16% forest-green) divides footer columns, filter rows, and disclosure rows. Cards get one soft ambient shadow (`--shadow-card`) since — unlike Nike's white-on-white cards — Giving Green's white cards need to lift off Cream.
- **Corner radii:** CTAs and chips stay fully pill-shaped (`--radius-pill`), matching the source exactly. Cards use a modest 16px radius (`--radius-md`) — a deliberate departure from Nike's 0-radius chrome, chosen for nonprofit warmth over retail severity (documented in `tokens/spacing.css`).
- **Transparency/blur:** none in the base system. Reserve for a future sticky-nav treatment only if requested.
- **Layout rules:** ~1200px content max-width; nav and utility bar are fixed/sticky at the top; footer is static.

## Iconography

No icon font, icon sprite, or SVG set was found in the source material — Giving Green's site was analyzed by structure/copy, not by direct codebase access, and the Nike source's iconography (swoosh, wishlist heart, bag) has no bearing on a nonprofit's UI. **Substitution: [Lucide](https://lucide.dev) via CDN** (`https://unpkg.com/lucide@latest`), a permissively-licensed, stroke-based icon set matching the system's plain, unfussy visual register (1.5–2px stroke, no fill, 24px default grid). Used for: nav icons (search, menu), disclosure chevrons, sector-category glyphs (leaf, flame, ship, factory, atom), and social/footer links. No emoji anywhere in the system, per Giving Green's plain research-org tone. No unicode-glyph icons.

## Fonts

No proprietary Giving Green typeface was supplied. Substituted with Google Fonts, loaded via `@import` in `tokens/typography.css`:
- **Anton** — condensed geometric uppercase, for the single display-campaign tier (mirrors Nike source's Futura ND role).
- **Work Sans** (400/500/600/700) — UI and body text (mirrors Nike source's Helvetica Now Text/Display role).

**Flag to reader:** if Giving Green has real brand fonts, replace this `@import` with `@font-face` rules pointing at the real files and this system will pick them up everywhere automatically.
