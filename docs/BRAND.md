# Snappy brand guide

For contributors and anyone using the Snappy assets. The design tokens in [`brand/tokens/tokens.css`](../brand/tokens/tokens.css) and [`brand/tokens/tokens.json`](../brand/tokens/tokens.json) are the source of truth; this guide explains how to use them.

---

## 1. Snappy in one page

**Snappy helps you organize your Snapchat world from your own data export.** It builds a tidy, current friend list: who is still a friend, requests nobody answered, quiet friends, a careful clean-up queue and a backup. It sorts Memories into year and month folders with their dates restored, makes duplicates and storage visible, and shows who is waiting on a reply. It runs on your own device, as a command line tool and a local dashboard.

**Personality.** Calm, capable, tidy and a little warm. Quick, never childish, never alarmist. Snappy talks like a careful friend who is good at putting things in order: plain, specific and steady.

**Four principles**

1. **Order first.** Every screen turns a pile into a list: sorted, counted, dated and ready to act on. If a view does not make something tidier, it does not belong.
2. **Say how sure we are.** Snappy infers from exports. Every result shows its confidence and its evidence, and never states a guess as a fact.
3. **Quiet by default, one spark.** Ink and bone do the work. Violet appears once per view, as the point of focus.
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
| Requests no one accepted | Friend requests you sent that were never answered |
| Quiet friends | Friends with no recent activity |
| Cleanup queue | The careful list of friends you chose to review and remove |
| Memories rescue | Memories sorted into year and month folders with dates restored |

### American English

Use US spelling and conventions everywhere: color, gray, organize, analyze, canceled, license, center, favorite, behavior. Dates as "Nov 6, 2026" (or 11/6/2026 in dense tables), times as "3:42 PM", numbers as 1,234.5, Oxford comma, "log in" (verb) and "login" (noun), "email", "setup" (noun) and "set up" (verb). Percent sign with no space (45%). Straight quotes in code, curly quotes in prose.

### Word choices

| Say | Avoid | Why |
|---|---|---|
| may have removed you | unfriended you, deleted you | Snappy infers; it does not know. |
| Remove | Delete, unadd, purge | Matches the real effect. |
| Quiet friends | Dormant, dead, inactive | Neutral, not judgmental. |
| Requests no one accepted | Failed adds | Nothing failed. |
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

Warm ink, cool bone and one violet accent, on top of four clear status colors. Snapchat's yellow is never used.

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

- **Violet is used once per view.** It marks the point of focus: the active step, the key number, the progress bar or the spine of the logo.
- **Violet is never body text and never a status color.** Violet text uses `--accent-fg` or `--link`. Text on a violet fill is white in the light theme and ink in the dark theme.
- **Primary buttons are ink in the light theme and bone in the dark theme,** not violet.
- Place the accent on `--bg`, `--surface` or `--surface-raised`.

### Status colors

Always shown with an icon and a text label. Each has a foreground, a background and a border.

| Status | Light fg | Light bg | Light border | Dark fg | Dark bg | Dark border |
|---|---|---|---|---|---|---|
| Success | `#0B6B43` | `#E2F4EA` | `#2F8F63` | `#6FD9A3` | `#0F2A1E` | `#3FA877` |
| Warning | `#7A4300` | `#FCEFD6` | `#B26A00` | `#F2B45A` | `#2E2005` | `#C98A1F` |
| Danger | `#A8112B` | `#FBE5E8` | `#C8334C` | `#FF8FA0` | `#35101A` | `#E5586F` |
| Info | `#1B4F9E` | `#E3EDFA` | `#2F6FCC` | `#8DB8FF` | `#10223D` | `#4F86E0` |

### Confidence meter

Confidence is three stacked bars plus a word, the same shape as the logo. The bar count and the word carry the meaning; color only supports them.

| Level | Bars | Word | Light fg | Dark fg |
|---|---|---|---|---|
| High | Three filled | High | `#0B6B43` | `#6FD9A3` |
| Medium | Two filled, one outlined | Medium | `#7A4300` | `#F2B45A` |
| Low | One filled, two outlined | Low | `#4A5560` | `#B5BEC7` |

The low level uses slate gray with backgrounds `#E8ECEF` (light) and `#22282E` (dark), and borders `#6B7782` and `#7C8791`. Even High is described as likely, never certain.

### Accessibility

Light and dark themes are both supported. All 126 tracked color pairs pass WCAG 2.x AA: 4.5:1 for text, 3:1 for interface components and graphics. Run `node brand/tokens/contrast.mjs` after any token change; it exits with an error if a pair fails.

---

## 5. Typography

All three families are licensed under the SIL Open Font License 1.1 and self-hosted, because the dashboard blocks network access. Never link a font CDN.

| Role | Family | Weights | Used for |
|---|---|---|---|
| Display | Bricolage Grotesque | 600, 700 | Headings, large numbers, wordmark (700) |
| Body | Atkinson Hyperlegible Next | 400, 500, 600, 700 | Everything you read; designed for legibility |
| Mono | JetBrains Mono | 400, 500 | Usernames, file names, code, the command line |

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
- Headings use balanced wrapping. Never center body paragraphs.

