/**
 * snappy-export history status: which exports are in your saved history. Dates and friend counts
 * only; usernames are never printed. `ledger status` is the older name and still works; it is left
 * out of the help.
 */
import { parseFlags } from "../args.ts";
import type { OptionSpec } from "../args.ts";
import { CliError } from "../errors.ts";
import { formatDate, plural } from "../format.ts";
import type { Io } from "../io.ts";
import { defaultLedgerPath, HISTORY_PATH_OPTIONS, historyPathFlag, isFreshStore, loadStore } from "../ledger-store.ts";
import { resolvePassphrase } from "../prompt.ts";
import { PRIVACY_RESULTS } from "../render.ts";
import { createTerm } from "../term.ts";

export const HISTORY_USAGE = `Usage: snappy-export history status [options]

Shows which exports are in your saved history: dates and friend counts, never usernames.

Options
  --history <path>          Saved history file. Default: ~/.snappy/ledger.sealed
  --passphrase-file <path>  Use the first line of this file as the passphrase.
  --no-color                Plain text.

The passphrase comes from --passphrase-file, then SNAPPY_PASSPHRASE, then a hidden prompt.
`;

/** The options this command accepts, shared with the in-app command catalog's checks. */
export const HISTORY_OPTIONS: OptionSpec = {
  ...HISTORY_PATH_OPTIONS,
  "passphrase-file": { type: "string" },
  "no-color": { type: "boolean" },
  help: { type: "boolean", short: "h" },
};

interface Flags {
  history?: string;
  ledger?: string;
  "passphrase-file"?: string;
  "no-color"?: boolean;
  help?: boolean;
}

export async function historyCommand(args: string[], io: Io): Promise<number> {
  const { values: flags, positionals } = parseFlags<Flags>("history", args, HISTORY_OPTIONS);
  if (flags.help || (positionals.length === 0 && args.length === 0)) {
    io.out.write(HISTORY_USAGE);
    return 0;
  }
  if (positionals[0] !== "status" || positionals.length > 1) {
    throw new CliError("usage", 'The only history command is "snappy-export history status".');
  }

  const term = createTerm({ env: io.env, isTTY: io.interactive, columns: io.columns, noColorFlag: flags["no-color"] });
  const ledgerPath = historyPathFlag(flags) ?? defaultLedgerPath(io);
  if (await isFreshStore(io, ledgerPath)) {
    io.out.write("No saved history yet. Run snappy-export analyze on your export to start one.\n");
    return 0;
  }

  const passphrase = await resolvePassphrase(io, { file: flags["passphrase-file"], creating: false });
  // Real snapshots only: the keep list and the checkmarks are kept apart from them.
  const { ledger, allowlist } = await loadStore(io, ledgerPath, passphrase);

  // Inside the app the file is in a virtual folder that exists only in the helper, so its path would mean nothing.
  const lines: string[] = [term.bold("Saved history"), ...(io.env.SNAPPY_APP === "1" ? [] : [`  File: ${ledgerPath}`])];
  if (ledger.snapshots.length === 0) {
    lines.push("  No exports saved yet.");
  } else {
    lines.push(`  ${plural(ledger.snapshots.length, "export")} in your history.`, "");
    lines.push(
      ...term
        .table(
          [{ header: "Export from" }, { header: "Friends", align: "right" }, { header: "Requests sent", align: "right" }],
          ledger.snapshots.map((s) => [formatDate(s.takenAt), String(s.friends.length), String(s.sentRequests.length)]),
        )
        .map((l) => `  ${l}`),
    );
  }
  lines.push("", term.bold("Keep list"));
  lines.push(
    allowlist.length === 0 ? "  Empty. Use snappy-export keep to add friends." : `  ${plural(allowlist.length, "friend")} on your keep list.`,
  );
  lines.push("", PRIVACY_RESULTS);
  io.out.write(lines.join("\n") + "\n");
  return 0;
}
