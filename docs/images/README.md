# Screenshots

Every image in this folder is a real capture of the built dashboard showing Snappy’s built-in sample data (“Use sample data”): invented friends such as `ghost_1`, made by the synthetic generator in `packages/core`. None comes from a real account, and none shows a browser window or a desktop. The README uses a few of them.

They are made by a script, so they can be refreshed when the screens change.

## Make them again

You need Node 22.18 or later, `npm install` run in the repository, and Playwright installed anywhere (it is not a dependency of this repository; the steps are at the top of `tools/mobile/ios-webkit.mjs`). Point `PLAYWRIGHT_DIR` at the folder that has it.

```
PLAYWRIGHT_DIR=<folder with playwright installed> npm run screenshots
```

In PowerShell, set the folder first with `$env:PLAYWRIGHT_DIR = "<folder>"`. Everything runs in headless browsers on this computer, so nothing opens on your screen and nothing leaves it. `npm run screenshots` runs four steps, which you can also run one by one:

```
npm run build:dashboard
node tools/screenshots/capture.mjs
node tools/mobile/ios-webkit.mjs --out out/screenshots/ios --phones "iPhone SE (3rd gen),iPhone 15,iPhone 15 Pro Max" --tool year-in-review --tool-scroll "At a glance"
node tools/screenshots/compose.mjs
```

1. `capture.mjs` takes the desktop pictures at 1440 by 900 and the phone-size Chromium pictures at 390 by 844 (at 2x), in both themes. It checks that each page really rendered in the theme in its name, and that each picture after the sample data was loaded shows the Sample data banner. A page with a long list is first scrolled to its results, and a picture ends in the gap between two cards, never through one, so a picture can be a little shorter than the window. It writes full-size PNG files to `out/screenshots`, which git ignores.
2. `ios-webkit.mjs` takes the iPhone-size pictures in WebKit (the engine inside iOS Safari) for the Overview page and one tool page. It also checks for sideways scrolling and any network attempt.
3. `compose.mjs` turns the captures into the WebP files here and builds `readme-header.webp`. It uses the headless Chromium that Playwright provides, so no image library is needed.

Keep the whole folder under about 6 MB. `apps/dashboard/test/docs-images.test.ts` checks the budget, and that every image the README links exists and has alt text.

## Social preview

The picture for the repository’s social preview is not in this folder. It is `brand/social-preview.png` (1280 by 640), built with the rest of the brand files by `brand/tools/build-assets.mjs`, and `docs/BRAND.md` describes it. Upload that one in the repository’s settings on GitHub (Settings, then General, then Social preview). That is a web setting, so it is a step for the maintainer, not something the script does.

## Desktop in Chromium, 1440 by 900

| Page | Light | Dark |
|---|---|---|
| Start, before any data | ![Start page in the light theme](desktop-start-light.webp) | ![Start page in the dark theme](desktop-start-dark.webp) |
| Overview | ![Overview page in the light theme](desktop-overview-light.webp) | ![Overview page in the dark theme](desktop-overview-dark.webp) |
| Unaccepted requests | ![Unaccepted requests page in the light theme](desktop-unaccepted-requests-light.webp) | ![Unaccepted requests page in the dark theme](desktop-unaccepted-requests-dark.webp) |
| Cleanup queue | ![Cleanup queue page in the light theme, with the filters, the warning and the first four people to review](desktop-cleanup-queue-light.webp) | ![Cleanup queue page in the dark theme, with the filters, the warning and the first four people to review](desktop-cleanup-queue-dark.webp) |
| Memories rescue | ![Memories rescue page in the light theme, with the counts, files found and the storage cap with its meter](desktop-memories-rescue-light.webp) | ![Memories rescue page in the dark theme, with the counts, files found and the storage cap with its meter](desktop-memories-rescue-dark.webp) |
| Tools | ![Tools page in the light theme, with the Your export and Friends groups of helpers](desktop-tools-hub-light.webp) | ![Tools page in the dark theme, with the Your export and Friends groups of helpers](desktop-tools-hub-dark.webp) |
| Friends table tool, scrolled to the table | ![Friends table tool in the light theme, scrolled to the table of friends with dates, counts and hints](desktop-tool-friends-table-light.webp) | ![Friends table tool in the dark theme, scrolled to the table of friends with dates, counts and hints](desktop-tool-friends-table-dark.webp) |
| Year in review tool | ![Year in review tool in the light theme](desktop-tool-year-in-review-light.webp) | ![Year in review tool in the dark theme](desktop-tool-year-in-review-dark.webp) |
| In-app terminal, finished demo run | ![In-app terminal after the demo command finished, light theme](desktop-terminal-demo-run-light.webp) | ![In-app terminal after the demo command finished, dark theme](desktop-terminal-demo-run-dark.webp) |
| Privacy | ![Privacy page in the light theme](desktop-privacy-light.webp) | ![Privacy page in the dark theme](desktop-privacy-dark.webp) |
| Settings | ![Settings page in the light theme](desktop-settings-light.webp) | ![Settings page in the dark theme](desktop-settings-dark.webp) |

