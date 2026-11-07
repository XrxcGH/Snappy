# Third-party notices

Snappy itself is licensed under the Apache License 2.0 (see `LICENSE`). The components below are distributed with it, each under its own license. Development tools (TypeScript, vitest, esbuild and their dependencies) are used to build and test Snappy and are not part of what Snappy distributes.

## Runtime library

| Component | Version | License | Copyright |
|---|---|---|---|
| fflate (zip and deflate support) | 0.8.3 | MIT | Copyright (c) 2026 Arjun Barrett |

The full MIT text is in `apps/dashboard/dist/licenses/fflate-MIT.txt` after a dashboard build, and in the package's own `LICENSE` file.

## Fonts (embedded in the dashboard)

All three are licensed under the SIL Open Font License, Version 1.1. The fonts are bundled unmodified, from the `@fontsource` packages, version 5.3.0 each. The OFL text and each copyright statement are in `apps/dashboard/dist/licenses/` after a dashboard build.

| Font | Copyright |
|---|---|
| Bricolage Grotesque | Copyright 2022 The Bricolage Grotesque Project Authors (https://github.com/ateliertriay/bricolage) |
| Atkinson Hyperlegible Next | Copyright 2020-2024 The Atkinson Hyperlegible Next Project Authors (https://github.com/googlefonts/atkinson-hyperlegible-next) |
| JetBrains Mono | Copyright 2020 The JetBrains Mono Project Authors (https://github.com/JetBrains/JetBrainsMono) |

The OFL does not allow selling the fonts by themselves, and a modified font may not keep a Reserved Font Name. Snappy does not modify the fonts. If you replace them, follow the OFL for the new ones.

## Trademarks

Snapchat is a trademark of Snap Inc. Snappy is an independent project and is not affiliated with Snap Inc. See `TRADEMARKS.md`.
