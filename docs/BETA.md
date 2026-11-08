# Snappy Windows beta

This page is for people testing the Snappy installer for Windows. It says what the beta is, how to install it, where it keeps its data, how to remove it, what to try first and how to report a problem without sharing anything personal.

## What the beta is

Snappy is the dashboard from this repository in its own window: the cleanup queue, Memories rescue, the Tools page and the in-app commands. It reads the Snapchat export that you already have, on your computer.

This is an early test build, version `0.1.0-beta.2`. Expect rough edges, and please report them.

- It is **unsigned**. Windows warns you before it runs the installer (see below).
- It **checks for updates by itself** (new in beta 2). See [Updates](#updates) below, which says what the check sends and how to turn it off. The beta cannot export your saved history, so keep your original Snapchat export: you can add it again.
- It has **no telemetry** and no account. Apart from the update check, Snappy itself sends nothing over a network.
- It installs **for your user only**. It does not need administrator rights.
- It is the 64-bit Windows build only. It needs Windows 10 or 11 and Microsoft’s WebView2 runtime, which Windows 11 includes. If the runtime is missing, the installer downloads it from Microsoft.

## What is new in beta 2

- **It checks for updates by itself.** When Snappy opens, it asks GitHub whether a newer version exists, and it can install a signed update for you. See [Updates](#updates).
- **The in-app terminal says the same version as the app.** Beta 1 printed `Version 0.1.0` in the help text while the app said `0.1.0-beta.1`.
- **The terminal’s output is tidier.** The logo’s bars join up, and the help list is fitted to the width of the window instead of wrapping twice.
- **Use sample data** is a button near the top of the Start page, so you do not have to scroll to it.
- **The Settings page says where the license texts are.** Beta 1 pointed at a licenses folder that the Windows install does not have; each license is now opened from its name in Settings, under About.
- **A branded installer.** It has Snappy’s own pictures, and **Create desktop shortcut** is no longer checked by default. The uninstaller’s box is worded more clearly (see [Remove Snappy](#remove-snappy-and-everything-it-stored)).

## Install

1. Download `Snappy_0.1.0-beta.2_x64-setup.exe` and, if you have it, `Snappy_0.1.0-beta.2_x64-setup.exe.sha256`.
2. Check the file. In PowerShell, run `(Get-FileHash .\Snappy_0.1.0-beta.2_x64-setup.exe -Algorithm SHA256).Hash` and compare the result with the text in the `.sha256` file. The letters and digits must be the same, whatever the case. A match shows the file is complete and is the one that was published with that checksum.
3. Open the installer. Windows may show a blue window titled “Windows protected your PC”. Choose **More info**, then **Run anyway**.
4. Follow the installer. It has one language (English) and installs to your user folder, `%LOCALAPPDATA%\Snappy` unless you pick another. The pages are Welcome, License, Install location and Finish. The Finish page has two boxes: **Run Snappy** (checked) and **Create desktop shortcut** (not checked, so a desktop shortcut is your choice). Snappy always gets a Start menu shortcut. If you leave **Run Snappy** checked, Snappy starts when you choose Finish; on the maintainers’ busy test computer that took about a minute and a half, and the cause was not found, so if nothing happens, wait, or start Snappy from the Start menu.

**Why Windows warns you.** Signing an installer means a company vouches for who built it, and it costs money and a registration. This beta is not signed, so Windows cannot tell who made it and shows the warning for any installer it has not seen many people download. It is not a sign that the file is damaged, but it is why the checksum step matters.

If Windows 11 has **Smart App Control** turned on, it blocks unsigned installers outright and offers no Run anyway. Snappy does not ask you to turn Smart App Control off. Build Snappy yourself instead (see [RELEASES.md](RELEASES.md)).

## Where Snappy keeps its data

Snappy puts files in these places on Windows. The list comes from installing, running and uninstalling beta 2 through the installer’s own pages on one Windows 11 computer, with sample data.

| What | Where |
| --- | --- |
| The program | `%LOCALAPPDATA%\Snappy` (the folder the installer proposes), holding `snappy.exe` and `uninstall.exe`. |
| Start menu shortcut | `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Snappy.lnk` |
| Desktop shortcut | `%USERPROFILE%\Desktop\Snappy.lnk`, only if you select the **Create desktop shortcut** checkbox on the Finish page. A silent install (the `/S` option) makes it without asking. |
| Apps and features entry | The registry key `HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Uninstall\Snappy`. It names the version and the publisher, Snappy contributors. |
| The web engine’s profile and your saved history | `%LOCALAPPDATA%\com.snappy.export\EBWebView`. This is where Microsoft’s WebView2 keeps what the page stores: your theme choice, your saved history if you set a passphrase, and the engine’s own cache and settings. |
| The update check’s notes | `%LOCALAPPDATA%\com.snappy.export\updates`. A small file, `updater.json` (about 300 bytes: the on or off setting, whether the first-run notice was shown, when the last check was made, counters and short error codes), a lock file, and the folders `ready` and `tmp` where a downloaded update waits. A waiting installer can be up to 64 MiB. No address, name or export data is kept there. **Delete data** in Settings leaves this folder alone. The uninstaller’s checkbox removes it, and so does deleting the folder by hand. |
| The installer’s memory of its folder | The registry key `HKEY_CURRENT_USER\Software\Snappy contributors\Snappy`, which holds the install folder and the installer language. |

Snappy writes nothing next to your export and nothing in your Documents folder. It uses no `.snappy` folder: that belongs to the command line tool. Microsoft’s WebView2 runtime is a shared part of Windows, and Snappy does not install or remove it.

## Remove Snappy and everything it stored

1. The beta cannot export or back up a saved history, and deleting it cannot be undone. Keep your original Snapchat export, which you can add again.
2. Close Snappy.
3. Open Windows Settings, then Apps, then Installed apps, find **Snappy** and choose **Uninstall**. You can also run `uninstall.exe` from the install folder. The first page of the uninstaller has one box, **Also delete Snappy’s saved data (history and settings)**. It is **not selected** unless you select it.
4. **With the box checked**, the uninstaller removes the program, the shortcuts, the Apps and features entry, the installer’s registry key, and the folder `%LOCALAPPDATA%\com.snappy.export` with everything in it (the web engine’s profile, your saved history and the update notes).
5. **With the box not checked** (and with a silent uninstall, the `/S` option, which cannot show the box), the uninstaller removes the program, the shortcuts and the Apps and features entry, and it leaves two things: the folder `%LOCALAPPDATA%\com.snappy.export` (in the maintainers’ test about 196 files and 10.8 MB after a short first run) and the registry key `HKEY_CURRENT_USER\Software\Snappy contributors`. That is deliberate: a copy installed again later finds your saved history where you left it. To remove them by hand, delete the folder (paste its path into the Explorer address bar) and the registry key, which only remembers the install folder.
6. If you would rather clear the saved history first and keep the program, open Settings in Snappy and choose **Delete data**.

The uninstaller does not delete data unless its checkbox is selected, and it does not ask again, so select the checkbox if you want the data gone. Your export files are never touched by Snappy or by the uninstaller.

## Updates

New in beta 2. The wording on this page about what the check sends is a draft that the project owner has not approved yet, and it is hedged on purpose: [UPDATES.md](UPDATES.md) is the decision record, and it is what the program was built to do.

- **What it does.** A few seconds after the window opens, Snappy asks one fixed address on github.com for a small file that names the newest version, at most once an hour. If the file names a newer version, Snappy downloads the installer from GitHub, checks its signature against two keys built into the program, and keeps it ready. It applies the update the next time Snappy opens, or when you choose **Update now** (or **Restart now**) and nothing is in progress. It does not install a lower version, and it does not run while another Snappy window or a copy outside the install folder is open.
- **The first time.** The first launch shows a short notice, “Snappy checks GitHub for updates when it opens. Change this in Settings.”, with **OK** and **Turn off**. The launch that shows the notice makes no check at all. The notice counts as shown when it appears, and the next launch is the first to check, whether or not you pressed a button. (A build made earlier on the same day sent its first check about four seconds after the first window opened, with the notice still on screen. That was found and fixed, and the final installer was watched making none on its first launch.) Whether the first check should also wait for your answer to the notice is an open decision for the project owner.
- **Where to see it and turn it off.** Settings has an **Updates** card with the version, a **Check now** button, the box **Check for updates on launch** (check or clear it at any time) and a line saying when the last check was made. Turning the box off stops every automatic request.
- **What it sends.** According to [UPDATES.md](UPDATES.md): one request for the small file and, only if a newer version exists, one request for the installer. The only header the program sets is `User-Agent: Snappy-Updater`. There is no query string, no ID, no version number and none of your data. GitHub, your network and any proxy on the way can see your IP address, the time and that a Snappy app asked. Windows may look up a proxy configuration. The request is made by `snappy.exe` and never by the page, whose security policy still forbids every connection. This says nothing about Microsoft’s WebView2 (see below).
- **What was seen.** In the maintainers’ test of the installed beta 2 on one computer, pressing **Check now** made one connection from `snappy.exe` to `github.com` on port 443 and no other connection left the computer from any process of the app, WebView2’s included, in the minutes watched. There is no published release yet, so GitHub answers “not found”: Settings then says “Couldn’t check. Try again.” and nothing else appears. That is one computer at one moment.
- **Not verified.** An update through a proxy, the real GitHub redirects (they need a published release), and a check made on launch after the first hour. The update drill in `apps/app/test/e2e-update` runs the whole update path (found, signature checked, installed per user at the next launch, data kept, and every kind of broken release refused) against a test server on the same computer with test keys, not against GitHub; all 34 of its checks passed in its last full run, after it found and fixed three problems ([UPDATES.md](UPDATES.md) lists them).

## Use it with your own export

Snappy reads your export and never changes it. It opens the ZIP files read-only, and it does not move, rename or delete them. Your export stays where it is.

- It reads friend usernames and dates. It skips message text, photos, videos, locations and display names.
- Apart from the update check (see [Updates](#updates)), Snappy itself sends nothing over a network, and its page is not allowed to connect to anything.
- **One open question.** The window is drawn by Microsoft’s WebView2, a separate program that Snappy does not control. In one test on one computer, a sign-in part of WebView2 connected to Microsoft in the background, although Snappy’s own page made no request. Snappy turns that part off, and the connection stopped in later tests on that computer. A WebView2 update could change that, and nothing in the build can check it. The Privacy page in the app says the same, and [RELEASES.md](RELEASES.md) has the details. In a check of beta 2 (installed by the wizard, about eleven minutes of use across five launches and two installs, runtime 157, one computer, the sockets of the whole process tree sampled about every 0.1 to 2 seconds), the only connections to an outside address came from `snappy.exe` to `github.com` on port 443, and none came from `msedgewebview2.exe`. The sampler can miss a connection shorter than its interval. That says nothing about other computers or later runtimes. If you need certainty, block outbound connections for `msedgewebview2.exe` in your firewall. The maintainers have not tested that rule.
- Pressing Run on a command runs it inside the app. Files it makes are kept in the app until you press Save.

Never send your export, or any file from it, to anyone, including the people who make Snappy.

## Command line tool

The installer does not include the Snappy command line tool, `snappy-export`. It is a separate download for people who are comfortable in a terminal. It is in the Snappy repository on GitHub, it needs Node 22.18 or later, and its README (`apps/cli/README.md`) says how to install and run it.

Inside the app, **Run** works on a copy of the command and keeps what it writes in the app, up to 256 MB, so a small test works. A real Memories rescue copies several gigabytes into a folder you choose, and that needs the command line tool. Copy the command from the Memories rescue page into a terminal where the tool is installed. Nothing else in the app needs it.

## What to try first

1. Open **Start**. Choose **Use sample data** to look around with sample friends. Nothing about the sample is saved.
2. On Start, choose **Choose ZIP files** (or drop the ZIP files on the page) and pick every ZIP part of your export at once. The Export guide page says what to select when you request one.
3. Open **Overview** and read the export health notes before the results.
4. Open **Tools**. Pick one or two, such as the export check, and read what each says it reads.
5. On the **Export guide** page, press **Run** on `demo --run`, then choose your export and press **Run** on `inspect`. Read the output before you share any of it.

## Report a problem without sharing personal data

Open an issue in the Snappy repository and include only this:

- **The version.** It is at the bottom of every page (“Beta version …”) and on the Settings page.
- **What you did,** step by step, in plain words.
- **What you saw,** and what you expected instead.
- **A screenshot only if it shows sample data or blurred content.** Use the sample data to reproduce a problem when you can, and blur every username first.
- **The output of the `inspect` command, after you have read it.** It prints names of fields and counts, never values. Read every line before you paste it.

Never attach your export or any file from it, never paste a username, a message, a photo name or a link, and never describe a friend by name. If a report cannot be made without personal data, say that instead and describe the problem in words.
