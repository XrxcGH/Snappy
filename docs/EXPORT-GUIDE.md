# Requesting your Snapchat data export for Snappy

Snappy only reads **your own** official “Download My Data” export, on your own device. It never logs in to Snapchat and never uploads anything.

**If you installed the Snappy app, you can skip the terminal.** Open **Export guide** in the app and press **Run** on the inspect command, then choose your ZIP files. A real Memories rescue is the one job that needs the command line tool, which is a separate download (see [Command line tool](#command-line-tool) below).

## What to select

| Option | Select? | Why |
|---|---|---|
| 1. Export your memories | Yes (if you want Memories rescue) | Newer exports put your Memories files inside the ZIP files, and the list in the JSON files gives each one’s exact capture time. Snappy pairs them by that time and restores it. Media is treated as opaque files: Snappy never looks at it. |
| 2. Export JSON files | **Yes, required** | Snappy reads JSON only. HTML-only exports are rejected. |
| 3. User information | **Yes, required** | Contains your friends list (current, removed by you, blocked, requests). |
| 4. Chat and Snap history | Optional | Snappy uses it only as metadata: who, direction, type, and time. It protects friends you chat or Snap with and helps spot quiet ones. Many friends only exchange Snaps, so Snap history matters as much as chats. Message text is never read or kept. If you leave it off, you lose that protection. |
| 5 to 13 (Spotlight, Shopping, Support, Ranking and location, Other media, Other, My AI, shared stories, chat media) | No | Not used. Leaving them off keeps less sensitive data in the ZIP file. |

**Date range: “All Time”** for everything. A shorter range might cut older friends out of the list, which would make them look like people who may have removed you. Use the same range every time you export so exports can be compared.

## After you request it

1. Snapchat prepares the export and emails you a link. A large export comes as **several ZIP files**, such as `mydata~1234567890123.zip`, `mydata~1234567890123-2.zip` and `mydata~1234567890123-3.zip`. Your own number replaces the digits.
2. Download every part, keep the original names, and put them in one folder. Do not unzip them.
3. The first file, without a number at the end, holds your JSON files. The others hold photos and videos, including your Memories files.
4. Note your **current friend count** in Snapchat (Profile, then Friends). Snappy can warn you if the export’s count differs.
5. Never send these files to anyone, including Snappy’s developers. Delete them when you are done, if you do not need them.
6. If something does not read correctly, share only the *shape* of the export, using the command in the next section. It prints field names, types and rough counts, and masks anything it does not recognize.

## Command line tool

The commands in this guide run in `snappy-export`, the Snappy command line tool. The Snappy app does not include it. It is a separate download from the Snappy repository on GitHub, it needs Node 22.18 or later, and the README in its `apps/cli` folder says how to install and run it. Open a terminal in the folder where you downloaded it before you run a command below.

## Memories in a newer export

In a newer export the Memories list has no download links. The files are in the ZIP files instead, and each one is stored with its exact capture time. `snappy-export memories` pairs every list entry with the file stored at exactly that second, and says how it matched. If the ZIP file program wrote its times in local time, Snappy detects the whole-hour shift. Only if the times cannot be used does it fall back to the date and type, and it says so. Some entries may have no file in your ZIP files. Snappy counts those and does not guess. Give it every part in one command:

```powershell
npm run snappy-export -- memories "C:\Users\you\Downloads\mydata*.zip" --out "C:\Users\you\Documents\Rescued Memories"
```

Add `--dry-run` first to see the plan and write nothing.

## Share only the shape of your export

The `inspect` command opens the ZIP files in place, reads their JSON structure, and prints a report with no values in it: no messages, names, usernames, places, or links. Photos, videos, and web pages are not opened or listed. The report only says how many there were, in one line that starts with “Left out on purpose”.

Run it on **all your ZIP files in one command**. The steps below are for Windows with PowerShell. Replace `you` with your Windows user name and the digits with the ones in your file names.

1. Open the Start menu, type `PowerShell`, and press Enter.
2. Open a terminal in the folder where you downloaded the Snappy command line tool:

   ```powershell
   cd C:\Users\you\Documents\Snappy
   ```

3. Run the report on all three files, with the full path of each one in quotes:

   ```powershell
   npm run snappy-export -- inspect "C:\Users\you\Downloads\mydata~1234567890123.zip" "C:\Users\you\Downloads\mydata~1234567890123-2.zip" "C:\Users\you\Downloads\mydata~1234567890123-3.zip"
   ```

   A shorter way to name all the parts is a wildcard, or the folder that holds them. Both of these do the same thing as the command above:

   ```powershell
   npm run snappy-export -- inspect "C:\Users\you\Downloads\mydata*.zip"
   npm run snappy-export -- inspect "C:\Users\you\Downloads"
   ```

   If the folder also holds ZIP files from another export, use the first form so only your three files are read. Snappy puts the parts in order itself (the name without a number first, then `-2`, then `-3`), so the order you type them in does not matter.

4. Read the report line by line. If you are happy with it, copy it by adding `| Set-Clipboard` to the end of the same command, then paste it where you need it.

### Options

Add these to the end of the command. You can combine them.

| Option | What it adds | When to use it |
|---|---|---|
| `--show-keys` | Also prints field names that are not on Snappy’s list of known names. | Only if asked. A group title or another plain-word name can appear, so read every line before you share the report. |
| `--layout` | Folder totals for each part: how many files of each type, their sizes, and the *shape* of the file names with every letter and digit replaced (for example `9999-99-99_aaaa`). | When the way files are named or split across the ZIP files needs checking. No file name is shown. |
| `--memory-links` | Whether each Memories entry can be matched to its photo or video by an identifier in its download link. Counts and masked patterns only. | When Memories do not line up with their files. An export whose links are empty will say so. |
| `--mtime-check` | Whether the times stored in the ZIP files match the dates in your Memories list, and whether a whole-hour shift (a time zone) is needed. Counts only. | When Memories rescue has to pair files with dates. |
| `--checks-only` | Prints only the checks you asked for, without the JSON structure. | To keep the report short. Use it with at least one of the three checks above. |

For example, the full set of Memories checks on all three files, without the JSON structure:

```powershell
npm run snappy-export -- inspect "C:\Users\you\Downloads\mydata*.zip" --layout --memory-links --mtime-check --checks-only
```

If a part is damaged or still downloading, the report says which part (by number) could not be read and describes the others. Run `npm run snappy-export -- help inspect` to see these options again.

## What else Snappy can tell you

Once your export is in one folder, these commands each answer one question. None of them reads message text, photos, videos, locations, or login history, and none sends anything anywhere. A command writes a file only when you ask with an option such as `--out`, and never replaces a file unless you add `--force`.

| Command | What it tells you | What it reads |
|---|---|---|
| `check` | Whether your export is complete enough to use. | The lists and dates. |
| `remind` | Makes a calendar reminder to request your next export. | At most your last export date. |
| `since` | What changed since your last export. | The friends and request lists, and your saved history or an earlier export. |
| `year` | A sum-up of one year of chats, Snaps, new friends and Memories. | Dates, directions and types, never names. |
| `closest` | Friends you chat and Snap with most, and friends who may be fading. | Who and when, from chats and Snaps. |
| `anniversaries` | Friendships that reach a whole year soon. | The friends list and its dates. |
| `backup` | Saves your friends lists as a file, and checks it against a later export. | The friends, blocked, and ignored lists. |
| `blocked` | People you blocked, ignored, or hid from suggestions. | The same lists. |
| `lookalikes` | Usernames that look alike, such as names that differ by a dot or a digit. | The usernames in your friends, request and blocked lists. |
| `friend-count` | How your friend count changed, month by month. | Dates in the friends lists, and your saved history. |
| `friends` | Your friends in one sortable table. | Friend usernames and dates, and who wrote last and when. |
| `replies` | Friends who may be waiting on a reply, and one-sided chats. | Who wrote last and when. |
| `reply-speed` | How fast you and your friends reply. | Who wrote and when. |
| `reach-out` | Who tends to reach out first. | Who wrote and when. |
| `habits` | When you chat and Snap most. | Times and directions, never names. |
| `calendar` | Your activity by day, week and kind. | Kinds and times, never names. |
| `storage` | A plan for saving your Memories under a storage goal. | Memories dates, types, and sizes. |
| `on-this-day` | Memories you took on this day in earlier years. | The dates in your Memories list. |
| `gaps` | Quiet stretches in your Memories. | The dates in your Memories list. |
| `rescue` | A list of the Memories a rescue saves, and a check of a rescue folder. | File names, sizes, and file dates. It never opens a photo or video. |
| `safety` | An account safety checklist. | Nothing, or counts of blocked people and requests. |
| `privacy` | A privacy settings checklist. | Nothing from your export. |

The two checklists are self-reported: Snappy cannot see your settings, so you tell it what you have done with `--done <id,id,...>`, and nothing is saved between runs.

One example for each, in the same form as above:

```powershell
npm run snappy-export -- check "C:\Users\you\Downloads\mydata*.zip"
npm run snappy-export -- remind "C:\Users\you\Downloads\mydata*.zip" --out "C:\Users\you\Documents\export-reminder.ics"
npm run snappy-export -- since "C:\Users\you\Downloads\mydata*.zip" --earlier "C:\Users\you\Downloads\older*.zip"
npm run snappy-export -- year "C:\Users\you\Downloads\mydata*.zip" --year 2025
npm run snappy-export -- closest "C:\Users\you\Downloads\mydata*.zip" --window 90
npm run snappy-export -- anniversaries "C:\Users\you\Downloads\mydata*.zip" --days 60
npm run snappy-export -- backup "C:\Users\you\Downloads\mydata*.zip" --out "C:\Users\you\Documents\friends.json"
npm run snappy-export -- blocked "C:\Users\you\Downloads\mydata*.zip" --counts
npm run snappy-export -- lookalikes "C:\Users\you\Downloads\mydata*.zip" --counts
npm run snappy-export -- friend-count "C:\Users\you\Downloads\mydata*.zip" --no-save
npm run snappy-export -- friends "C:\Users\you\Downloads\mydata*.zip" --sort last --desc --limit 10
npm run snappy-export -- replies "C:\Users\you\Downloads\mydata*.zip"
npm run snappy-export -- reply-speed "C:\Users\you\Downloads\mydata*.zip" --limit 5
npm run snappy-export -- reach-out "C:\Users\you\Downloads\mydata*.zip"
npm run snappy-export -- habits "C:\Users\you\Downloads\mydata*.zip" --utc-offset=-5
npm run snappy-export -- calendar "C:\Users\you\Downloads\mydata*.zip" --year 2025
npm run snappy-export -- storage "C:\Users\you\Downloads\mydata*.zip" --goal-gb 5
npm run snappy-export -- on-this-day "C:\Users\you\Downloads\mydata*.zip" --date 2026-11-06
npm run snappy-export -- gaps "C:\Users\you\Downloads\mydata*.zip" --min-gap 3
npm run snappy-export -- rescue "C:\Users\you\Downloads\mydata*.zip" --out "C:\Users\you\Documents\manifest.json"
npm run snappy-export -- safety --done blocked-list,connected-apps
npm run snappy-export -- privacy --done search,quick-add
```

Run `npm run snappy-export -- help <command>` to see a command’s options.

## Your saved history

Snappy keeps a saved history of past friend lists, so it can spot people who disappeared between exports. It contains usernames, so Snappy encrypts it with a passphrase. Use 12 or more characters. If you forget the passphrase, the saved history cannot be recovered.
