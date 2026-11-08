# Snappy brand guide

For contributors and anyone using the Snappy assets. The design tokens in [`brand/tokens/tokens.css`](../brand/tokens/tokens.css) and [`brand/tokens/tokens.json`](../brand/tokens/tokens.json) are the source of truth; this guide explains how to use them.

---

## 1. Snappy in one page

**Snappy helps you organize your Snapchat world from your own data export.** It builds a tidy, current friend list: who is still a friend, unaccepted requests, quiet friends, a careful clean-up queue and a backup. It sorts Memories into year and month folders with their dates restored, makes duplicates and storage visible, and shows who is waiting on a reply. It runs on your own device, as a command line tool and a local dashboard.

**Personality.** Calm, capable, tidy and a little warm. Quick, never childish, never alarmist. Snappy talks like a careful friend who is good at putting things in order: plain, specific and steady.

**Four principles**

1. **Order first.** Every screen turns a pile into a list: sorted, counted, dated and ready to act on. If a view does not make something tidier, it does not belong.
2. **Say how sure we are.** Snappy infers from exports. Every result shows its confidence and its evidence, and never states a guess as a fact.
3. **Quiet by default, one spark.** Ink and bone do the work. Violet is the main color: it marks where you are and what comes next. Orange is a secondary accent for the Memories rescue area and small illustration highlights. Each finding area has one quiet category color on its own surfaces.
4. **Speed through clarity.** Few steps, large targets, nothing that slows the eye.

**The trust rule.** Your export stays on this device. Say it plainly where it matters, such as on import and on results. It is a promise to keep, not the headline.

---

## 2. Name, capitalization and word choices

| Rule | Right | Wrong |
|---|---|---|
| Product name | Snappy | SNAPPY, SnapPy, snappy (except the command and package) |
| Command and package | `snappy-export` in monospace; libraries are `@snappy-export/*` | Snappy in a code block |
| Snapchat | Snapchat, always capitalized, used only to describe compatibility | snapchat, SnapChat, "Snap" as a stand-in |
| Interface text | Sentence case: first word and proper nouns capitalized | Title Case Buttons, ALL CAPS |
| Acronyms and units | JSON, ZIP, CSV, MB, GB | Json, Zip |
| Snapchat's own feature names | Memories, Spotlight, Snap Map, as Snapchat spells them | memories, when naming Snapchat's feature |
| Usernames | Lowercase monospace, exactly as stored | Mixed case, proportional font |

No all-caps strings in the interface. Emphasis comes from weight and size, never from capitals or exclamation marks.

### Feature names

| Name | What it is |
|---|---|
| Disappeared friends | People who were in an earlier export and are missing from the latest one |
| Unaccepted requests | Friend requests you sent that nobody accepted |
| Quiet friends | Friends with no recent activity |
| Cleanup queue | The careful list of friends you chose to review and remove |
| Memories rescue | Memories sorted into year and month folders with dates restored |
| Year in review | A sum-up of one year of chats, Snaps, new friends and Memories |
| Since your last export | What changed between your last export and this one |
| Lookalike usernames | Usernames in your lists that look alike, which may be worth a second look |
| Friends table | Your friends in one sortable table |
| Reply speed | How fast you and your friends tend to reply |
| Who reaches out first | Who tends to start the exchanges in each one-to-one chat |
| Activity calendar | Your chats and Snaps by day, week and kind |
| Memories timeline gaps | Months with no Memories, and the busiest stretch |

### American English

Use US spelling and conventions everywhere: color, gray, organize, analyze, canceled, license, center, favorite, behavior. Dates as "Nov 6, 2026" (or 11/6/2026 in dense tables), times as "3:42 PM", numbers as 1,234.5, Oxford comma, "log in" (verb) and "login" (noun), "email", "setup" (noun) and "set up" (verb). Percent sign with no space (45%). Straight quotes in code, curly quotes in prose.

### Word choices

| Say | Avoid | Why |
|---|---|---|
| may have removed you | unfriended you, deleted you | Snappy infers; it does not know. |
| Remove | Delete, unadd, purge | Matches the real effect. |
| Quiet friends | Dormant, dead, inactive | Neutral, not judgmental. |
| Unaccepted requests | Failed adds | Nothing failed. |
| Your export | Your data dump | Calm and accurate. |
| On this device | Locally, client-side | Plain language. |

---

## 3. Logo

**Idea.** Five horizontal, pill-ended bars stacked like an organized list, arranged to form an S. The third bar, the spine, is the one highlighted item, in violet. There is one mark: no small-size variant, no word breaks, no dot.