## Phone-size Chromium, 390 by 844

| Page | Light | Dark |
|---|---|---|
| Overview | ![Overview on a phone, light theme](phone-overview-light.webp) | ![Overview on a phone, dark theme](phone-overview-dark.webp) |
| Tools | ![Tools page on a phone, light theme, with the first two helpers](phone-tools-hub-light.webp) | ![Tools page on a phone, dark theme, with the first two helpers](phone-tools-hub-dark.webp) |
| Cleanup queue | ![Cleanup queue on a phone, light theme](phone-cleanup-queue-light.webp) | ![Cleanup queue on a phone, dark theme](phone-cleanup-queue-dark.webp) |
| Year in review tool | ![Year in review tool on a phone, light theme, with its At a glance counts](phone-tool-year-in-review-light.webp) | ![Year in review tool on a phone, dark theme, with its At a glance counts](phone-tool-year-in-review-dark.webp) |

## iPhone sizes in WebKit

These are Safari’s engine at three iPhone screen sizes, not a real iPhone: there is no iOS keyboard, safe area or system font. The Overview page, then the Year in review tool.

| Size | Overview, light | Overview, dark | Year in review, light | Year in review, dark |
|---|---|---|---|---|
| iPhone SE (3rd generation), 375 by 667 | ![Overview at iPhone SE size, light theme](iphone-se-3rd-gen-overview-light.webp) | ![Overview at iPhone SE size, dark theme](iphone-se-3rd-gen-overview-dark.webp) | ![Year in review tool at iPhone SE size, light theme](iphone-se-3rd-gen-tool-light.webp) | ![Year in review tool at iPhone SE size, dark theme](iphone-se-3rd-gen-tool-dark.webp) |
| iPhone 15, 393 by 659 | ![Overview at iPhone 15 size, light theme](iphone-15-overview-light.webp) | ![Overview at iPhone 15 size, dark theme](iphone-15-overview-dark.webp) | ![Year in review tool at iPhone 15 size, light theme](iphone-15-tool-light.webp) | ![Year in review tool at iPhone 15 size, dark theme](iphone-15-tool-dark.webp) |
| iPhone 15 Pro Max, 430 by 739 | ![Overview at iPhone 15 Pro Max size, light theme](iphone-15-pro-max-overview-light.webp) | ![Overview at iPhone 15 Pro Max size, dark theme](iphone-15-pro-max-overview-dark.webp) | ![Year in review tool at iPhone 15 Pro Max size, light theme](iphone-15-pro-max-tool-light.webp) | ![Year in review tool at iPhone 15 Pro Max size, dark theme](iphone-15-pro-max-tool-dark.webp) |

## Composed image

![Light and dark side by side: the Overview page in a desktop window, with the Cleanup queue on a phone in front of it](readme-header.webp)

## Windows app

The installed Windows beta, captured as its own window (title bar included) at its default size, showing the sample data. These four are captured by hand from the running app with a small PowerShell window-capture script, not by `npm run screenshots`.

![The Windows app showing the Overview page in the dark theme](windows-app-overview-dark.webp)
![The Windows app showing the Tools page in the light theme](windows-app-tools-light.webp)
![The Windows app showing the Friends table tool in the dark theme](windows-app-friends-table-dark.webp)
![The Windows app showing the in-app terminal after a finished command](windows-app-terminal-dark.webp)

## Updates

The desktop page with a scripted stand-in for the app shell and made-up data, so the update banner, countdown and cards can be shown without a release. They are headless captures, not the installed app.

![The update banner at a phone width, dark theme](updates-ready-phone-width.png)
![The countdown banner before an idle update](updates-countdown.png)
![The Updates card in Settings](updates-settings.png)
![The Update check block on the Privacy page](updates-privacy.png)

## Not captured yet

These need a screen or a device, so a headless run cannot make them. When they exist they take these names and the same rules (sample data only, no window chrome).

| Picture | Planned names | Needs |
|---|---|---|
| Android phone app | `android-overview-light.webp`, `android-overview-dark.webp`, `android-tool-light.webp`, `android-tool-dark.webp` | An Android emulator, with `tools/mobile/android-capture.mjs` |
| iPhone in the Simulator | `ios-simulator-overview-light.webp`, `ios-simulator-overview-dark.webp` | Xcode’s Simulator on a Mac |
