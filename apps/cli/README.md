# Snappy command line

Offline tools for your own Snapchat data export. Snappy is content-blind: it reads friend usernames, dates, and categories, and skips messages, photos, and locations. Nothing leaves this device, and no request carries your data. The one network feature of this tool is `memories --download`, which you opt into and which contacts only the links inside your own export. Newer exports have no links (their Memories are inside the ZIP files), so for them it has nothing to download and Snappy says so. The Windows app has its own optional update check, which this tool does not make ([docs/UPDATES.md](../../docs/UPDATES.md)).

Snappy is an independent tool. It is not affiliated with, endorsed by, or sponsored by Snap Inc. Snapchat is a trademark of Snap Inc.

## Run it

From the repository root, on Node 22.18 or later (Node 24 is fine):

```
npm run snappy-export -- help
npm run snappy-export -- demo --run
```

The script runs `node --experimental-strip-types apps/cli/src/main.ts`, so there is no build step. `@snappy-export/core` resolves through the npm workspace link to its TypeScript source.

## Commands

| Command | What it does |
|---|---|
| `snappy-export analyze <ZIP files or folder...>` | Reads the export, updates your saved history (your past exports), and prints the cleanup queue: disappeared friends, unaccepted requests, and quiet friends. Saved chats and Snaps both count as recent activity. It also summarizes how the Memories list matches the files in the ZIP files (counts only). |
| `snappy-export memories <ZIP files or folder...> --out <folder>` | Plans the Memories rescue, shows the storage meter, and copies the files bundled in the export with their exact capture time restored. `--download` is for older exports that have links. |
| `snappy-export inspect <ZIP files or folder...>` | Prints the structure of the export (field names, types, bucketed counts), never a value. |
| `snappy-export keep <username...>` / `snappy-export unkeep <username...>` | Manages the keep list in your saved history: friends who never appear in the cleanup queue. |
| `snappy-export history status` | Lists the exports in your saved history: dates and friend counts, never usernames. `ledger status` still works. |
| `snappy-export demo [--run]` | Writes two invented exports and prints the commands to try them. |

Several ZIP files, a folder of ZIP files, or a wildcard such as `"mydata*.zip"` are the parts of one export. Snappy puts them in the order Snapchat numbers them (the name without a number, then `-2`, then `-3`), whatever order you type them in. To compare two exports, give the older one with `--earlier`, or let your saved history remember it between runs.

Exit codes: 0 done, 1 could not run, 2 the export has errors (analyze, inspect, and the commands below), 3 Memories finished with some failed items.

## More commands

These twenty-two commands read your export and answer one question each. All of them work offline, and none reads message text, photos, videos, locations, or login history. Each one prints text, and takes `--json`, `--verbose`, and `--no-color`. Run `npm run snappy-export -- help <command>` for its options. A command writes a file only when you pass an output option such as `--out`, and never replaces a file unless you add `--force`. Your saved history is read only by `friend-count` and `since`, and never changed.

**Your export**

- `snappy-export check`: says whether your export is complete enough to use, and what to do if not. It reads the lists and dates only.
  `npm run snappy-export -- check "mydata*.zip"`
- `snappy-export remind`: makes a calendar file that reminds you to request your next export. It holds no personal data, and the ZIP files are read only to find your last export date.
  `npm run snappy-export -- remind "mydata*.zip" --out reminder.ics`
- `snappy-export since`: shows what changed since your last export: friends added, friends who may have left, and how your requests went. It compares with your saved history or with `--earlier`, and `--out` saves the changes as a CSV file that lists usernames.
  `npm run snappy-export -- since "mydata*.zip" --earlier "older*.zip"`
- `snappy-export year`: sums up one year of chats, Snaps, new friends and Memories. It reads dates, directions and types only, so it prints no usernames.
  `npm run snappy-export -- year "mydata*.zip" --year 2025`

**Friends**

- `snappy-export closest`: lists the friends you chat and Snap with most lately, and friends who may be fading. It reads who and when from saved chats and Snaps, never message text.
  `npm run snappy-export -- closest "mydata*.zip" --window 90`
