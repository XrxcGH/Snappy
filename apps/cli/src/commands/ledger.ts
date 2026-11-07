/**
 * snappy-export ledger status: which exports are on record. Snapshot dates and friend counts only;
 * usernames are never printed.
 */
import { parseFlags } from "../args.ts";
import { CliError } from "../errors.ts";
import { formatDate, plural } from "../format.ts";
import type { Io } from "../io.ts";
import { allowlistPathFor, defaultLedgerPath, isFreshStore, loadAllowlist, loadLedger } from "../ledger-store.ts";
import { resolvePassphrase } from "../prompt.ts";
import { PRIVACY_RESULTS } from "../render.ts";
import { createTerm } from "../term.ts";

export const LEDGER_USAGE = `Usage: snappy-export ledger status [options]

Shows which exports are in your sealed ledger: dates and friend counts, never usernames.

Options
  --ledger <path>           Sealed ledger file. Default: ~/.snappy/ledger.sealed
  --passphrase-file <path>  Read the passphrase from the first line of this file.
                            Otherwise SNAPPY_PASSPHRASE, otherwise a hidden prompt.
  --no-color                Plain text.
`;

interface Flags {
  ledger?: string;
  "passphrase-file"?: string;
  "no-color"?: boolean;
  help?: boolean;
}

export async function ledgerCommand(args: string[], io: Io): Promise<number> {
  const { values: flags, positionals } = parseFlags<Flags>("ledger", args, {
    ledger: { type: "string" },
    "passphrase-file": { type: "string" },
    "no-color": { type: "boolean" },
    help: { type: "boolean", short: "h" },
  });
  if (flags.help || (positionals.length === 0 && args.length === 0)) {
    io.out.write(LEDGER_USAGE);
    return 0;
  }
  if (positionals[0] !== "status" || positionals.length > 1) {
    throw new CliError("usage", 'Snappy knows one ledger command: "snappy-export ledger status".');
  }

  const term = createTerm({ env: io.env, isTTY: io.interactive, columns: io.columns, noColorFlag: flags["no-color"] });
  const ledgerPath = flags.ledger ?? defaultLedgerPath(io.homedir());
  if (await isFreshStore(ledgerPath)) {
    io.out.write("No ledger yet. Run snappy-export analyze on your export to start one.\n");
    return 0;
  }

  const passphrase = await resolvePassphrase(io, { file: flags["passphrase-file"], creating: false });
  const ledger = await loadLedger(ledgerPath, passphrase);
  const allowlist = await loadAllowlist(ledgerPath, passphrase);

  const lines: string[] = [term.bold("Ledger"), `  File: ${ledgerPath}`];
  if (ledger === undefined) {
    lines.push("  No exports saved yet.");
  } else {
    lines.push(`  ${plural(ledger.snapshots.length, "export")} on record.`, "");
    lines.push(
      ...term
        .table(
          [{ header: "Export from" }, { header: "Friends", align: "right" }, { header: "Requests sent", align: "right" }, { header: "Source" }],
          ledger.snapshots.map((s) => [formatDate(s.takenAt), String(s.friends.length), String(s.sentRequests.length), s.source === "export" ? "Data export" : "Scan"]),
        )
        .map((l) => `  ${l}`),
    );
  }
  lines.push("", term.bold("Allowlist"));
  lines.push(
    allowlist === undefined
      ? "  Empty. Use snappy-export keep to protect friends from the cleanup queue."
      : `  ${plural(allowlist.length, "friend")} protected. File: ${allowlistPathFor(ledgerPath)}`,
  );
  lines.push("", PRIVACY_RESULTS);
  io.out.write(lines.join("\n") + "\n");
  return 0;
}
