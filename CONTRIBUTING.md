# Contributing to Snappy

Thank you for helping. Snappy is a small, careful tool, and a few rules keep it that way. They matter more than usual because it works with people's private data.

## The privacy rules (read these first)

Snappy is **content-blind**. The full contract is at the top of `packages/core/src/types.ts`. In short:

1. It never reads message text, media, locations, display names or other personal details. Parsers keep only a short allowlist of fields and drop everything else at the parse boundary.
2. The only person-identifying value it keeps is a friend's username. Group titles become opaque hashes.
3. Nothing leaves the device. No telemetry, no analytics, no network calls in the core library. The one exception is the optional, off-by-default Memories download in the command-line tool.
4. Errors, warnings and reports never echo usernames, text, links or file names. Describe things by field name or count. Keep each issue’s code stable: it is part of the API, and people see it only with `--verbose`.
5. Saved history is sealed with a passphrase.

**Never use real data.** All tests and examples use synthetic exports made by the built-in generators. Do not attach or paste a real Snapchat export, or any piece of one, to an issue or pull request. If you need to show a file's layout, use the structure-only `inspect` command and read its output before sharing.

## Setting up

You need Node.js 22.18 or newer.

```bash
npm install
npm test            # unit and integration tests
npx tsc --noEmit -p tsconfig.json   # type check
npm run build:dashboard             # builds apps/dashboard/dist/index.html
```

The layout:

- `packages/core`: parsing, analysis and planning. Pure functions only: no file access, no network, no logging, no clock (time comes in as a parameter).
- `apps/cli`: the command-line tool.
- `apps/dashboard`: the offline dashboard, built into one file.
- `brand/` and `docs/BRAND.md`: logo, tokens and the writing rules.
- `docs/`: the brand guide and the export guide.

## The command runner

The dashboard runs the command line's commands inside the page: every command shown in the app has a Copy button and a Run button. Run starts a Web Worker (a helper), gives the command a virtual file system and no network, and draws the output in a panel. A few rules keep that safe and keep the two tools alike.

- **Ports, not Node.** Nothing the commands import may reach for `node:` modules, `process` or `Buffer`. Files, paths and the saved-history lock come through `io.fs`, `io.path` and `io.lock` (`apps/cli/src/ports.ts`). `node-ports.ts`, `node-io.ts` and `main.ts` are the only Node files. `apps/cli/test/portable.test.ts` walks the imports from `cli.ts` and fails on a slip. The one exception is `memories-download.ts`, which the dashboard build replaces with a stub that can only refuse.
- **No network in the app.** `--download` and `--concurrency` are refused, in the page and again in the helper (`apps/dashboard/src/terminal/policy.ts`). The page's security policy keeps `connect-src 'none'`.
- **One command catalog.** Every command the app shows is an entry in `apps/dashboard/src/terminal/commands.ts`: its words are written in code, never parsed from text. A new command needs an entry, a title in `copy.ts`, and a line in the catalog test that checks its flags against the command line's own option table.
- **Every command is a command block.** Use `commandBlock` from `components/commandBlock.ts`; never write a `<pre>` with a command by hand. `command-blocks.test.ts` renders every page and fails when a command has no Copy and Run, or is not in the catalog.
- **Same output both ways.** `terminal-parity.test.ts` runs the commands through the helper and through the command line on the same synthetic export and requires the same text and exit codes. Extend it when you add a command.
- **Passphrases.** A passphrase is asked in a masked field outside the output, passed to the command once, and never echoed, logged or stored. The tests run a distinctive canary phrase through the whole path.
- **Output is text.** Command output is drawn with `h()` as text in spans with classes from a closed list (`terminal/ansi.ts`). Never use `innerHTML`, never set a style attribute: the page's policy forbids both.
- **Lock and Delete data clear the commands too.** The command blocks live outside the dashboard's store. `createActions` takes `onWipe`, which `main.ts` points at `session.reset()`: it stops a Run, empties every transcript and saved file, and drops the picked export files. A new place that holds results on the page needs to be cleared there.
- **Stop is a stop.** A command that reads the export calls `throwIfStopped(io)` (`apps/cli/src/inputs.ts`) after each load step, because cut-off reads look like damaged files to the parser. `worker.test.ts` stops a read part way and fails on any false diagnosis.
- **Saved history is one file.** The dashboard and the command line read and write the same sealed file (`packages/core/src/ledger/saved.ts`). Change that format in core, and both follow.

## Making a change

- Add tests for what you add. Privacy tests use "canary" strings that must never appear in any output; extend them when you add an output.
- Keep the code readable, with short comments that explain why, not what. No dead code and no TODO stubs.
- TypeScript, strict mode, explicit `.ts` import extensions, no new runtime dependencies in the core library.
- Words matter. Use sentence case and American English. Describe inferences with hedged language (“may have removed you”), never as facts. Use the feature names in `docs/BRAND.md`, such as “Unaccepted requests”. Orange is a secondary color only; violet stays the main one.
- Never build anything that logs in to Snapchat, automates its app, or sends messages. Snappy works on exports only.

## Proposing a feature

Open an issue first. A good proposal says which everyday Snapchat annoyance it addresses, exactly which export fields it needs, what it can and cannot tell the user, and how it fits the privacy rules above. Features that need an account login, automation of the app, or message content are out of scope.

## Licensing

Snappy is licensed under the Apache License 2.0 (see `LICENSE`). By submitting a contribution you agree that it is provided under that license, as described in section 5 of the license. Do not submit code you do not have the right to contribute, and keep third-party license notices intact. See `TRADEMARKS.md` for how names and logos may be used.