**Construction.** A 64-unit grid, where 1 unit is 1/64 of the mark. Bars are 8 tall with 4 gaps and fully rounded ends (radius 4).

| Bar | x range | y | Length | Color |
|---|---|---|---|---|
| 1 | 12 to 56 | 4 | 44 | Mark color |
| 2 | 8 to 28 | 16 | 20 | Mark color |
| 3, the spine | 12 to 52 | 28 | 40 | Violet |
| 4 | 36 to 56 | 40 | 20 | Mark color |
| 5 | 8 to 52 | 52 | 44 | Mark color |

At 16 px every bar is exactly 2 px, with 1 px gaps.

### File set

| Asset | File | Where to use it |
|---|---|---|
| Mark | `brand/logo/snappy-mark.svg` | Default. `currentColor` bars and a spine that follows `var(--accent)`, falling back to `#6B4DFF`. |
| Mark, single color | `brand/logo/snappy-mark-mono.svg` | Stamps, the command line banner, one-color print, embossing. |
| App icon | `brand/logo/snappy-app-icon.svg` | Installers, home screens, stores. Ink tile, bone bars, violet `#9B86FF` spine. |
| Favicon | `brand/logo/snappy-favicon.svg` | Browser tabs, 16 to 64 px. Ink tile with the same mark. |
| Lockup | `brand/logo/snappy-lockup.svg` | Headers and documents. Mark and wordmark side by side. |
| Stacked lockup | `brand/logo/snappy-lockup-stacked.svg` | Splash screens and centered layouts. |
| Wordmark | `brand/logo/snappy-wordmark.svg` | The word alone, where the mark already appears nearby. |

The wordmark in the lockups and the wordmark file is outlined: it contains no live text and needs no font.

Raster exports, ready for stores, tabs and the web:

| Export | Use |
|---|---|
| `brand/logo/png/app-icon-1024.png` | Store listings and large installers |
| `brand/logo/png/app-icon-512.png` | Web app manifest, documentation |
| `brand/logo/png/app-icon-192.png` | Web app manifest, small installers |
| `brand/logo/png/favicon-32.png` | Browser tab fallback |
| `brand/logo/png/favicon-16.png` | Browser tab fallback |
| `brand/logo/png/mark-512.png` | The color mark on a transparent ground |
| `brand/logo/favicon.ico` | Browsers that do not read SVG favicons, and the site root |
| `brand/social-preview.svg`, `brand/social-preview.png` | GitHub repository image, 1280 by 640. Carries the independence line. |

### Wordmark

"Snappy" in Bricolage Grotesque Bold (700), tracking -2%, sentence case. Never retype it in another typeface; use the outlined files.

### Clear space and size

