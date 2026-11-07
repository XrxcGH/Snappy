/**
 * snappy-export keep / unkeep: manage the sealed allowlist, the friends who never appear in the
 * cleanup queue. Output is counts only; usernames the user typed are not echoed back.
 */
import { MAX_USERNAME_LENGTH, normUser } from "@snappy-export/core";
import { parseFlags } from "../args.ts";
import type { OptionSpec } from "../args.ts";
import { CliError } from "../errors.ts";
import type { Io } from "../io.ts";
import { defaultLedgerPath, isFreshStore, loadStore, normalizeAllowlist, saveStore, withLedgerLock } from "../ledger-store.ts";
import { resolvePassphrase } from "../prompt.ts";
import { PRIVACY_RESULTS } from "../render.ts";
import { plural } from "../format.ts";

export const KEEP_USAGE = `Usage: snappy-export keep <username...> [options]
       snappy-export unkeep <username...> [options]

keep adds friends to your keep list, so they never appear in the cleanup queue.
unkeep takes them off. The keep list is saved inside your sealed ledger file.

Options
  --ledger <path>           Sealed ledger file. Default: ~/.snappy/ledger.sealed
  --passphrase-file <path>  Use the first line of this file as the passphrase.

The passphrase comes from --passphrase-file, then SNAPPY_PASSPHRASE, then a hidden prompt.
`;

/** The options this command accepts, shared with the in-app command catalog's checks. */
export const KEEP_OPTIONS: OptionSpec = {
  ledger: { type: "string" },
  "passphrase-file": { type: "string" },
  help: { type: "boolean", short: "h" },
};

interface Flags {
  ledger?: string;
  "passphrase-file"?: string;
  help?: boolean;
}

export async function keepCommand(mode: "keep" | "unkeep", args: string[], io: Io): Promise<number> {
  const { values: flags, positionals } = parseFlags<Flags>(mode, args, KEEP_OPTIONS);
  if (flags.help) {
    io.out.write(KEEP_USAGE);
    return 0;
  }
  const names = [...new Set(positionals.map(normUser).filter((n) => n !== ""))];
  if (names.length === 0) {
    throw new CliError("usage", `Name at least one friend, like: snappy-export ${mode} sam_01 alex.k`);
  }
  if (names.some((n) => /\s/.test(n) || n.length > MAX_USERNAME_LENGTH)) {
    throw new CliError("usage", "Usernames have no spaces. Check the names and try again.");
  }

  const ledgerPath = flags.ledger ?? defaultLedgerPath(io);
  const passphrase = await resolvePassphrase(io, { file: flags["passphrase-file"], creating: await isFreshStore(io, ledgerPath) });
  // Unlock, change and save under one lock, so a second `keep` running at the same time is not lost.
  const { current, changed } = await withLedgerLock(io, ledgerPath, async () => {
    const store = await loadStore(io, ledgerPath, passphrase);
    const current = new Set(store.allowlist);
    const changed = names.filter((n) => (mode === "keep" ? !current.has(n) : current.has(n)));
    for (const n of changed) {
      if (mode === "keep") current.add(n);
      else current.delete(n);
    }
    // Only the keep list changes: the snapshots and the checkmarks are saved as they were.
    if (changed.length > 0) await saveStore(io, ledgerPath, { ...store, allowlist: normalizeAllowlist([...current]) }, passphrase);
    return { current, changed };
  });

  const total = current.size;
  const skipped = names.length - changed.length;
  if (mode === "keep") {
    io.out.write(`${plural(changed.length, "friend")} added to your keep list${skipped > 0 ? ` (${skipped} already there)` : ""}. ${plural(total, "friend")} in total.\n`);
    io.out.write("They will not appear in the cleanup queue. Keep list sealed with your passphrase.\n");
  } else {
    io.out.write(`${plural(changed.length, "friend")} taken off your keep list${skipped > 0 ? ` (${skipped} not on it)` : ""}. ${plural(total, "friend")} left.\n`);
  }
  io.out.write(`${PRIVACY_RESULTS}\n`);
  return 0;
}
