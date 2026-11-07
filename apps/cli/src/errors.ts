/**
 * Calm, coded errors. A CliError carries a stable code and a message written for people:
 * what happened, then what to do. Messages never contain export data (usernames, entry names,
 * message text, download links); the only values they may echo are paths the user typed.
 */
export class CliError extends Error {
  readonly code: string;
  readonly exitCode: number;

  constructor(code: string, message: string, exitCode = 1) {
    super(message);
    this.name = "CliError";
    this.code = code;
    this.exitCode = exitCode;
  }
}

/** Translate a filesystem failure into a CliError without echoing the system message. */
export function fsError(e: unknown, action: string, path: string): CliError {
  const code = typeof e === "object" && e !== null && "code" in e ? String((e as { code: unknown }).code) : "";
  switch (code) {
    case "ENOENT":
      return new CliError("not-found", `Snappy could not find "${path}". Check the path and try again.`);
    case "EACCES":
    case "EPERM":
      return new CliError("no-access", `No permission to ${action} "${path}". Check the permissions and try again.`);
    case "EEXIST":
    case "ENOTDIR":
      return new CliError("not-a-folder", `Snappy needs a folder at "${path}", but found a file. Choose another folder.`);
    case "EISDIR":
      return new CliError("is-directory", `Snappy needs a file at "${path}", but found a folder.`);
    case "ENOSPC":
      return new CliError("disk-full", `No space left to ${action} "${path}". Free some space and try again.`);
    case "EBUSY":
      return new CliError("file-busy", `"${path}" is in use by another program. Close it and try again.`);
    default:
      return new CliError("file-error", `Snappy could not ${action} "${path}". Check the path and try again.`);
  }
}