- **Clear space.** At least one bar height (8 units, one eighth of the mark's height) on every side of the mark. Leave twice that around the app icon.
- **Minimum size.** Mark 16 px. Lockup 96 px wide.
- **Favicon tile.** The favicon is the one exception to the clear-space rule. Its mark fills the 64-unit tile, so every bar lands on whole pixels at 16 and 32 px, and the tile edge stands in for the clear space.

### Color

Ink bars on bone or white; bone bars on ink or in the dark theme. The spine is violet in the color mark: `#6B4DFF` on light grounds, `#9B86FF` on dark grounds. In the single-color mark it matches the other bars. Never give the spine any other color.

### What not to do

- Rotate, skew, outline, or add shadows, gradients or glows.
- Change bar lengths, spacing or order.
- Use the mark as the digit 5 or in a sentence in place of the letter S.
- Place it on busy photos or on violet backgrounds.
- Add a face, speech bubble, ghost, yellow or anything else that belongs to Snapchat.
- Redraw the wordmark in another typeface.

---

## 4. Color

Warm ink, cool bone and one violet accent, on top of four clear status colors and a small set of category colors. Violet is the main color; orange is a secondary accent (see Orange below). Snapchat's yellow is never used. The warning status is a muted gold (hue near 52 degrees), well away from orange and from Snapchat's bright yellow.

| Token | Light | Dark | Role |
|---|---|---|---|
| `--bg` | `#F2F4F5` | `#131110` | Page background |
| `--surface` | `#FBFCFC` | `#1B1917` | Panels, tables |
| `--surface-raised` | `#FFFFFF` | `#252220` | Menus, dialogs |
| `--surface-sunken` | `#E8EBED` | `#0D0C0B` | Wells, code blocks |
| `--border` | `#D5D9DC` | `#3A3532` | Dividers, card edges |
| `--border-strong` | `#7A7F83` | `#8A837D` | Input edges (3:1 contrast) |
| `--text` | `#1B1816` | `#F2EFEC` | Body text |
| `--text-muted` | `#5C5752` | `#A8A19A` | Secondary text |
| `--primary` | `#1B1816` | `#F2F4F5` | Primary buttons, key marks |
| `--primary-hover` | `#3B3531` | `#FFFFFF` | Primary button hover |
| `--primary-text-on` | `#F2F4F5` | `#131110` | Text on primary fills |
| `--accent` | `#6B4DFF` | `#9B86FF` | The one spark: fills and graphics |
| `--accent-hover` | `#5A3BE8` | `#B3A3FF` | Accent hover |
| `--accent-text-on` | `#FFFFFF` | `#131110` | Text on accent fills |
| `--accent-fg`, `--link` | `#5A3BE8` | `#B3A3FF` | Violet as text or thin lines |
| `--focus-ring` | `#1B1816` | `#F2F4F5` | Focus outline |

The brand values behind the theme tokens: ink `#1B1816`, bone `#F2F4F5`, violet `#6B4DFF` on light grounds and `#9B86FF` on dark grounds. The dark theme ground is `#131110`.

### Rules

- **Violet is the one brand accent.** It marks where you are and what to do next: the active nav bar, step numbers, the key progress or storage meter, and the Cleanup category. It is the only color of the logo, the primary buttons, links, focus rings and selection.
- **Orange is a secondary color, never the main one.** It paints the Memories rescue category and small highlights in the spot illustrations, only through its tokens (see Orange below).
- **Category colors appear only on their own area's surfaces,** always with the category icon and its label (see Category colors below).
- **Never use violet or a category color as body text on a plain ground, as a status, or inside a notice.** Violet text uses `--accent-fg` or `--link`. Text on a violet fill is white in the light theme and ink in the dark theme.
- **Primary buttons are ink in the light theme and bone in the dark theme,** not violet.
- Place the accent on `--bg`, `--surface` or `--surface-raised`.

### Status colors

Always shown with an icon and a text label. Each has a foreground, a background and a border.

| Status | Light fg | Light bg | Light border | Dark fg | Dark bg | Dark border |
|---|---|---|---|---|---|---|
| Success | `#0B6B43` | `#E2F4EA` | `#2F8F63` | `#6FD9A3` | `#0F2A1E` | `#3FA877` |
| Warning | `#574d00` | `#fbf5cc` | `#8f8000` | `#e6d24a` | `#28250a` | `#b5a21f` |
| Danger | `#A8112B` | `#FBE5E8` | `#C8334C` | `#FF8FA0` | `#35101A` | `#E5586F` |
| Info | `#1B4F9E` | `#E3EDFA` | `#2F6FCC` | `#8DB8FF` | `#10223D` | `#4F86E0` |

### Confidence meter

Confidence is three stacked bars plus a word, the same shape as the logo. The bar count and the word carry the meaning; color only supports them.

| Level | Bars | Word | Light fg | Dark fg |
|---|---|---|---|---|
| High | Three filled | High | `#0B6B43` | `#6FD9A3` |
| Medium | Two filled, one outlined | Medium | `#574d00` | `#e6d24a` |
| Low | One filled, two outlined | Low | `#4A5560` | `#B5BEC7` |

The low level uses slate gray with backgrounds `#E8ECEF` (light) and `#22282E` (dark), and borders `#6B7782` and `#7C8791`. Even High is described as likely, never certain.

### Category colors

Each of the five finding areas has one quiet color, so a card, a chip or a page header says at a glance which area it belongs to. Violet is one of them: the Cleanup queue is where the product leads, so it owns the brand accent.

| Area | Hue | Icon |
|---|---|---|
| Disappeared friends | Orchid | `i-vanished` |
| Unaccepted requests | Cyan-teal | `i-one-way` |
| Quiet friends | Moss | `i-quiet` |
| Cleanup queue | Violet | `i-queue` |
| Memories rescue | Orange | `i-memories` |

Each area has four tokens, `--cat-<area>-fg`, `-bg`, `-border` and `-solid`, where `<area>` is `disappeared`, `requests`, `quiet`, `cleanup` or `memories`.

| Token | Role |
|---|---|
| `-fg` | Text and glyphs, on a plain ground and on its own `-bg` |
| `-bg` | Chip, icon tile and tag fill |
| `-border` | 1 px edge of chips and icon tiles |
| `-solid` | Bars, accent underlines, nav glyphs and the highlight in spot illustrations |

Light values:

| Area | `-fg` | `-bg` | `-border` | `-solid` |
|---|---|---|---|---|
| Disappeared friends | `#A72A97` | `#FAEBF8` | `#CC5CBD` | `#C954BA` |
| Unaccepted requests | `#08697D` | `#EBF7FA` | `#1498B3` | `#128DA5` |
| Quiet friends | `#546B0B` | `#F6FAEB` | `#789518` | `#718C17` |
| Cleanup queue | `#5A3BE8` | `#EFEBFF` | `#7B62FF` | `#6B4DFF` |
| Memories rescue | `#A33C00` | `#FFE2CF` | `#D2541A` | `#D9531A` |

Dark values:

| Area | `-fg` | `-bg` | `-border` | `-solid` |
|---|---|---|---|---|
| Disappeared friends | `#D76AC9` | `#2B1228` | `#A83E99` | `#BA45AB` |
| Unaccepted requests | `#4AB9CF` | `#12272B` | `#2E7A8A` | `#338899` |
| Quiet friends | `#AFCD4C` | `#252B12` | `#677A29` | `#819933` |
| Cleanup queue | `#B3A3FF` | `#1F1838` | `#7C66E8` | `#9B86FF` |
| Memories rescue | `#FF9A63` | `#3A1A0A` | `#E0612C` | `#FF7A3D` |

The Cleanup values equal `--accent-fg` and `--accent`, and `contrast.mjs` fails if they drift apart. The Memories rescue tokens point at the orange palette: `--cat-memories-<part>` is `var(--orange-<part>)`.

**Orange (secondary)**

Orange is a supporting color with one home. The palette is four tokens per theme, `--orange-fg`, `--orange-bg`, `--orange-border` and `--orange-solid`, with the values in the Memories rescue rows above. Use it for:

- the Memories rescue category: icon tile, tag, key figure, count bars and the nav glyph;
- one small highlight in a spot illustration (`g-orange`, a pill bar of 12 to 16 units).

Never use orange for the logo, primary buttons, links, focus rings, the selection color, the accent, a status or a notice. Write it only through its tokens, never as a hard-coded value. A test fails if an orange value appears outside the token files, and the layout audit fails if an orange color shows up outside the Memories rescue area.

Orange stays clearly apart from the warning gold. `contrast.mjs` measures the distance in OKLCH and fails below a 45 degree hue gap or a perceptual distance (OKLab, scaled by 100) of 14. Today the hue gap is 52 to 61 degrees and the distance 14.8 to 16.9. Orange also stays at least 6 (same scale) from the danger red, where it is nearest (7.4 to 11.8 today). The warning status and the Memories category always carry their own icon and label, so color is never the only signal.

**When to use them**

- Use a category color only on that area's own surfaces: its icon tile, tag, left bar, underline, key figure and spot illustration. Nav glyphs for the five areas use the area's `-solid`. Orange belongs to Memories rescue alone.
- Always pair the color with the category icon and its text label. Color is never the only signal.
- Never use a category color for a status, inside a notice, or as body text on a plain ground.
- Moss (olive green) belongs to Quiet friends only. It is not the success status, which is a cooler, bluer green, and it never means "OK" or "done". The moon icon and the label tell them apart.
- Counts that belong to no area, such as friends and exports read, use the neutral scope: `--surface-sunken` fill, `--text-muted` text and `--border-strong` edge.
- The five hues keep their distance from the status hues (warning gold, success green, info blue) and from confidence slate. Orange is the one that sits between two statuses: it is measured against the warning gold (above) and it is nearer to danger red (perceptual distance 7 to 12, hue gap 22 to 34 degrees). Where two sit close, the icon and the label tell them apart: danger always shows its warning icon and words, and Memories rescue always shows its own icon and name.

**Violet tints.** A four-step scale of neutral washes for backgrounds and borders. They are not accents.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--tint-violet-1` | `#F6F3FF` | `#181328` | Faint wash: tinted panels, hover on nav |
| `--tint-violet-2` | `#EFEBFF` | `#1F1838` | Active nav, brand-colored chips, meter tracks. Equals the Cleanup `-bg` |
| `--tint-violet-3` | `#E2DBFF` | `#2B2252` | Pressed or strong wash. Text only: never a colored glyph or bar on it |
| `--tint-violet-line` | `#CDC2FF` | `#44397A` | Decorative 1 px line on a tint, never the only edge of a control |

### Accessibility

Light and dark themes are both supported. All 334 tracked color pairs pass WCAG 2.x AA: 4.5:1 for text, 3:1 for interface components and graphics. That covers every category color (orange included) on every ground and on its own tint, the violet tints, the status colors on plain surfaces, the distance between orange and the warning gold, and a floor on its distance from danger red. Run `node brand/tokens/contrast.mjs` after any token change; it exits with an error if a pair fails or if `tokens.css` and `tokens.json` disagree.

---

## 5. Typography

All families are licensed under the SIL Open Font License 1.1 and self-hosted, because the dashboard blocks network access. Never link a font CDN.

| Role | Family | Weights | Used for |
|---|---|---|---|
| Display | Bricolage Grotesque | 600, 700 | Headings, large numbers, wordmark (700) |
| Body | Atkinson Hyperlegible Next | 400, 500, 600, 700 | Everything you read; designed for legibility |
| Mono | JetBrains Mono | 400, 500 | Usernames, file names, code, the command line |
| Digits | Snappy Digits | 400, 500, 600, 700 | The ten digits 0 to 9 in every body and display string, so a zero is always plain. A subset of Bricolage Grotesque. |

Usernames are monospace so that look-alike characters (l, I, 1, O, 0) stay distinct when someone is choosing whom to act on.

Fallback stacks are defined in `tokens.css`: display falls back to Space Grotesk, Segoe UI and the system font; body to the system font; mono to the system monospace.

### Scale

Sizes run from 12 to 60 px. Line height uses three tokens: tight (1.1), snug (1.25) and body (1.5).

| Style | Size | Line height | Weight | Family | Tracking |
|---|---|---|---|---|---|
| Display XL | 60 px | Tight | 700 | Display | -2% |
| Display | 48 px | Tight | 700 | Display | -2% |
| H1 | 36 px | Snug | 700 | Display | -2% |
| H2 | 30 px | Snug | 700 | Display | -2% |
| H3 | 24 px | Snug | 600 | Display | -2% |
| H4 | 20 px | Snug | 600 | Display | -2% |
| Lead | 18 px | Body | 400 | Body | 0 |
| Body | 16 px | Body | 400 | Body | 0 |
| Secondary | 14 px | Body | 400 | Body | 0 |
| Label | 14 px | Body | 600 | Body | +1% |
| Caption | 12 px | Body | 500 | Body | +1% |
| Username | 0.9375em of the text around it | n/a | 500 | Mono | 0 |

### Rules

- 12 px is the minimum size, for captions only. Body text on phones is never below 16 px.
- Keep running text to a measure of 65 characters (`--measure`).
- Size in `rem`, not `px`, so the interface follows the user's font-size setting. Layouts survive 200% zoom.
- Use tabular numbers in tables and counts.
- Numerals: Atkinson Hyperlegible Next draws a slashed zero and has no OpenType switch for a plain one (its only features are ccmp, frac, locl, pnum and tnum). So the dashboard embeds **Snappy Digits**, a digits-only family cut from Bricolage Grotesque (U+0030 to U+0039, weights 400 to 700, about 2 KB a file), and lists it FIRST in the `--font-body` and `--font-display` stacks. Every numeral in the interface (body text, dates, counts, tables, buttons, headings) shows a plain zero, and every letter still comes from Atkinson or Bricolage. `tnum` is kept, so tabular numbers line up; digit height and baseline match Atkinson at 14, 16 and 18 px. Usernames and code stay in JetBrains Mono, where the slashed zero keeps 0 and O apart. Regenerate the files with `python -I apps/dashboard/fonts/make-snappy-digits.py`.
- Headings use balanced wrapping. Never center body paragraphs.

---

## 6. Layout, shape, elevation and motion

**Spacing.** A 4 px grid: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96 px. Dashboard content column 36rem (576 px), about 75 characters of running text: every block in a view (paragraph, list, table, code, notice, card, form) fills that one column. The sidebar, column, header and footer share one centered width.

**Breakpoints.** 480, 768, 1024, 1280 and 1600 px. Design for phones first. The last two are the wide layout, below.

**Touch targets.** 44 px minimum on touch devices, 36 px with a mouse.

### Wide screens

From 1280 px (`--bp-wide`, 80rem) the shell and the content area widen; from 1600 px (`--bp-xwide`, 100rem) they widen once more. Below 1280 px nothing changes: a phone, a tablet and a narrow window keep the single column above, pixel for pixel.

| Token | Value | Meaning |
|---|---|---|
| `--col` | 36rem | The measure: running text, notices and fields never get wider than this, at any screen size |
| `--col-wide` | 60rem | Content area beside the 16rem sidebar from 1280 px; the shell is 79rem |
| `--col-xwide` | 77rem | The same from 1600 px; the shell is 96rem and stops growing there, centered, with equal margins |

- **Columns, not stretch.** A wide screen adds columns; it never stretches a paragraph. Cards that are siblings sit in equal columns: the Start steps three across, the Overview findings five across, counts three or six across, the Tools hub three across at every wide width and one tile width in every group (a group of two or five ends its last row short rather than stretching a tile), lists of people two across (three across from 1600 px, the last one or two sharing the row), the Export health notes in columns that follow their count (its Memories notes beside them as the second column), facts as small cards, the licenses two across. In the Start steps the numbers, titles and bodies each start at one height, so no field floats in the middle of a card. A block that holds running text is a card in a column, never a wide card with an empty right third. Two cards that cannot fill a row between them do not leave one alone: the last odd card spans the row, or the group is split three and two.
- **Use the width where it helps.** Tables, tiles, bars, the command blocks and the terminal panel use the full content width.
- **Independent sections flow in two balanced columns** (`columns()` in `components/layout.ts`, CSS columns): Privacy, Settings, the Memories file notes, the Habits bar lists. The document order is the reading order, so the keyboard order is unchanged. Nothing is reordered with CSS.
- **Page parts.** An empty state is a full-width card with its illustration and words together in the middle. A tool page puts its "what this reads" card beside the title. The notes about saving and the sample-data card on Start are bands: the words at the measure on the left, the one action on the right.
- **Keep checking.** `tools/screenshots/layout-audit.mjs` measures every route at 1280, 1440, 1600, 1920 and 2560 px in both themes, with and without data: no horizontal overflow, equal columns, no lone last card, text within the measure, equal margins, and a sidebar that never covers the content.

**Radius**

| Token | Value | Used for |
|---|---|---|
| `--radius-bar` | 4 px | Meter bars and bar chips: the logo's pill ends |
| `--radius-sm` | 4 px | Badges, tags |
| `--radius-md` | 8 px | Buttons, inputs |
| `--radius-lg` | 12 px | Cards, panels |
| `--radius-xl` | 16 px | Dialogs, sheets |
| `--radius-full` | 999 px | Toggles only |

**Elevation.** Borders before shadows. Shadows appear only on layers that float, such as menus and dialogs. The dark theme uses lighter surfaces rather than heavier shadows.

**Shape language.** Horizontal bars with fully rounded ends. Progress, meters, skeletons, dividers and empty states are all drawn from bars.

**Focus.** A 2 px ring in `--focus-ring` with a 2 px offset on every interactive element. Never remove it.

**Motion**

| Token | Duration | Used for |
|---|---|---|
| `--dur-fast` | 120 ms | Hover, press, toggle |
| `--dur-base` | 200 ms | Menus, accordions |
| `--dur-slow` | 320 ms | Page and dialog transitions |
| `--bar-stagger` | 40 ms | Delay between bars in the signature motion |

Easing is `cubic-bezier(0.2, 0, 0, 1)`.

- **Signature: bars slide in.** When a view first appears, its key bars slide in 8 px from the left, each 40 ms after the last. Once per view.
- **Progress is a bar, not a spinner.** The bar grows with the real percentage. When the amount is unknown, two bars slowly trade places.
- **Reduced motion is respected.** With `prefers-reduced-motion`, there is no sliding: changes are instant or fade only.

---

## 7. Icons

`brand/icons/icons.svg` is a symbol sprite on a 24 px grid with a 2 px stroke, rounded caps and joins, 2 px corners, and `currentColor` only. Filled shapes are rare and use bar geometry. `brand/icons/preview.html` shows every icon.

| Icon | Meaning |
|---|---|
| `i-vanished` | Disappeared friends |
| `i-one-way` | Unaccepted requests |
| `i-quiet` | Quiet friends |
| `i-queue` | Cleanup queue |
| `i-memories` | Memories rescue |
| `i-seal` | Backup |
| `i-content-blind` | Your export stays on this device |
| `i-import`, `i-export`, `i-file-zip` | Add your export, save a report, the export file |
| `i-overview` | Overview |
| `i-people` | Friends, new friends |
| `i-snapshots` | Exports in your saved history |
| `i-guide` | Export guide, About |
| `i-photo`, `i-video` | Photos, videos |
| `i-file`, `i-file-missing` | A file of unknown type, a file not included in the export |
| `i-calendar` | Dates and date ranges |
| `i-list` | Lists, what Snappy reads, the menu button |
| `i-sun`, `i-moon` | The theme toggle: shows the theme it switches to |
| `i-tools` | Tools |
| `i-storage` | Storage meter |
| `i-device` | On this device |
| `i-shield` | Network status, cannot connect to the internet |
| `i-minus` | Optional |
| `i-settings`, `i-search`, `i-check`, `i-close`, `i-warning`, `i-info`, `i-copy`, `i-remove`, `i-chevron-right`, `i-external` | Utility |
| `conf-high`, `conf-medium`, `conf-low` | Confidence meters, always beside the word |

- Sizes: 16, 20 and 24 px.
- Icon-only buttons need an accessible name. Decorative icons are `aria-hidden`.
- Status and confidence icons always sit next to a text label.

**Spot illustrations.** The `g-*` symbols in the same sprite (`g-import`, `g-overview`, `g-empty`, `g-memories`, `g-privacy`, `g-guide`) are small scenes, 160 by 120, built from pill bars (8 tall, radius 4), rounded cards and one highlight element. The highlight takes `--spot-hi` and the backing wash takes `--spot-wash`, so one drawing follows every category and both themes. A few drawings add one small orange pill bar (`g-orange`, from `--orange-solid`) as a secondary highlight. They contain no text and are always decorative (`aria-hidden`). They belong in empty states, not in page headers, so a page's lead has the same width as every paragraph below it.

**Imagery.** No photographs of people and no stock photography. Use bar compositions, the spot illustrations and real interface screenshots built from synthetic sample data.

---

## 8. Voice and microcopy

Plain, specific, calm. Short sentences, active voice, and the next step first. No exclamation marks, no emoji, no jokes about anyone's friend list, no alarm.

**Import.** Name the step, then say where the data stays.
- "Add your Snapchat data export. Your export stays on this device."
- "Reading your export. 3 of 5 parts done."

**Results.** Lead with the order Snappy found.
- "214 friends. 6 may have removed you, 9 requests are not accepted, 12 are quiet."
- "3 friends are waiting on a reply."
- "Memories sorted into 8 years and 61 months. Dates restored for 4,120 files."
- "Nothing here has left this device."

**Uncertainty.** Always hedge honestly, and show the evidence.
- "May have removed you. Medium confidence: they were in your March export and are missing from your latest one. Their account could also have been deleted."

**Destructive actions.** The button states the exact action and number. The dialog says what cannot be undone.
- Button: "Remove 12 friends". Dialog: "Removing a friend cannot be undone. To add them again, they must accept a new request."

**Errors.** Say what happened, then what to do. No blame, no apology.
- "This ZIP has no JSON files. Request your export again and choose JSON."
- "Snappy could not read friends.json. The file may be incomplete. Check that every part of the export finished downloading."

**Empty states.** Name what will appear and how to get it.
- "No export yet. Add your Snapchat data export to see your friend list in order."
- "Your Cleanup queue is empty. Friends you choose to review will appear here."

**Confirmations.** Past tense and specific: "Report saved." "Backup saved."

**Buttons and labels.** Verbs, sentence case, one to three words: "Add export", "Review queue", "Save report", "Remove 12 friends", "Cancel".

**Avoid:** Oops, Whoops, Awesome, Simply, Just, unfriend, ghost, purge, stalker, exposed, leaked.

---

## 9. Components at a glance

| Component | Spec |
|---|---|
| Primary button | Ink fill with bone text in light, bone fill with ink text in dark. Radius 8, height 44 (touch) or 36, label weight 600. Hover uses `--primary-hover`. |
| Secondary button | Transparent, 1 px `--border-strong`, text `--text`. |
| Danger button | Outlined with `--danger-border` and `--danger-fg`, with `i-remove`. Filled only inside the confirm dialog. |
| Accent use | Violet: active nav bar, step numbers, meters. Category colors: icon tile, tag, left bar and key figure of that area only. |
| Tile (stat or finding) | Everything is centered: icon tile, title, big number, description and, on a finding, an Open action. Tiles sit in a six-column grid and take their rows from it as a subgrid, so the icon tiles, titles, numbers, descriptions and actions of the tiles in one row share horizontal lines, and every title takes the same number of lines (one at desktop widths). A stat tile ends with a short pill bar in the area's color (gray for counts that belong to no area); a finding tile is one link. The five findings are three across, then two wider ones, so the grid has no hole. Running text stays left-aligned. |
| Category tag | Small chip with the category icon (16 px) and its label, in the area's `-fg`, `-bg` and `-border`. Used where areas mix, such as cleanup rows. |
| Step card | `--surface` card with a violet square holding the step number, then the heading and content. The number is decorative; a screen-reader prefix names the step. |
| Quiet notice | `--surface` with a hairline border, a small status icon, and a 4 px status-colored left border. Body text is always the normal text color. No leading "Note." or "Warning." label: the icon and a hidden label say the kind. Default for info and success. Warnings and errors add a subtle tint. |
| Empty state | A spot illustration (highlight in the area's color) beside a title, one line of body text and the next action, on a quiet violet-tinted panel. |
| Input | 1 px `--border-strong`, radius 8, 16 px text, visible label above, error text with an icon below. |
| Username chip | Monospace 14 px, `--surface-sunken` fill, radius 4, copy button. |
| Confidence badge | Meter icon and word, tinted with the confidence colors, radius 4. |
| Card | `--surface`, 1 px `--border`, radius 12, no shadow. |
| Table | Row height 48, sticky header, tabular numbers, row actions at the end. |
| Dialog | `--surface-raised`, radius 16, `--shadow-lg`, `--scrim` behind it, focus trapped, Esc closes. |

---

## 10. Using the assets

### File index

| Path | Contents |
|---|---|
| `brand/logo/` | Mark, single-color mark, app icon, favicon, lockup, stacked lockup, wordmark (all SVG) |
| `brand/logo/png/` | `app-icon-1024.png`, `app-icon-512.png`, `app-icon-192.png`, `favicon-32.png`, `favicon-16.png`, `mark-512.png` |
| `brand/logo/favicon.ico` | Multi-size favicon |
| `brand/tokens/tokens.css` | Design tokens as CSS custom properties, with light and dark themes |
| `brand/tokens/tokens.json` | The same tokens as data |
| `brand/tokens/contrast.mjs` | WCAG contrast check for every tracked pair |
| `brand/tokens/palette.svg`, `brand/tokens/palette.png` | A swatch sheet of the brand, status, category (orange included) and confidence colors in both themes |
| `brand/icons/icons.svg`, `brand/icons/preview.html` | The icon sprite and a preview page |
| `brand/social-preview.svg`, `brand/social-preview.png` | GitHub repository image, 1280 by 640: lockup, tagline and the independence line |
| `brand/tools/outline-wordmark.mjs` | Regenerates the outlined wordmark in the wordmark file and both lockups |
| `brand/tools/build-assets.mjs` | Builds the PNGs, the ICO, the palette sheet and the social preview from the SVG and token sources |

### Tokens

Import `tokens.css` once at the root of a page. The dashboard ships dark by default. In the tokens, light is the default and the dark theme follows the operating system unless the root element sets `data-theme="light"` or `data-theme="dark"`, which always wins. Use the custom properties, never raw hex values, so both themes work. `tokens.json` carries the same values for scripts and tools.

Fonts are not loaded by `tokens.css`. Bundle the OFL families as local files: Bricolage Grotesque, Atkinson Hyperlegible Next, JetBrains Mono and the digits-only Snappy Digits. The stacks list Snappy Digits first, so a page that does not define the family simply ignores it.

### Regenerating the wordmark and the raster assets

Two scripts in `brand/tools/` write generated files. Both turn all text into outlined paths, so nothing depends on installed fonts. Neither runs from the repository root as is, because the packages they need are not repository dependencies. Set up once in a scratch folder:

1. `npm install opentype.js @resvg/resvg-js @fontsource-variable/bricolage-grotesque`
2. Instance the Bricolage Grotesque variable font at weight 700 and optical size 48, because opentype.js cannot read variable fonts. The commands are in the header of `outline-wordmark.mjs`; they use Python fontTools and save `fonts/inst-w700-opsz48.ttf` in the scratch folder.

Then run from that scratch folder:

- **Wordmark.** `FONT=fonts/inst-w700-opsz48.ttf node <repo>/brand/tools/outline-wordmark.mjs`. It converts "Snappy" in Bricolage Grotesque Bold, tracking -2%, into paths and writes them into the wordmark and both lockups.
- **Rasters and sheets.** `BRICOLAGE=fonts/inst-w700-opsz48.ttf node <repo>/brand/tools/build-assets.mjs`. It writes the PNG exports, `favicon.ico`, the palette sheet and the social preview. It reads the tokens from `tokens.json` and the Atkinson Hyperlegible Next and JetBrains Mono files from the repository's `node_modules/@fontsource`, so run `npm install` in the repository first. Run the wordmark script first when the wordmark changes, because the social preview is built from the lockup.

Each script's header lists the same steps and its environment variables.

### Checking contrast

Run `node brand/tokens/contrast.mjs`. It reads `tokens.json`, checks every tracked pair, and exits with an error if any pair falls below WCAG AA. It also confirms that the category and tint tokens in `tokens.css` match `tokens.json` in the light, OS-dark and forced-dark blocks.

### Independence and trademark

Every public surface carries this line:

> Snappy is an independent tool. It is not affiliated with, endorsed by, or sponsored by Snap Inc. Snapchat is a trademark of Snap Inc.

Describe compatibility with the word "Snapchat" only. Never use Snapchat's logo, ghost, yellow or typefaces.
