# Snappy Windows beta

This page is for people testing the first Snappy installer for Windows. It says what the beta is, how to install it, where it keeps its data, how to remove it, what to try first and how to report a problem without sharing anything personal.

## What the beta is

Snappy is the dashboard from this repository in its own window: the cleanup queue, Memories rescue, the Tools page and the in-app commands. It reads the Snapchat export that you already have, on your computer.

This is an early test build, version `0.1.0-beta.1`. Expect rough edges, and please report them.

- It is **unsigned**. Windows warns you before it runs the installer (see below).
- It **does not update itself**. To get a newer beta, download the newer installer and run it. The beta cannot export your saved history, so keep your original Snapchat export: you can add it again.
- It has **no telemetry** and no account. Snappy itself sends nothing over a network.
- It installs **for your user only**. It does not need administrator rights.
- It is the 64-bit Windows build only. It needs Windows 10 or 11 and Microsoft’s WebView2 runtime, which Windows 11 includes. If the runtime is missing, the installer downloads it from Microsoft.

## Install

1. Download `Snappy_0.1.0-beta.1_x64-setup.exe` and, if you have it, `Snappy_0.1.0-beta.1_x64-setup.exe.sha256`.
2. Check the file. In PowerShell, run `(Get-FileHash .\Snappy_0.1.0-beta.1_x64-setup.exe -Algorithm SHA256).Hash` and compare the result with the text in the `.sha256` file. The letters and digits must be the same, whatever the case. A match shows the file is complete and is the one that was published with that checksum.
3. Open the installer. Windows may show a blue window titled “Windows protected your PC”. Choose **More info**, then **Run anyway**.
4. Follow the installer. It has one language (English) and installs to your user folder. When it finishes, start Snappy from the Start menu.

**Why Windows warns you.** Signing an installer means a company vouches for who built it, and it costs money and a registration. This beta is not signed, so Windows cannot tell who made it and shows the warning for any installer it has not seen many people download. It is not a sign that the file is damaged, but it is why the checksum step matters.

If Windows 11 has **Smart App Control** turned on, it blocks unsigned installers outright and offers no Run anyway. Snappy does not ask you to turn Smart App Control off. Build Snappy yourself instead (see [RELEASES.md](RELEASES.md)).

## Where Snappy keeps its data

Snappy puts files in these places on Windows. The list comes from installing, running and uninstalling the beta on one Windows 11 computer.

| What | Where |
| --- | --- |
| The program | A folder named Snappy that the installer picks for your user (`snappy.exe` and `uninstall.exe`). An installer for one user normally proposes `%LOCALAPPDATA%\Snappy`. The maintainers’ test used a different folder, so that default was not checked. |
| Start menu shortcut | `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Snappy.lnk` |
| Desktop shortcut | `%USERPROFILE%\Desktop\Snappy.lnk`. A silent install made it. |
| Apps and features entry | The registry key `HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Uninstall\Snappy`. It names the version and the publisher, Snappy contributors. |
| Snappy’s saved data and the web engine’s profile | `%LOCALAPPDATA%\com.snappy.export`, which holds one folder, `EBWebView`. This is where Microsoft’s WebView2 keeps what the page stores: your theme choice, your sealed history if you set a passphrase, and the engine’s own cache and settings. |
| The installer’s memory of its folder | The registry key `HKEY_CURRENT_USER\Software\Snappy contributors\Snappy`, which holds the install folder. |

Snappy writes nothing next to your export and nothing in your Documents folder. It uses no `.snappy` folder: that belongs to the command line tool. Microsoft’s WebView2 runtime is a shared part of Windows, and Snappy does not install or remove it.

## Remove Snappy and everything it stored

1. The beta cannot export or back up a saved history, and deleting it cannot be undone. Keep your original Snapchat export, which you can add again. Then, in Snappy, open Settings and choose **Delete data**. The tick box to delete application data in the uninstaller (step 4) removes your saved history for good too.
2. Close Snappy.
3. Open Windows Settings, then Apps, then Installed apps, find **Snappy** and choose **Uninstall**. You can also run `uninstall.exe` from the install folder. This removes the program, both shortcuts and the Apps and features entry. A silent uninstall (the `/S` option) did exactly that in the maintainers’ test, and it left the data in step 5 in place.
4. The uninstaller that Tauri builds has a tick box to delete the application data. The maintainers could not drive that window in their test, so it is **not verified** that the box removes the folder in step 5. Check it yourself.
5. To remove the rest, delete the folder `%LOCALAPPDATA%\com.snappy.export` (paste that into the Explorer address bar). It held about 190 files, around 9 MB, after a few short runs. You can also delete the registry key `HKEY_CURRENT_USER\Software\Snappy contributors`, which only remembers the install folder.

Your export files are never touched by Snappy or by the uninstaller.

## Use it with your own export

Snappy reads your export and never changes it. It opens the ZIP files read-only, and it does not move, rename or delete them. Your export stays where it is.

- It reads friend usernames and dates. It skips message text, photos, videos, locations and display names.
- Snappy itself sends nothing over a network, and its page is not allowed to connect to anything.
- **One open question.** The window is drawn by Microsoft’s WebView2, a separate program that Snappy does not control. In one test on one computer, a sign-in part of WebView2 connected to Microsoft in the background, although Snappy’s own page made no request. Snappy turns that part off, and the connection stopped in later tests on that computer. A WebView2 update could change that, and nothing in the build can check it. The Privacy page in the app says the same, and [RELEASES.md](RELEASES.md) has the details. In a check of this beta (three launches, runtime 157, one computer), Snappy’s processes opened no connection to an outside address. That says nothing about other computers or later runtimes. If you need certainty, block outbound connections for `msedgewebview2.exe` in your firewall. The maintainers have not tested that rule.
- Pressing Run on a command runs it inside the app. Files it makes are kept in the app until you press Save.

Never send your export, or any file from it, to anyone, including the people who make Snappy.

## What to try first

1. Open **Start**. Choose **Use sample data** to look around with made-up friends. Nothing about the sample is saved.
2. On Start, choose **Choose ZIP files** (or drop the ZIP files on the page) and pick every ZIP part of your export at once. The Export guide page says what to select when you request one.
3. Open **Overview** and read the export health notes before the results.
4. Open **Tools**. Pick one or two, such as the export check, and read what each says it reads.
5. On the **Export guide** page, press **Run** on `demo --run`, then choose your export and press **Run** on `inspect`. Read the output before you share any of it.

## Report a problem without sharing personal data

Open an issue in the Snappy repository and include only this:

- **The version.** It is at the bottom of every page (“Beta version …”) and on the Settings page.
- **What you did,** step by step, in plain words.
- **What you saw,** and what you expected instead.
- **A screenshot only if it shows made-up or blurred content.** Use the sample data to reproduce a problem when you can, and blur every username first.
- **The output of the `inspect` command, after you have read it.** It prints names of fields and counts, never values. Read every line before you paste it.

Never attach your export or any file from it, never paste a username, a message, a photo name or a link, and never describe a friend by name. If a report cannot be made without personal data, say that instead and describe the problem in words.
