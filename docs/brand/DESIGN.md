# SWU TCC — Design Language

**Star Wars Unlimited Top Cut Calculator.** A fan-made tool players open on their phone between rounds to answer one question: *"Can I make top cut — and can I safely intentionally draw (ID)?"*

This folder is the source of truth for the site's look. When building UI, use `tokens.css` (or `tokens.json`), the SVGs in `logos/` and `icons/`, and the rules below. Don't invent new colors, fonts or radii.

---

## 1. Concept: "Holotable readout"

The site should feel like a tactical display on a starship bridge: a dark field, thin hairline frames, monospace numbers, small uppercase labels, and one bright line marking the cut. It should feel like a precise instrument, not a movie poster.

Five rules:

1. **Verdict first.** Every result screen opens with a single status (LOCKED / ID SAFE / BUBBLE / WIN & IN / OUT) and one big percentage. Show the details below that. A player should get the answer at a glance on a crowded venue floor.
2. **The Cut Line is the signature.** A dashed amber rule (`--tcc-cut`, `.tcc-cut-line`) marks the qualifying position in every standings view, chart and logo. Use amber only for the cut and the BUBBLE status. Never use it for decoration.
3. **Numbers are instruments.** All numbers (records, points, %, OMW, ranks) use JetBrains Mono with `tabular-nums`, so the columns line up and the values don't shift as they update.
4. **Honest odds.** A probability always comes with what it assumes, such as "assumes 50/50 for other tables" or "3,000 simulations". Round percentages to whole numbers and never show "100%" unless the result is mathematically certain. Use the LOCKED state for that.
5. **Space is atmosphere, not wallpaper.** A faint starfield or grid is allowed only in the landing hero. Never place one behind data.

### Fitting into the SWU fan ecosystem

Players will use TCC alongside SWU Forge (decks), the Holocron Rating Index at hri.gg (ratings) and SWU Competitive Hub (results). TCC should feel like a sibling of those sites, using the same dark data-table vocabulary, while still being recognizable at a glance:

| Site | Its accent | What TCC borrows | How TCC differs |
|---|---|---|---|
| SWU Forge | blue on navy | calm dark surfaces, clean Inter body text | **violet** primary; graphite background, not navy |
| hri.gg | cyan, green % | uppercase mono nav, `// label` comments, ± and confidence bars under numbers, sync status pill | violet instead of cyan; amber only for the cut |
| Competitive Hub | amber/orange | outlined format filter pills (ALL / PREMIER / LIMITED / ETERNAL), event-level names, set-code chips | amber is a thin line, never a fill or headline color |

Don't use blue or cyan as an accent anywhere. Those belong to the neighbors.

## 2. Color

The background is graphite with a faint violet tint, not navy. The dark theme is the default. Light ("Daylight Hall") is available through `data-theme="light"` or the OS setting, for bright convention halls.

| Token | Dark | Light | Use |
|---|---|---|---|
| `--tcc-bg` | `#08080D` | `#F6F5FB` | page background |
| `--tcc-surface` | `#0F0F17` | `#FFFFFF` | cards, panels |
| `--tcc-panel` | `#171724` | `#EEEDF6` | raised / input fields / table header |
| `--tcc-line` | `#262636` | `#DAD8E8` | 1px hairline borders, dividers |
| `--tcc-text` | `#ECEBF5` | `#0F0F17` | primary text |
| `--tcc-text-muted` | `#9A98B3` | `#4D4B66` | secondary text, labels |
| `--tcc-primary` | `#A08CFF` | `#6247E0` | **Holo violet**: buttons, links, focus, selected |
| `--tcc-cut` | `#FFB547` | `#D98A00` | **Cut Line amber**: the cut only |

### Qualification status (the core semantic scale)

Statuses differ in lightness as well as hue, and each one **always** appears with its icon and text label. Never rely on color alone.

| Status | Dark | Light | Icon | Meaning |
|---|---|---|---|---|
| LOCKED | `#3DDC97` | `#0B7F50` | lucide `lock` | In even if you lose out |
| ID SAFE | `#A08CFF` | `#6247E0` | `icons/id-safe.svg` | Drawing the remaining round(s) qualifies (≥ 90%) |
| BUBBLE | `#FFB547` | `#A15C00` | `icons/bubble.svg` | Tiebreakers / other tables decide |
| WIN & IN | `#FF7A59` | `#C2410C` | `icons/win-and-in.svg` | A win qualifies, a draw probably doesn't |
| OUT | `#807E9C` | `#615F7C` | `icons/out.svg` | Cannot reach the cut |

