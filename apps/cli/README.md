# Snappy command line

Offline tools for your own Snapchat data export. Snappy is content-blind: it reads friend usernames, dates, and categories, and skips messages, photos, and locations. Nothing leaves this device. The one network feature is `memories --download`, which you opt into and which contacts only the links inside your own export. Newer exports have no links (their Memories are inside the ZIP files), so for them it has nothing to download and Snappy says so.

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
| `snappy-export analyze <ZIP files or folder...>` | Reads the export, updates your sealed ledger (your saved history of past exports), and prints the cleanup queue: disappeared friends, unaccepted requests, and quiet friends. Saved chats and Snaps both count as recent activity. It also summarizes how the Memories list matches the files in the ZIP files (counts only). |
| `snappy-export memories <ZIP files or folder...> --out <folder>` | Plans the Memories rescue, shows the storage meter, and copies the files bundled in the export with their exact capture time restored. `--download` is for older exports that have links. |
| `snappy-export inspect <ZIP files or folder...>` | Prints the structure of the export (field names, types, bucketed counts), never a value. |
| `snappy-export keep <username...>` / `snappy-export unkeep <username...>` | Manages the sealed keep list: friends who never appear in the cleanup queue. |
| `snappy-export ledger status` | Lists the exports in your ledger: dates and friend counts, never usernames. |
| `snappy-export demo [--run]` | Writes two invented exports and prints the commands to try them. |

Several ZIP files, a folder of ZIP files, or a wildcard such as `"mydata*.zip"` are the parts of one export. Snappy puts them in the order Snapchat numbers them (the name without a number, then `-2`, then `-3`), whatever order you type them in. To compare two exports, give the older one with `--earlier`, or let the ledger remember it between runs.

Exit codes: 0 done, 1 could not run, 2 the export has errors (analyze, inspect), 3 Memories finished with some failed items.

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
~/.snappy/ledger.sealed             past friend lists, sealed with your passphrase
~/.snappy/ledger.allowlist.sealed   {"allowlist": ["username", ...]}, sealed the same way
```

Both files use core’s format (PBKDF2 to AES-256-GCM) and are written atomically: a temp file in the same folder, then a rename, with owner-only permissions where the OS supports them. The keep list has its own file so that `keep` never rewrites your saved history. Pass `--ledger <path>` to use another location; the keep list file sits next to it.

The passphrase comes from `--passphrase-file <path>`, then the `SNAPPY_PASSPHRASE` environment variable, then a hidden prompt (asked twice when the ledger is new). It is never accepted as an argument and never written anywhere. `analyze --no-save` neither reads nor writes the ledger and asks for nothing.

## Terminal output

Color is off for `NO_COLOR`, `--no-color`, `TERM=dumb` and output that is not a terminal. `SNAPPY_ASCII=1` swaps the block characters for plain ones. `--verbose` adds a short code to errors and notes, for bug reports. `SNAPPY_DEBUG=1` also adds code locations to an unexpected error (never its message).

## Tests

```
npx vitest run apps/cli
```

Tests drive each command as a function with injected streams, over synthetic exports in a temp folder. They include a canary test (no seeded message text, display name, group title, location, caption, link, or ZIP entry name reaches any output, CSV, JSON, report, file name, or decrypted ledger), an end-to-end Memories rescue of a three-part synthetic export checked by the independent script above, and a source scan (only `memories-download.ts` may use the network).
