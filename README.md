# Snappy

Snappy helps you tidy your Snapchat friends list and rescue your Memories, using only the data export Snapchat gives you.

- **Cleanup queue.** Finds disappeared friends (people who may have removed you), unaccepted requests, and quiet friends, each with a confidence level and the evidence behind it. Saved chats and Snaps both count as activity, so a friend you only Snap with is not called quiet.
- **Memories rescue.** Plans a local backup of your Memories, shows a storage meter against a 5 GB cap that you can change, and restores each file’s exact capture time. In a newer export the files are inside the ZIP files, and Snappy pairs each one with its list entry by that exact time.
- **Tools.** Fourteen small helpers on the dashboard’s Tools page, such as an export check, a Memories storage planner, a friends backup and a list of people waiting on a reply. Each reads metadata only and shows the matching command with Copy and Run.
- **Two ways to use it.** A dashboard you open in your browser, and a command line tool named `snappy-export`.

Snappy only infers. A result means “may have removed you”, never “did”. Removing a friend is always your call, and you do it in Snapchat yourself.

## Privacy model

1. Snappy is content-blind. It never views messages, photos, videos, or locations.
2. The only personal value it handles is a friend’s username, shown in a monospace font.
3. Everything runs on this device. The dashboard is one HTML file with a policy that blocks all network access.
4. There is no account, no telemetry, and no analytics.
5. The one network feature is `snappy-export memories --download`. It is off by default, it prints a notice, and it contacts only the links inside your own export. Newer exports have no links, so for them it has nothing to download and Snappy does not touch the network.
6. Your history is stored only if you choose, sealed with your passphrase (PBKDF2 and AES-256-GCM). Snappy never stores the passphrase.
7. Output never echoes message text, display names, group titles, locations, or download links.
8. Tests seed every one of those values into a synthetic export and fail if any of them reaches an output.

## Quick start

You need Node 22.18 or later (Node 24 works). Then, from this folder:

```
npm install
```

### 1. Get your export

Request your data in Snapchat under Settings, then My Data. Select JSON files and User information, and choose All Time as the date range. The full steps are in [docs/EXPORT-GUIDE.md](docs/EXPORT-GUIDE.md).

### 2. Use the dashboard

```
npm run build:dashboard
```

This writes `apps/dashboard/dist/index.html`. Double-click it to open it in your browser, or serve it on `127.0.0.1` with:

```
npm run serve -w @snappy-export/dashboard
```

Choose “Use sample data” to look around with made-up friends before you add your own export. The Tools page lists the helpers: each opens its own page, says what it reads, and runs on the export already on the page. The safety and privacy checklists hold your own marks: saved with your history if you turned saving on, and kept for this session only otherwise.

### 3. Use the command line

```
npm run snappy-export -- help
npm run snappy-export -- demo --run
```

| Command | What it does |
|---|---|
| `snappy-export analyze <ZIP files or folder...>` | Reads the export, updates your sealed ledger, and prints the cleanup queue. |
| `snappy-export memories <ZIP files or folder...> --out <folder>` | Copies bundled Memories with their capture date restored. Add `--dry-run` to preview, or `--download` for link-only items. |
| `snappy-export inspect <ZIP files or folder...>` | Prints the structure of the JSON files (field names and types), never a value. Photos, videos, and web pages are only counted. Options: `--show-keys`, `--layout`, `--memory-links`, `--mtime-check`, and `--checks-only`. |
| `snappy-export keep <username...>` and `snappy-export unkeep <username...>` | Protects friends from the cleanup queue. |
| `snappy-export ledger status` | Lists the exports in your history: dates and friend counts, never usernames. |
| `snappy-export demo` | Writes two invented exports and prints commands to try them. |