Status chips: text in the status color on a 12%-alpha fill of the same color, with a 1px border at 40% alpha. Use `color-mix(in srgb, var(--tcc-lock) 12%, transparent)`.

### Aspect colors

The six game aspects (Vigilance, Command, Aggression, Cunning, Heroism, Villainy) have tokens for **deck/leader tags only**. Don't use them for status or brand.

## 3. Typography

| Role | Font | Weights | Notes |
|---|---|---|---|
| Display / headings / wordmark | **Chakra Petch** | 600, 700 | squared tactical sans; headings in Title Case, logo in caps |
| Body / UI | **Inter** | 400, 500, 600 | 16px base, line-height 1.5 |
| Numbers / labels / data | **JetBrains Mono** | 400, 500, 700 | `tabular-nums`; micro labels are 12px uppercase with 0.12em tracking |

Scale (px): 12 · 14 · 16 · 20 · 28 · 40 · 72 (72 is reserved for the verdict percentage).
All three fonts are open source (OFL-1.1) and self-hosted through Fontsource (`@fontsource-variable/inter`, `@fontsource-variable/jetbrains-mono`, `@fontsource/chakra-petch`); the site never loads Google Fonts. Inter and JetBrains Mono are variable fonts (family names `Inter Variable`, `JetBrains Mono Variable`).

## 4. Shape, space, depth

- **4px spacing grid**: 4, 8, 12, 16, 24, 32, 48, 64.
- **Radii are tight**: 2px for chips and inputs, 4px for cards. Pills are only for status chips. Hero/verdict panels use the **chamfer** (`.tcc-chamfer`, 10px clipped corners) instead of rounding.
- **Depth comes from borders and glow, not drop shadows.** Cards are `--tcc-surface` with a 1px `--tcc-line` border. Interactive focus/selected states get `--tcc-glow-primary`.
- **Touch targets** are at least 44px. Primary actions sit within thumb reach at the bottom of the screen on mobile.
- Motion is 160ms with `--tcc-ease`. Numbers can count up once on first reveal. Honor `prefers-reduced-motion`.

## 5. Components (patterns)

- **Verdict panel**: chamfered surface; a status chip at the top left, a 72px mono percentage, a one-line plain-English explanation ("You make top 8 in 94% of outcomes if you ID"), then an "assumptions" disclosure.
- **Scenario rows**: Win / Draw / Loss, one row each, with the resulting record, points and % to make the cut, plus a status icon. The best choice gets a violet left marker *dot* (not a colored left border).
- **Standings table**: mono numbers, the player's own row highlighted with `--tcc-primary-soft`, and an amber dashed **cut line** between rank N and N+1, labeled `CUT · TOP 8` in micro-label style.
- **Inputs**: event size, rounds, current round, record (W-L-D stepper), and top-cut size (Top 4/8/16/32 segmented control).
- **Buttons**: primary is solid violet with `--tcc-primary-ink` text in Chakra Petch 600, 0.04em tracking. Secondary is a 1px violet outline. Ghost buttons use muted text.
- **Top nav** (hri.gg style): uppercase JetBrains Mono at 12px with 0.12em tracking, items separated by `|` hairlines, and the active item marked by a 2px violet underline.
- **Section labels** use a code-comment prefix: `// verdict`, `// scenarios`, `// standings near you`. Put the `//` in violet and the rest in muted text.
- **Sync pill**: a hairline-bordered pill reading `● SYNCED · MELEE.GG · 2 MIN AGO`. The dot is `--tcc-lock` when the data is fresh and `--tcc-bubble` when it's more than 15 minutes old.
- **Confidence bar**: a 2px bar under a percentage, filled to the confidence level (as on hri.gg). Show ± or a simulation count beside the number in muted 11px mono.
- **Format pills** (Competitive Hub style): outlined `ALL / PREMIER / TWIN SUNS / LIMITED / ETERNAL`, with the selected one filled solid violet. Formats get no colors of their own.
- **Event header**: event level in Chakra Petch 600 (e.g. *Planetary Qualifier*), followed by a mono meta line `PREMIER · 49 PLAYERS · SWISS 6 · TOP 8`. A set code such as `HMW` goes in a 2px-radius outlined chip.

## 5b. Vocabulary

Use the game's own organized-play terms consistently in the copy:

