# Third-party notices

Snappy itself is licensed under the Apache License 2.0 (see `LICENSE`). The components below are distributed with it, each under its own license. Development tools (TypeScript, vitest, esbuild and their dependencies) are used to build and test Snappy and are not part of what Snappy distributes.

## Runtime library

| Component | Version | License | Copyright |
|---|---|---|---|
| fflate (zip and deflate support) | 0.8.3 | MIT | Copyright (c) 2026 Arjun Barrett |

The full MIT text is in `apps/dashboard/dist/licenses/fflate-MIT.txt` after a dashboard build, and in the package's own `LICENSE` file.

## Fonts (embedded in the dashboard)

All three are licensed under the SIL Open Font License, Version 1.1. The font files are bundled from the `@fontsource` packages, version 5.3.0 each, and are not edited. The one exception is the digits-only family described below. The OFL text and each copyright statement are in `apps/dashboard/dist/licenses/` after a dashboard build.

| Font | Copyright |
|---|---|
| Bricolage Grotesque | Copyright 2022 The Bricolage Grotesque Project Authors (https://github.com/ateliertriay/bricolage) |
| Atkinson Hyperlegible Next | Copyright 2020-2024 The Atkinson Hyperlegible Next Project Authors (https://github.com/googlefonts/atkinson-hyperlegible-next) |
| JetBrains Mono | Copyright 2020 The JetBrains Mono Project Authors (https://github.com/JetBrains/JetBrainsMono) |

### Snappy Digits (a subset of Bricolage Grotesque)

Atkinson Hyperlegible Next draws a slashed zero and has no OpenType feature that turns it off, so the dashboard shows every numeral in a plain-zero face. `Snappy Digits` is a **modified version of Bricolage Grotesque**: the four weights 400, 500, 600 and 700 are subset to the ten characters U+0030 to U+0039 (the digits 0 to 9, with their tabular and proportional number features) with the fontTools tool `pyftsubset`, and embedded in the page as four small woff2 files (about 2 KB each, in `apps/dashboard/fonts/`). Nothing else about the glyphs is changed. It is covered by the same SIL Open Font License, Version 1.1, and the same copyright statement as Bricolage Grotesque (Copyright 2022 The Bricolage Grotesque Project Authors); the font files keep that notice in their name table, and the full license text ships as `apps/dashboard/dist/licenses/bricolage-grotesque-OFL.txt`. Bricolage Grotesque declares no Reserved Font Name, and the subset is used under its own name, `Snappy Digits`, only as a stand-in for those ten characters in the same page. The script `apps/dashboard/fonts/make-snappy-digits.py` regenerates the files from the `@fontsource` package.

The OFL does not allow selling the fonts by themselves, and a modified font may not keep a Reserved Font Name. If you replace the fonts, follow the OFL for the new ones.

## Trademarks

Snapchat is a trademark of Snap Inc. Snappy is an independent project and is not affiliated with Snap Inc. See `TRADEMARKS.md`.
