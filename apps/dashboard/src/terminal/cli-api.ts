/**
 * The one door from the in-app terminal's helper code to the command line's code. The commands
 * are plain functions of (args, io), so the helper runs them in a worker with an Io built from
 * the ports in this folder. Only this file and the stubs next to it import from apps/cli, and
 * only code that runs inside the worker imports this file: the page itself never carries the
 * commands (a build check keeps it that way).
 */
export { COMMAND_OPTIONS, runCli } from "../../../cli/src/cli.ts";
export { CliError } from "../../../cli/src/errors.ts";
export { FsError } from "../../../cli/src/ports.ts";
export { posixPath } from "../../../cli/src/posix-path.ts";
export type { Io, Sink } from "../../../cli/src/io.ts";
export type { FsDirEntry, FsErrorCode, FsPort, FsReadHandle, FsStat, Limits, LockPort, PathPort } from "../../../cli/src/ports.ts";