- **Event levels**: Store Showdown, Planetary Qualifier (PQ), Sector Qualifier (SQ), Regional Qualifier (RQ), Galactic Championship
- **Formats**: Premier, Twin Suns, Limited, Eternal
- **Structure**: Swiss rounds → top cut (Top 4 / 8 / 16 / 32). Matches are best of 3.
- **Results**: match record W-L-D; **match points** at 3 for a win, 1 for a draw and 0 for a loss; game record (e.g. 2-1)
- **Tiebreakers**: OMW% (opponents' match-win %), then GW% and OGW%. Confirm the order against the current SWU tournament rules before relying on it in code.
- **Players**: say "leader + base" for a deck (e.g. "Boba Fett · 30HP Cunning"). Don't show card art.
- Write **ID** as "intentional draw (ID)" on first use on each page. **Standings** means the live Swiss table, imported from Melee.gg or entered by hand.

## 6. Logo

Files are in `logos/`:

- `mark.svg`: the primary mark for dark backgrounds. A hexagonal plaque (a holotable badge) holds **two violet rank chevrons above an amber cut line, with one dim chevron below it**: the players who made the cut and the one who didn't.
- `mark-light-bg.svg`: the same mark for light backgrounds.
- `mark-mono.svg`: a single color using `currentColor`, for embossing, stickers and one-ink print.
- `lockup-horizontal.svg` / `lockup-stacked.svg`: the mark with the **SWU TCC** wordmark (Chakra Petch 700, with "TCC" in violet) and the **TOP CUT CALCULATOR** descriptor (JetBrains Mono, 3px tracking). Convert the text to outlines before using these outside the web app.
- `favicon.svg`: a simplified version for 16–32px. The hexagon and the dim chevron are dropped, leaving two chevrons and the cut line on a rounded `#0F0F17` tile.
- `app-icon.svg`: a 512px tile for PWA/home screen. Export PNGs at 192 and 512 for `manifest.json`, and 180 for `apple-touch-icon`.

Clear space is at least ¼ of the mark's width on every side. Minimum size is 24px for the mark and 120px wide for the horizontal lockup. Don't recolor the chevrons, rotate the mark, add a glow to it, or place it on a busy image.

## 7. Icons

- **Library: [Lucide](https://lucide.dev)** (ISC license). In React use `lucide-react`; otherwise use `lucide-static`. Stroke width is 2, at sizes 16/20/24, colored with `currentColor`.
- Suggested Lucide icons: `trophy` (top cut / event), `swords` (match / round), `handshake` (intentional draw, in casual copy), `percent`, `calculator`, `users` (players), `timer` (round clock), `list-ordered` (standings), `scale` (tiebreakers / OMW), `lock` (LOCKED), `shield-check`, `triangle-alert`, `share-2`, `refresh-cw`, `info`.
- **Custom icons** (`icons/`) follow Lucide's grid and stroke conventions, so you can mix the two freely:
  - `top-cut.svg`: a bracket that converges to a single point
  - `cut-line.svg`: two chevrons above a dashed line
  - `intentional-draw.svg`: two chevrons meeting at an equals sign
  - `id-safe.svg`: a shield containing an equals sign (ID SAFE status)
  - `bubble.svg`: a circle sitting on the line (BUBBLE status)
  - `win-and-in.svg`: an arrow breaking up through the line (WIN & IN status)
  - `out.svg`: an arrow below a dashed line (OUT status)
  - `game-record.svg`: three pips for a best-of-3 game score (filled = game won)
  - `pairings.svg`: two facing half-shields (your match / opponent)
  - `tiebreaker.svg`: descending bars with a down arrow (OMW% / GW% sort)
  - `event-tier.svg`: a hex badge with chevrons (event level)
  - `standings-import.svg`: an arrow into a list (import standings from Melee.gg)
- Don't use emoji in the UI.

## 8. Voice

Short, calm and specific, like a tournament judge who's good at math. Use "You're ID SAFE: an intentional draw (ID) puts you at 14 match points, which made top 8 in 96% of simulated finishes." Avoid hype and franchise quotes. Write "ID" and "intentional draw" in full on first use on each page.

## 9. Legal / fan-site hygiene

This is an unofficial fan tool. Add this to the footer: *"SWU TCC is an unofficial fan-made tool. Not affiliated with or endorsed by Fantasy Flight Games, Lucasfilm or Disney. Star Wars: Unlimited © & ™ Lucasfilm Ltd."* Don't use official logos, the franchise logo typeface, card art or film imagery in the brand.
