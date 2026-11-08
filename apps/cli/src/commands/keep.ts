/**
 * snappy-export keep / unkeep: manage the sealed allowlist, the friends who never appear in the
 * cleanup queue. Output is counts only; usernames the user typed are not echoed back. The one
 * exception is `keep --list`, which prints the list because the person asked to see it.
 */
import { MAX_USERNAME_LENGTH, normUser } from "@snappy-export/core";
import type { Ledger } from "@snappy-export/core";
import { parseFlags } from "../args.ts";
import type { OptionSpec } from "../args.ts";
import { CliError } from "../errors.ts";
import type { Io } from "../io.ts";
import { defaultLedgerPath, HISTORY_PATH_OPTIONS, historyPathFlag, isFreshStore, loadStore, normalizeAllowlist, saveStore, withLedgerLock } from "../ledger-store.ts";
import { resolvePassphrase } from "../prompt.ts";
import { PRIVACY_RESULTS } from "../render.ts";
import { isAre, noun, plural } from "../format.ts";

export const KEEP_USAGE = `Usage: snappy-export keep <username...> [options]
       snappy-export keep --list [options]
       snappy-export unkeep <username...> [options]

keep adds friends to your keep list, so they never appear in the cleanup queue.
unkeep takes them off. The keep list is saved inside your saved history.
keep --list shows how many names are on the list, and the names.

Options
  --list                    Show your keep list. Add no names.
  --history <path>          Saved history file. Default: ~/.snappy/ledger.sealed
  --passphrase-file <path>  Use the first line of this file as the passphrase.
  --no-color                Plain text. The output has no color to turn off.

The passphrase comes from --passphrase-file, then SNAPPY_PASSPHRASE, then a hidden prompt.
`;

/** The options this command accepts, shared with the in-app command catalog's checks. */
export const KEEP_OPTIONS: OptionSpec = {
  ...HISTORY_PATH_OPTIONS,
  list: { type: "boolean" },
  "passphrase-file": { type: "string" },
  "no-color": { type: "boolean" },
  help: { type: "boolean", short: "h" },
};

interface Flags {
  history?: string;
  ledger?: string;
  list?: boolean;
  "passphrase-file"?: string;
  "no-color"?: boolean;
  help?: boolean;
}

/** Every username the saved history has seen, as a friend or as a request you sent. */
function namesInHistory(ledger: Ledger): Set<string> {
  return new Set(ledger.snapshots.flatMap((s) => [...s.friends, ...s.sentRequests]));
}

/** keep --list: how many names are on the keep list, then the names. It opens nothing when no history exists yet. */
async function listKeepList(mode: "keep" | "unkeep", positionals: string[], flags: Flags, io: Io): Promise<number> {
  if (mode === "unkeep") throw new CliError("usage", "To see your keep list, run: snappy-export keep --list");
  if (positionals.length > 0) throw new CliError("usage", "--list shows your keep list and takes no names. To add names, leave out --list.");
  const ledgerPath = historyPathFlag(flags) ?? defaultLedgerPath(io);
  if (await isFreshStore(io, ledgerPath)) {
    io.out.write("Your keep list is empty. Use snappy-export keep to add friends.\n");
    io.out.write(`${PRIVACY_RESULTS}\n`);
    return 0;
  }
  const passphrase = await resolvePassphrase(io, { file: flags["passphrase-file"], creating: false });
  const { allowlist } = await loadStore(io, ledgerPath, passphrase);
  const lines =
    allowlist.length === 0
      ? ["Your keep list is empty. Use snappy-export keep to add friends."]
      : [`${plural(allowlist.length, "name")} on your keep list.`, "", ...allowlist.map((n) => `  ${n}`)];
  io.out.write(`${lines.join("\n")}\n\n`);
  io.out.write(`${PRIVACY_RESULTS}\n`);
  return 0;
}

export async function keepCommand(mode: "keep" | "unkeep", args: string[], io: Io): Promise<number> {
  const { values: flags, positionals } = parseFlags<Flags>(mode, args, KEEP_OPTIONS);
  if (flags.help) {
    io.out.write(KEEP_USAGE);
    return 0;
  }
  if (flags.list === true) return listKeepList(mode, positionals, flags, io);
  const names = [...new Set(positionals.map(normUser).filter((n) => n !== ""))];
  if (names.length === 0) {
    throw new CliError("usage", `Name at least one friend, like: snappy-export ${mode} sam_01 alex.k`);
  }
  if (names.some((n) => /\s/.test(n) || n.length > MAX_USERNAME_LENGTH)) {
    throw new CliError("usage", "Usernames have no spaces. Check the names and try again.");
  }

  const ledgerPath = historyPathFlag(flags) ?? defaultLedgerPath(io);
  const passphrase = await resolvePassphrase(io, { file: flags["passphrase-file"], creating: await isFreshStore(io, ledgerPath) });
  // Unlock, change and save under one lock, so a second `keep` running at the same time is not lost.
  const { current, changed, known } = await withLedgerLock(io, ledgerPath, async () => {
    const store = await loadStore(io, ledgerPath, passphrase);
    const current = new Set(store.allowlist);
    const changed = names.filter((n) => (mode === "keep" ? !current.has(n) : current.has(n)));
    for (const n of changed) {
      if (mode === "keep") current.add(n);
      else current.delete(n);
    }
    // Only the keep list changes: the snapshots and the checkmarks are saved as they were.
    if (changed.length > 0) await saveStore(io, ledgerPath, { ...store, allowlist: normalizeAllowlist([...current]) }, passphrase);
    return { current, changed, known: namesInHistory(store.ledger) };
  });

  // Snappy never reads an export here, so it can only call a name a friend when the saved history has it.
  const unmatched = changed.filter((n) => !known.has(n)).length;
  const word = unmatched === 0 && changed.length > 0 ? "friend" : "name";
  const total = current.size;
  const skipped = names.length - changed.length;
  if (mode === "keep") {
    io.out.write(`${plural(changed.length, word)} added to your keep list${skipped > 0 ? ` (${skipped} already there)` : ""}. ${plural(total, unmatched === 0 ? "friend" : "name")} in total.\n`);
    if (unmatched > 0) io.out.write(`${plural(unmatched, "name")} ${isAre(unmatched)} not in your saved history, so ${noun(unmatched, "it", "they")} may not match anyone yet. Check the spelling.\n`);
    io.out.write("They will not appear in the cleanup queue. Keep list saved with your passphrase.\n");
  } else {
    io.out.write(`${plural(changed.length, word)} taken off your keep list${skipped > 0 ? ` (${skipped} not on it)` : ""}. ${plural(total, "friend")} left.\n`);
  }
  io.out.write(`${PRIVACY_RESULTS}\n`);
  return 0;
}
