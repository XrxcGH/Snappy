import { zipSync } from "fflate";

export const enc = (v: unknown): Uint8Array => new TextEncoder().encode(typeof v === "string" ? v : JSON.stringify(v));

/** Build a zip from synthetic path -> JSON-or-bytes entries. */
export function zipOf(entries: Record<string, unknown>, mtime?: Date): Uint8Array {
  const files: Record<string, [Uint8Array, { mtime?: Date }]> = {};
  for (const [path, v] of Object.entries(entries)) {
    files[path] = [v instanceof Uint8Array ? v : enc(v), mtime ? { mtime } : {}];
  }
  return zipSync(files);
}

export const allMessages = (issues: { message: string }[]): string => issues.map((i) => i.message).join("\n");
