/** Strings the tests look for in help output. */
export const CLI_ENTRY_HELP = {
  analyze: "Usage: snappy-export analyze <ZIP files or folder...> [options]",
  memories: "Usage: snappy-export memories <ZIP files or folder...> --out <folder> [options]",
  inspect: "Usage: snappy-export inspect <ZIP files or folder...> [--show-keys] [--layout] [--memory-links] [--mtime-check] [--checks-only]",
  keep: "Usage: snappy-export keep <username...> [options]",
  ledger: "Usage: snappy-export ledger status [options]",
  demo: "Usage: snappy-export demo [--dir <folder>] [--run]",
} as const;