Fourteen more commands (`check`, `storage`, `backup`, `closest`, `remind`, and others) are listed in [apps/cli/README.md](apps/cli/README.md#more-commands). Run `snappy-export help` to see them all.

Examples:

```
npm run snappy-export -- analyze later.zip --earlier earlier.zip --no-save
npm run snappy-export -- analyze later.zip --json
npm run snappy-export -- memories mydata~1234567890123.zip mydata~1234567890123-2.zip --out rescued-memories --dry-run
npm run snappy-export -- memories mydata~1234567890123.zip --out rescued-memories --layout year-month
```

Several ZIP files, a folder of ZIP files, or a wildcard such as `"mydata*.zip"` are the parts of one export. Snappy puts them in the order Snapchat numbers them (the name without a number, then `-2`, then `-3`), whatever order you type them in. Without `--no-save`, `analyze` keeps one sealed file (your saved history of past exports, with your keep list inside) in `~/.snappy/` so each new export is compared with the earlier ones. Disappeared friends need at least two exports. The passphrase comes from `--passphrase-file`, then `SNAPPY_PASSPHRASE`, then a hidden prompt.

Exit codes: 0 done, 1 could not run, 2 the export has errors, 3 Memories finished with some failed items. More detail is in [apps/cli/README.md](apps/cli/README.md).

### What it reads, and how much

- **Chats and Snaps.** Snappy reads `chat_history.json` and `snap_history.json` as who, when, direction and type. Both are streamed from the ZIP file in small pieces, so there is no practical limit on how many conversations or messages you have, and message text is never decoded. The friends list and the Memories list are streamed the same way: only the fields Snappy uses are decoded, so display names and locations are skipped as bytes. Every entry is checked against the checksum the ZIP file stores, so a damaged download fails loudly instead of passing as good data.
- **Memories pairing.** For each Memory, Snappy looks for the file stored with exactly that capture time (to the second). It reports counts and the method, such as “200 of 300 Memories are matched to a file in your ZIP files by exact capture time”, and counts the ones with no file instead of guessing.
- **Large exports.** The dashboard reads big files in a background worker started from a `blob:` URL that the page makes itself, so the tab stays responsive. The page still cannot reach the network.
- **The inspect command.** It shows the shape of your export so you can share it safely. The extra checks (`--layout`, `--memory-links`, `--mtime-check`) print counts and masked patterns, never a name or a value. The steps are in [docs/EXPORT-GUIDE.md](docs/EXPORT-GUIDE.md).

Snapchat has not published the exact layout of its export, so Snappy reads it tolerantly and reports anything unexpected. Both the dashboard and the CLI show those notes before any result.

## Repository layout

```
packages/core     Parsing, ledger, detectors, cleanup queue, Memories planning,
                  metadata writers, sealing, and synthetic test data (@snappy-export/core)
apps/cli          The snappy command
apps/dashboard    The browser dashboard (builds to one HTML file)
apps/app          The desktop app: the dashboard in a native window (Tauri)
brand             Logo, color and type tokens, icons
docs              Brand guide, export guide and the releases guide
```

## Run the tests

```
npx vitest run
npx tsc --noEmit -p tsconfig.json
```

All tests use synthetic data. Nothing in this repository needs, opens, or reads a real Snapchat export, and you should not add one.

## Brand

Colors, type, icons, and voice are defined in [docs/BRAND.md](docs/BRAND.md). The tokens in `brand/tokens/tokens.css` are the source of truth.

## Not affiliated

Snappy is an independent tool. It is not affiliated with, endorsed by, or sponsored by Snap Inc. Snapchat is a trademark of Snap Inc.

## License

Snappy is open source under the [Apache License 2.0](LICENSE). Third-party components and fonts are listed in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md), and [NOTICE](NOTICE) carries the copyright line. To contribute, read [CONTRIBUTING.md](CONTRIBUTING.md); to report a security problem, read [SECURITY.md](SECURITY.md). Names and logos are covered in [TRADEMARKS.md](TRADEMARKS.md).

## About the name

The product is called **Snappy**. The word is already used by other software, including Google’s Snappy compression library, so the published package and command line tool use the more specific name `snappy-export`.