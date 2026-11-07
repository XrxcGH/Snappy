# Security policy

## What Snappy handles

Snappy reads your own Snapchat data export on your own device. It never sends data anywhere. The only network feature is an optional Memories download in the command-line tool, which contacts only the links inside your own export and is off unless you ask for it. The dashboard is a single file with a policy that blocks all network connections.

## Reporting a vulnerability

Please report security problems privately, not in a public issue. Use the repository's private vulnerability reporting (the "Report a vulnerability" option under the Security tab). Say what you found, how to reproduce it with **synthetic data**, and what the impact is. You can expect an acknowledgement within a few days. We will credit you in the fix unless you prefer not to be named.

## Never share a real export

**Do not attach a real Snapchat export, or anything copied from one, to a report, issue or pull request.** An export contains your friends' usernames, your messages and your Memories. If you need to show how your export is laid out, use the structure-only `inspect` command and read its output before sharing it: it prints field names and counts, not values.

## What counts as a security issue here

Examples of reports we want:

- Any path where message text, display names, group titles, locations, media content, file names or download links could be read, kept, printed, saved or sent when they should not be.
- Anything that lets text from an export run as code in the dashboard (script injection, unsafe links, content-policy gaps).
- Weaknesses in how the history and allowlist are sealed with a passphrase, or in how passphrases are handled.
- Unsafe file handling in the Memories rescue (paths that escape the output folder, overwriting existing files).
- Problems in how the optional download follows links or redirects.

## Supported versions

Snappy is pre-release. Fixes go to the latest version.
