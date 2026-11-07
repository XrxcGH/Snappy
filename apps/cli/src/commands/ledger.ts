/**
 * snappy-export ledger status: which exports are on record. Snapshot dates and friend counts only;
 * usernames are never printed.
 */
import { parseFlags } from "../args.ts";
import type { OptionSpec } from "../args.ts";
import { CliError } from "../errors.ts";
import { formatDate, plural } from "../format.ts";
import type { Io } from "../io.ts";
import { defaultLedgerPath, isFreshStore, loadStore } from "../ledger-store.ts";
import { resolvePassphrase } from "../prompt.ts";
import { PRIVACY_RESULTS } from "../render.ts";
import { createTerm } from "../term.ts";

export const LEDGER_USAGE = `Usage: snappy-export ledger status [options]

Shows which exports are in your sealed ledger: dates and friend counts, never usernames.

Options
  --ledger <path>           Sealed ledger file. Default: ~/.snappy/ledger.sealed
  --passphrase-file <path>  Use the first line of this file as the passphrase.
  --no-color                Plain text.

The passphrase comes from --passphrase-file, then SNAPPY_PASSPHRASE, then a hidden prompt.
`;

/** The options this command accepts, shared with the in-app command catalog's checks. */
export const LEDGER_OPTIONS: OptionSpec = {
  ledger: { type: "string" },
  "passphrase-file": { type: "string" },
  "no-color": { type: "boolean" },
  help: { type: "boolean", short: "h" },
};

interface Flags {
  ledger?: string;
  "passphrase-file"?: string;
  "no-color"?: boolean;
  help?: boolean;
}

export async function ledgerCommand(args: string[], io: Io): Promise<number> {
  const { values: flags, positionals } = parseFlags<Flags>("ledger", args, LEDGER_OPTIONS);
  if (flags.help || (positionals.length === 0 && args.length === 0)) {
    io.out.write(LEDGER_USAGE);
    return 0;
  }
  if (positionals[0] !== "status" || positionals.length > 1) {
    throw new CliError("usage", 'The only ledger command is "snappy-export ledger status".');
  }

  const term = createTerm({ env: io.env, isTTY: io.interactive, columns: io.columns, noColorFlag: flags["no-color"] });
  const ledgerPath = flags.ledger ?? defaultLedgerPath(io);
  if (await isFreshStore(io, ledgerPath)) {
    io.out.write("No ledger yet. Run snappy-export analyze on your export to start one.\n");
    return 0;
  }

  const passphrase = await resolvePassphrase(io, { file: flags["passphrase-file"], creating: false });
  // Real snapshots only: the keep list and the checkmarks are kept apart from them.
  const { ledger, allowlist } = await loadStore(io, ledgerPath, passphrase);

  const lines: string[] = [term.bold("Ledger"), `  File: ${ledgerPath}`];
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
