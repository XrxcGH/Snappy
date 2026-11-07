# Requesting your Snapchat data export for Snappy

Snappy only reads **your own** official "Download My Data" export, on your own device. It never logs in to Snapchat and never uploads anything.

## What to select

| Option | Select? | Why |
|---|---|---|
| 1. Export your memories | Yes (if you want Memories rescue) | Newer exports put your Memories files inside the zips, and the list in the JSON files gives each one's exact capture time. Snappy pairs them by that time and restores it. Media is treated as opaque files: Snappy never looks at it. |
| 2. Export JSON files | **Yes, required** | Snappy reads JSON only. HTML-only exports are rejected. |
| 3. User information | **Yes, required** | Contains your friends list (current, removed by you, blocked, requests). |
| 4. Chat history | Optional | Used only as metadata (who, direction, type, time), for your saved chats and your Snap history. It protects friends you chat or Snap with and helps flag long-quiet ones. Many friends only exchange Snaps, so the Snap history matters as much as chats. Message text is never read or kept. Leave it off if you prefer; you lose that protection. |
| 5–13 (Spotlight, Shopping, Support, Ranking & location, Other media, Other, My AI, shared stories, chat media) | No | Not used. Leaving them off keeps less sensitive data in the zip. |

**Date range: All Time** for everything. A shorter range might cut older friends out of the list, which would make them look like people who may have removed you. Use the same range every time you export so exports can be compared.

## After you request it

1. Snapchat prepares the export and emails you a link. A large export comes as **several separate zip files**, for example `mydata~1234567890123.zip`, `mydata~1234567890123-2.zip` and `mydata~1234567890123-3.zip` (your own number replaces the digits). Download them all, keep the original names, and put them in one folder. Do not unzip them. The first file, the one without a number at the end, holds your JSON files; the others hold photos and videos, including your Memories files.
2. Note your **current friend count** from the app (Profile → Friends). Snappy can warn you if the export's count differs.
3. Do **not** send the files or their contents to anyone, including Snappy's developers. If something does not read correctly, you can share only the *shape* of the export, using the command in the next section. It prints field names, types and rough counts, and it masks anything it does not recognize.

## Memories in a newer export

In a newer export the Memories list has no download links. The files are in the zips instead, and each one is stored with its exact capture time. `snappy-export memories` pairs every list entry with the file stored at exactly that second, and says how it matched. If the zip program wrote its times in local time, Snappy detects the whole-hour shift. Only if the times cannot be used does it fall back to the date and type, and it says so. Some entries may have no file in your zips. Snappy counts those and does not guess. Give it every part in one command:

```powershell
npm run snappy-export -- memories "C:\Users\you\Downloads\mydata*.zip" --out "C:\Users\you\Documents\Rescued Memories"
```

Add `--dry-run` first to see the plan and write nothing.

## Share only the shape of your export

The `inspect` command opens the zip files in place, reads their JSON structure, and prints a report with no values in it: no messages, names, usernames, places or links. Photos, videos and web pages are not opened or listed. The report only says how many there were, in one line that starts with "Left out on purpose".

Run it on **all your zip files in one command**. The steps below are for Windows with PowerShell. Replace `you` with your Windows user name and the digits with the ones in your file names.

1. Open the Start menu, type `PowerShell`, and press Enter.
2. Go to the Snappy folder:

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

   If the folder also holds zip files from another export, use the first form so only your three files are read. Snappy puts the parts in order itself (the name without a number first, then `-2`, then `-3`), so the order you type them in does not matter.

4. Read the report line by line. If you are happy with it, copy it by adding `| Set-Clipboard` to the end of the same command, then paste it where you need it.

### Options

Add these to the end of the command. You can combine them.

| Option | What it adds | When to use it |
|---|---|---|
| `--show-keys` | Also prints field names that are not on Snappy's list of known names. | Only if asked. A group title or another plain-word name can appear, so read every line before you share the report. |
| `--layout` | Folder totals for each part: how many files of each type, their sizes, and the *shape* of the file names with every letter and digit replaced (for example `9999-99-99_aaaa`). | When the way files are named or split across the zips needs checking. No file name is shown. |
| `--memory-links` | Whether each Memories entry can be matched to its photo or video by an identifier in its download link. Counts and masked patterns only. | When Memories do not line up with their files. An export whose links are empty will say so. |
| `--mtime-check` | Whether the times stored in the zips match the dates in your Memories list, and whether a whole-hour shift (a time zone) is needed. Counts only. | When Memories rescue has to pair files with dates. |
| `--checks-only` | Prints only the checks you asked for, without the JSON structure. | To keep the report short. Use it with at least one of the three checks above. |

For example, the full set of Memories checks on all three files, without the JSON structure:

```powershell
npm run snappy-export -- inspect "C:\Users\you\Downloads\mydata*.zip" --layout --memory-links --mtime-check --checks-only
```

If a part is damaged or still downloading, the report says which part (by number) could not be read and describes the others. Run `npm run snappy-export -- help inspect` to see these options again.

## Storing results

Snappy keeps a local "ledger" of friend-list snapshots so it can spot people who disappeared between exports. It contains usernames, so seal it with a passphrase when prompted. Delete the original zip when you are done if you don't need it.
