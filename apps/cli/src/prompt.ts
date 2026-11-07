/**
 * Passphrase input. The passphrase is accepted from the environment, a file, or a hidden prompt;
 * never from an argument (arguments show up in process lists and shell history). It is never
 * written anywhere and never printed.
 */
import { CliError, fsError } from "./errors.ts";
import type { Io } from "./io.ts";

/** The slice of a TTY input stream the prompt needs (a fake stands in for it in tests). */
export interface SecretInput {
  isTTY?: boolean;
  setRawMode?(mode: boolean): unknown;
  setEncoding(encoding: "utf8"): unknown;
  resume(): unknown;
  pause(): unknown;
  on(event: "data", listener: (chunk: string) => void): unknown;
  off(event: "data", listener: (chunk: string) => void): unknown;
}

const ESCAPE_SEQUENCES = /\x1b\[[0-9;]*[A-Za-z~]|\x1bO[A-Za-z]/g;

/** Ask a question on `output` and read one line from `input` without echoing it. */
export function promptHidden(question: string, input: SecretInput, output: { write(text: string): unknown }): Promise<string> {
  if (!input.isTTY || typeof input.setRawMode !== "function") {
    return Promise.reject(
      new CliError(
        "no-terminal",
        "Snappy needs your passphrase but cannot ask here. Set SNAPPY_PASSPHRASE or use --passphrase-file.",
      ),
    );
  }
  const setRawMode = input.setRawMode.bind(input);

  return new Promise<string>((resolve, reject) => {
    let typed: string[] = [];

    const finish = (result: () => void): void => {
      input.off("data", onData);
      setRawMode(false);
      input.pause();
      output.write("\n");
      result();
    };

    const onData = (chunk: string): void => {
      for (const ch of Array.from(chunk.replace(ESCAPE_SEQUENCES, ""))) {
        if (ch === "\r" || ch === "\n") return finish(() => resolve(typed.join("")));
        if (ch === "\u0003") return finish(() => reject(new CliError("canceled", "Canceled. Nothing was changed.", 130)));
        if (ch === "\u0004") {
          if (typed.length === 0) return finish(() => reject(new CliError("canceled", "Canceled. Nothing was changed.", 130)));
          return finish(() => resolve(typed.join("")));
        }
        if (ch === "\u007f" || ch === "\b") typed = typed.slice(0, -1);
        else if (ch >= " ") typed.push(ch);
      }
    };

    output.write(question);
    setRawMode(true);
    input.setEncoding("utf8");
    input.resume();
    input.on("data", onData);
  });
}

/** The shortest passphrase for a new saved history. The dashboard asks for the same. */
export const MIN_PASSPHRASE_LENGTH = 12;

/** A new saved history needs a long enough passphrase. An existing one is never checked: it may be older than this rule. */
function requireLongEnough(passphrase: string, creating: boolean): void {
  if (creating && Array.from(passphrase).length < MIN_PASSPHRASE_LENGTH) {
    throw new CliError(
      "passphrase-short",
      `Use ${MIN_PASSPHRASE_LENGTH} or more characters for your passphrase. If you forget it, your saved history cannot be recovered.`,
    );
  }
}

export interface PassphraseOptions {
  /** --passphrase-file path. Wins over the environment variable. */
  file?: string;
  /** True when no ledger exists yet: ask twice so a typo cannot lock the user out. */
  creating: boolean;
}

/**
 * File bytes as text, the way the person saw them in their editor: a UTF-8 byte order mark is
 * dropped, and a UTF-16 file (what Windows PowerShell 5.1 writes for `echo pass > file`) is
 * decoded as UTF-16. Without this the same visible passphrase would seal the ledger under a
 * different key than the one typed at the prompt.
 */
function decodePassphraseFile(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  return new TextDecoder("utf-8").decode(bytes).replace(/^\ufeff/, "");
}

/** SNAPPY_PASSPHRASE or --passphrase-file, otherwise a hidden prompt. */
export async function resolvePassphrase(io: Io, opts: PassphraseOptions): Promise<string> {
  if (opts.file !== undefined) {
    let text: string;
    try {
      text = decodePassphraseFile(await io.fs.readFile(opts.file));
    } catch (e) {
      throw fsError(e, "read the passphrase file", opts.file);
    }
    // The passphrase is the first line, as the help says. Editors add a line break at the end; any
    // other trailing space is part of the passphrase.
    const passphrase = text.split(/\r\n|\n|\r/, 1)[0] ?? "";
    if (passphrase === "") throw new CliError("passphrase-empty", "The passphrase file is empty. Put your passphrase on its first line.");
    requireLongEnough(passphrase, opts.creating);
    return passphrase;
  }

  const fromEnv = io.env.SNAPPY_PASSPHRASE;
  if (fromEnv !== undefined && fromEnv !== "") {
    requireLongEnough(fromEnv, opts.creating);
    return fromEnv;
  }

  const first = await io.askSecret("Passphrase for your saved history: ");
  if (first === "") throw new CliError("passphrase-empty", `Your saved history needs a passphrase. Use ${MIN_PASSPHRASE_LENGTH} or more characters.`);
  requireLongEnough(first, opts.creating);
  if (opts.creating) {
    const again = await io.askSecret("Type it again to confirm: ");
    if (again !== first) throw new CliError("passphrase-mismatch", "The passphrases did not match, so nothing was saved. Try again.");
  }
  return first;
}
