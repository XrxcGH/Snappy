# Snappy for macOS (beta)

This page is for people who want to try Snappy on a Mac. It says which file to download and why, how to install it, why macOS warns you, where Snappy keeps its data, how to remove it, and how to report a problem without sharing anything personal.

**Status.** No release has been published yet. The macOS app is built and started by an automated test on a GitHub computer for every change, and the maintainers have no Mac. So nobody has used this build on a real Mac yet: you would be the first. [RELEASES.md](RELEASES.md) lists what the automated test checks and what it cannot.

## What the beta is

Snappy is the dashboard from this repository in its own window: the cleanup queue, Memories rescue, the Tools page and the in-app commands. It reads the Snapchat export that you already have, on your computer. This is an early test build, version `0.1.0-beta.1`. Expect rough edges, and please report them.

- It is **unsigned** (see below), so macOS warns you the first time you open it.
- It **does not update itself and never checks for updates**. The Windows app has an update check; the macOS app has none. To get a newer beta, download the newer disk image. The beta cannot export your saved history, so keep your original Snapchat export: you can add it again.
- It has **no telemetry** and no account, and Snappy itself sends nothing over a network.

## Which file, and why

The file is `Snappy_0.1.0-beta.1_universal.dmg`.

- **`.dmg` (a disk image) holding `Snappy.app`.** You open it and drag Snappy to Applications. That is how most Mac apps are shared, and removing the app later means dragging it to the Trash.
- **Universal.** One app that runs natively on Apple silicon (M1 and later) and on Intel Macs. You do not choose.
- **No `.pkg` installer.** A package runs installer scripts as part of the install. Snappy needs none, and a package is only needed for the App Store or for putting files outside the app. The release also carries an `Snappy_0.1.0-beta.1_universal.app.tar.gz`, the same app in an archive. It is for the updater that a later version may have, and you do not need it.

## What it needs

macOS 12.3 (Monterey) or newer. The app is a single page that macOS draws with its own WebKit web view, and the page uses features that came with Safari 15.4, which is the WebKit in macOS 12.3. Nothing older than the maintainers’ test computer has been tried, so this is the oldest version that could work, not one that was run.

## Install

1. Download the `.dmg` and its `.sha256` file from the Releases page of the Snappy repository.
2. Check the file. In Terminal, run `shasum -a 256 ~/Downloads/Snappy_0.1.0-beta.1_universal.dmg` and compare the result with the text in the `.sha256` file. A match shows the file is complete and is the one that was published with that checksum.
3. Open the `.dmg`, and drag **Snappy** onto **Applications**. Then eject the disk image.
4. Open Snappy from Applications. The first time, macOS will not open it (see the next section).

## Why macOS warns you

This beta is **not signed with an Apple Developer ID and not notarized**. Notarizing means Apple scans the app and vouches for it, and it needs a paid Apple Developer Program membership that the project does not have yet. Without it, macOS cannot tell who made the app, so on the first open it says that Apple could not verify that “Snappy” is free of malware, or that it cannot be opened. That is not a sign that the file is damaged, but it is why the checksum step matters.

The app does carry an **ad-hoc signature**, which is a signature with no identity behind it. Apple silicon Macs refuse to run a program that has no signature at all, so this is needed. It says nothing about who made the app.

To open it anyway, use one of these:

- **System Settings.** Try to open Snappy once and choose **Done**. Then open **System Settings**, **Privacy & Security**, scroll to the Security section and choose **Open Anyway** next to Snappy. Confirm, and macOS remembers your choice. This works on macOS 13 and later, and it is the way on macOS 15 and later: on macOS 15 the old Control-click, **Open** shortcut no longer gets past the warning.
- **Terminal.** The warning comes from a quarantine mark that your browser puts on downloaded files. To remove the mark from the app, run `xattr -dr com.apple.quarantine /Applications/Snappy.app` and open it again. Only do this for a file whose checksum matched.

These steps have not been tried on a real Mac. If macOS words something differently, please say so in your report.

## Where Snappy keeps its data

Snappy puts files in these places on a Mac. The list comes from starting the app once on a GitHub test computer and listing what appeared, so it is short and may miss something that a longer real use creates.

| What | Where |
| --- | --- |
| The program | Wherever you drag it, normally `/Applications/Snappy.app`. |
| What the page stores, and the web view’s own state | `~/Library/WebKit/com.snappy.export`. This is where macOS’s web view keeps your theme choice, your sealed history if you set a passphrase (in IndexedDB), and its own bookkeeping files. It was about 600 KB after one short run. |
| The web view’s cache | `~/Library/Caches/com.snappy.export`. It was about 8 KB after one short run. |

`~` is your home folder. The Library folder is hidden: in Finder, choose **Go**, **Go to Folder**, and paste a path from the table. Snappy writes nothing next to your export and nothing in your Documents folder. It uses no `.snappy` folder: that belongs to the command line tool. macOS may also save the window’s position in `~/Library/Saved Application State/com.snappy.export.savedState` or in `~/Library/Preferences/com.snappy.export.plist`. Neither appeared in the test, so the paths are a guess from how macOS normally works.

## Remove Snappy and everything it stored

1. The beta cannot export or back up a saved history, and deleting it cannot be undone. Keep your original Snapchat export, which you can add again. Then, in Snappy, open Settings and choose **Delete data**.
2. Quit Snappy (**Snappy**, **Quit Snappy**, or Cmd+Q).
3. Drag `Snappy.app` from Applications to the Trash and empty it. This removes the program only. macOS leaves the folders in the table above in place.
4. To remove the rest, move these to the Trash: `~/Library/WebKit/com.snappy.export` and `~/Library/Caches/com.snappy.export`, and the two window-state paths above if they exist.

Your export files are never touched by Snappy.

## Use it with your own export

Snappy reads your export and never changes it: it opens the ZIP files read-only. It reads friend usernames and dates, and skips message text, photos, videos, locations and display names. Snappy itself sends nothing over a network, and its page is not allowed to connect to anything.

**One open question.** The window is drawn by the web view that comes with macOS (WebKit), a separate component that Snappy does not control. The Privacy page in the app says this. In one automated test on a GitHub computer, the app and its web view made no connection to an outside address in 60 seconds. That test cannot see everything, it was one computer and one macOS version, and a macOS update can change the web view. [RELEASES.md](RELEASES.md) has the details.

## What to try first

1. Open **Start** and choose **Use sample data** to look around with made-up friends. Nothing about the sample is saved.
2. Choose **Choose ZIP files**, and pick every ZIP part of your export at once. This opens the Mac’s file dialog, which no automated test has used yet: tell us if it does anything unexpected.
3. On **Start**, choose **Set passphrase**, then lock and unlock the saved history. This uses a part of the web view (Web Crypto) that has not been checked on a Mac.
4. Click into the passphrase and filter fields and try Cmd+C, Cmd+V and Cmd+A. The Edit menu is there, but typing into a field has not been tried on a Mac.

## Report a problem without sharing personal data

Open an issue in the Snappy repository and include only this:

- **The version.** It is at the bottom of every page (“Beta version …”) and on the Settings page.
- **Your macOS version and whether your Mac is Apple silicon or Intel.** Both are under the Apple menu, **About This Mac**.
- **What you did,** step by step, in plain words.
- **What you saw,** and what you expected instead.
- **A screenshot only if it shows made-up or blurred content.** Use the sample data to reproduce a problem when you can, and blur every username first.
- **The output of the `inspect` command, after you have read it.** It prints names of fields and counts, never values. Read every line before you paste it.

Never send your export, or any file from it, to anyone, including the people who make Snappy.