- `snappy-export anniversaries`: lists friendships that reach a whole year soon. It reads the friends list and its dates only.
  `npm run snappy-export -- anniversaries "mydata*.zip" --days 60`
- `snappy-export backup`: saves your friends, blocked, and ignored lists as a small file, and later checks that file against a new export. The file lists usernames, so keep it private.
  `npm run snappy-export -- backup "mydata*.zip" --out friends.json`
- `snappy-export blocked`: lists the people you blocked, ignored, or hid from suggestions, and people who show up in more than one place. `--counts` prints no usernames.
  `npm run snappy-export -- blocked "mydata*.zip" --counts`
- `snappy-export lookalikes`: finds usernames that look alike, such as two names that differ by a dot or a digit. A pair proves nothing, so it only says a pair may be worth a second look. `--counts` prints no usernames.
  `npm run snappy-export -- lookalikes "mydata*.zip" --counts`
- `snappy-export friend-count`: shows how your friend count grew and shrank, month by month, from the dates in your export. With a saved history it also compares the two. `--no-save` skips it.
  `npm run snappy-export -- friend-count "mydata*.zip" --no-save`
- `snappy-export friends`: lists your friends in one table, with the day you added each one and your last chat or Snap. It can sort and filter, and `--out` saves the table as a CSV file that lists usernames.
  `npm run snappy-export -- friends "mydata*.zip" --sort last --desc --limit 10`

**Chats**

- `snappy-export replies`: lists friends who may be waiting on a reply from you, friends you may be waiting on, and one-sided chats. It reads who wrote last and when, never message text.
  `npm run snappy-export -- replies "mydata*.zip" --you-days 3`
- `snappy-export reply-speed`: shows how fast you and your friends reply in one-to-one chats. It reads who wrote and when, never message text. `--out` saves every friend as a CSV file that lists usernames.
  `npm run snappy-export -- reply-speed "mydata*.zip" --limit 5`
- `snappy-export reach-out`: shows who tends to reach out first in each one-to-one chat. A new exchange starts after a long silence. It reads who wrote and when, never message text.
  `npm run snappy-export -- reach-out "mydata*.zip" --gap-hours 6`
- `snappy-export habits`: shows when you chat and Snap most, by hour, weekday, and month. It reads times and directions only, never names.
  `npm run snappy-export -- habits "mydata*.zip" --utc-offset=-5`
- `snappy-export calendar`: shows your activity by day, week and month, and which kinds it was. It reads kinds and times only, never names. `--detail` adds a row for every full week.
  `npm run snappy-export -- calendar "mydata*.zip" --year 2025`

**Memories**

- `snappy-export storage`: plans how to save your Memories under a storage goal, with sizes, a download order, and batches. It reads dates, types, and sizes only, and writes no file.
  `npm run snappy-export -- storage "mydata*.zip" --goal-gb 5`
- `snappy-export on-this-day`: shows the Memories you took on this day in earlier years. It reads the dates in your Memories list only.
  `npm run snappy-export -- on-this-day "mydata*.zip" --date 2026-11-06`
- `snappy-export gaps`: finds the months with no Memories and the busiest stretch. It reads the dates in your Memories list only, and writes no file.
  `npm run snappy-export -- gaps "mydata*.zip" --min-gap 3`
- `snappy-export rescue`: lists the Memories a rescue saves, writes that list as a manifest with `--out`, and later checks a rescue folder against it with `--verify`. It compares names, sizes, and file dates, and never opens a photo or video.
  `npm run snappy-export -- rescue "mydata*.zip" --out manifest.json`

**Checklists**

These are self-reported. Snappy cannot see your settings, so you say what you have done with `--done <id,id,...>`. Nothing is saved between runs: add every done id each time.

- `snappy-export safety`: walks through an account safety checklist. A ZIP file is optional, and adds counts of blocked people and pending requests.
  `npm run snappy-export -- safety --done blocked-list,connected-apps`
- `snappy-export privacy`: lists the privacy settings worth a look, with a short hint for each. It reads no export.
  `npm run snappy-export -- privacy --done search,quick-add`

## Memories rescue