---

## 6. Layout, shape, elevation and motion

**Spacing.** A 4 px grid: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96 px. Content maximum width 1120 px (70rem).

**Breakpoints.** 480, 768, 1024 and 1280 px. Design for phones first.

**Touch targets.** 44 px minimum on touch devices, 36 px with a mouse.

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
| `i-one-way` | Requests no one accepted |
| `i-quiet` | Quiet friends |
| `i-queue` | Cleanup queue |
| `i-memories` | Memories rescue |
| `i-seal` | Backup |
| `i-content-blind` | Your export stays on this device |
| `i-import`, `i-export`, `i-file-zip` | Add your export, save a report, the export file |
| `i-settings`, `i-search`, `i-check`, `i-close`, `i-warning`, `i-info`, `i-copy`, `i-remove`, `i-chevron-right`, `i-external` | Utility |
| `conf-high`, `conf-medium`, `conf-low` | Confidence meters, always beside the word |

- Sizes: 16, 20 and 24 px.
- Icon-only buttons need an accessible name. Decorative icons are `aria-hidden`.
- Status and confidence icons always sit next to a text label.

**Imagery.** No photographs of people and no stock photography. Use bar compositions and real interface screenshots built from synthetic sample data.

---

## 8. Voice and microcopy

Plain, specific, calm. Short sentences, active voice, and the next step first. No exclamation marks, no emoji, no jokes about anyone's friend list, no alarm.

**Import.** Name the step, then say where the data stays.
- "Add your Snapchat data export. Your export stays on this device."
- "Reading your export. 3 of 5 parts done."

**Results.** Lead with the order Snappy found.
- "214 friends. 6 may have removed you, 9 requests have no answer, 12 are quiet."
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
| Accent use | One violet element per view: the step indicator, a key figure, or the progress bar. |
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
| `brand/tokens/palette.svg`, `brand/tokens/palette.png` | A swatch sheet of the palette in both themes |
| `brand/icons/icons.svg`, `brand/icons/preview.html` | The icon sprite and a preview page |
| `brand/social-preview.svg`, `brand/social-preview.png` | GitHub repository image, 1280 by 640: lockup, tagline and the independence line |
| `brand/tools/outline-wordmark.mjs` | Regenerates the outlined wordmark in the wordmark file and both lockups |
| `brand/tools/build-assets.mjs` | Builds the PNGs, the ICO, the palette sheet and the social preview from the SVG and token sources |

### Tokens

Import `tokens.css` once at the root of a page. Light is the default; the dark theme follows the operating system unless the root element sets `data-theme="light"` or `data-theme="dark"`, which always wins. Use the custom properties, never raw hex values, so both themes work. `tokens.json` carries the same values for scripts and tools.

Fonts are not loaded by `tokens.css`. Bundle the three OFL families as local files.

### Regenerating the wordmark and the raster assets

Two scripts in `brand/tools/` write generated files. Both turn all text into outlined paths, so nothing depends on installed fonts. Neither runs from the repository root as is, because the packages they need are not repository dependencies. Set up once in a scratch folder:

1. `npm install opentype.js @resvg/resvg-js @fontsource-variable/bricolage-grotesque`
2. Instance the Bricolage Grotesque variable font at weight 700 and optical size 48, because opentype.js cannot read variable fonts. The commands are in the header of `outline-wordmark.mjs`; they use Python fontTools and save `fonts/inst-w700-opsz48.ttf` in the scratch folder.

Then run from that scratch folder:

- **Wordmark.** `FONT=fonts/inst-w700-opsz48.ttf node <repo>/brand/tools/outline-wordmark.mjs`. It converts "Snappy" in Bricolage Grotesque Bold, tracking -2%, into paths and writes them into the wordmark and both lockups.
- **Rasters and sheets.** `BRICOLAGE=fonts/inst-w700-opsz48.ttf node <repo>/brand/tools/build-assets.mjs`. It writes the PNG exports, `favicon.ico`, the palette sheet and the social preview. It reads the tokens from `tokens.json` and the Atkinson Hyperlegible Next and JetBrains Mono files from the repository's `node_modules/@fontsource`, so run `npm install` in the repository first. Run the wordmark script first when the wordmark changes, because the social preview is built from the lockup.

Each script's header lists the same steps and its environment variables.

### Checking contrast

Run `node brand/tokens/contrast.mjs`. It reads `tokens.json`, checks every tracked pair, and exits with an error if any pair falls below WCAG AA.

### Independence and trademark

Every public surface carries this line:

> Snappy is an independent tool. It is not affiliated with, endorsed by, or sponsored by Snap Inc. Snapchat is a trademark of Snap Inc.

Describe compatibility with the word "Snapchat" only. Never use Snapchat's logo, ghost, yellow or typefaces.