A real export is three ZIP files. The first holds the JSON files, including the Memories list with each Memory’s exact capture time. The others hold the photos and videos, and every file in them is stored with its capture time too. `snappy-export memories` pairs each list entry with the file stored at exactly that second (and says how it matched; if the zipper’s clock was not UTC it detects the whole-hour shift, and as a last resort it matches by date and type with a warning). Then, for each pair, it:

- reads only that one file out of its ZIP file, never a whole ZIP file;
- puts the exact capture time inside the file (JPEG Exif DateTimeOriginal, or the MP4 movie, track and media dates; the format is decided by the file’s first bytes, never its extension) and sets the file’s own modification time to it;
- names it `YYYY-MM-DD_HHMMSS_<type>_<number>.<ext>` (UTC) in a month folder, and writes the caption or sticker overlay of that Memory next to it as `...-overlay.png`, byte for byte;
- never reads or writes a location. In a JPEG, everything else in the original Exif, including GPS, is dropped.

Files already in the output folder are skipped, so an interrupted run can be repeated. Memories with no file in the export are counted, with advice on getting them. `memories-report.json` in the output folder holds counts and statuses only: no names, paths, dates, places, or links. A file over 512 MiB is not read into memory and is reported as `too-large`.

The folder `apps/cli/test/verify-memories-output.ts` has an independent checker (it shares no code with Snappy’s core) that compares a rescue folder with its ZIP files: `node --experimental-strip-types apps/cli/test/verify-memories-output.ts <folder> <ZIP files...>`.

## Where things are stored

```
~/.snappy/ledger.sealed   past friend lists and your keep list, sealed with your passphrase
```

One file holds everything. It uses core’s format (PBKDF2 to AES-256-GCM) and is written atomically: a temp file in the same folder, then a rename, with owner-only permissions where the OS supports them. The keep list and the guided-removal checkmarks ride inside it. The dashboard and the command line use the same format but separate stores: the dashboard keeps its saved history in the browser’s or the app’s storage, and the command line keeps its own in this file, so neither one sees the other’s. Pass `--history <path>` to use another location (`--ledger` still works).

An older command line kept the keep list in a second file, `ledger.allowlist.sealed`. If your saved history does not carry the keep list yet, Snappy reads that file once, saves the list in the saved history the next time something is saved, and then ignores it. It never deletes or rewrites the older file. A Snappy build from before this change reads the new file as having two extra exports, so keep using the newer build on a saved history the newer build has written.

The passphrase comes from `--passphrase-file <path>`, then the `SNAPPY_PASSPHRASE` environment variable, then a hidden prompt (asked twice when the saved history is new). It is never accepted as an argument and never written anywhere. `analyze --no-save` neither reads nor writes the saved history and asks for nothing.

## Running the commands in the dashboard

The dashboard runs these same commands in the page: each command it shows has Copy and Run buttons, and Run starts a Web Worker with a virtual file system (`/in` for the files you pick, `/out` for saved files, `/tmp`, and `/app` for the saved history). There is no server, no child process and no network. `memories --download` and `--concurrency` are refused there, and a command that writes asks first.

To make that possible the commands do not import Node. Everything they touch comes through the `Io` object: `io.fs`, `io.path` and `io.lock` (types in `src/ports.ts`), a random id, a size limit and a stop signal. `src/cli.ts` is the portable entry (`runCli(argv, io, { version })`); `src/main.ts`, `src/node-io.ts` and `src/node-ports.ts` are the Node side. A test walks the imports from `cli.ts` and fails if any of them reaches for `node:`.

## Terminal output

Color is off for `NO_COLOR`, `--no-color`, `TERM=dumb` and output that is not a terminal. `SNAPPY_ASCII=1` swaps the block characters for plain ones. `--verbose` adds a short code to errors and notes, for bug reports. `SNAPPY_DEBUG=1` also adds code locations to an unexpected error (never its message).

## Tests

```
npx vitest run apps/cli
```

Tests drive each command as a function with injected streams, over synthetic exports in a temp folder. They include a canary test (no seeded message text, display name, group title, location, caption, link, or ZIP entry name reaches any output, CSV, JSON, report, file name, or decrypted saved history), an end-to-end Memories rescue of a three-part synthetic export checked by the independent script above, and a source scan (only `memories-download.ts` may use the network).
