/**
 * Every CSV file the CLI writes, over an export whose usernames are hostile (invented, hand-made). A file
 * can be shown with `cat` or opened in a spreadsheet, so it must hold no control, C1 or direction-changing
 * character, and no cell may start with = + - @ unprefixed.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { LATER, run, tempDir } from "./helpers.ts";

const HOSTILE = [
  "evil\u001b]0;pwned\u0007x",
  "\u0085=1",
  "\u202e=cmd",
  "=1+1",
  "+2",
  "-3",
  "@sum",
  "zero\u200bwidth",
  "tab\t=1",
  "line\nbreak",
  "\u009bcsi",
  "\u007fdel",
];

const UNSAFE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/;

function zipOf(usernames: string[]): Uint8Array {
  const friends = {
    Friends: [
      { Username: "anchor_one", "Creation Timestamp": "2020-01-01 10:00:00 UTC" },
      ...usernames.map((u) => ({ Username: u, "Creation Timestamp": "2023-01-01 10:00:00 UTC" })),
    ],
  };
  return zipSync({ "json/friends.json": [new TextEncoder().encode(JSON.stringify(friends)), { mtime: new Date(LATER) }] });
}

function files(): { dir: string; zip: string; earlier: string } {
  const dir = tempDir("csv-hostile");
  const zip = join(dir, "later.zip");
  const earlier = join(dir, "earlier.zip");
  writeFileSync(zip, zipOf(HOSTILE));
  writeFileSync(earlier, zipOf([]));
  return { dir, zip, earlier };
}

/** Quote-aware split of the file into records, so a quoted cell with a line break would show as extra records. */
function records(text: string): string[] {
  return text.split("\r\n").filter((l) => l !== "");
}

function expectSafeFile(text: string, label: string): void {
  expect(text.replace(/\r\n/g, ""), `${label} holds an unsafe character`).not.toMatch(UNSAFE);
  expect(text, `${label} has a bare line break`).not.toMatch(/(?<!\r)\n|\r(?!\n)/);
  for (const line of records(text).slice(1)) {
    for (const cell of line.split(",")) expect(cell.replace(/^"/, ""), `${label} has a formula cell ${cell}`).not.toMatch(/^[=+\-@]/);
  }
}

describe("hostile usernames in CSV files", () => {
  it("friends --out", async () => {
    const { dir, zip } = files();
    const out = join(dir, "friends.csv");
    const r = await run(["friends", zip, "--out", out]);
    expect(r.code).toBe(0);
    const text = readFileSync(out, "utf8");
    expectSafeFile(text, "friends.csv");
    // One header, anchor_one and the twelve hostile names: no name added a row.
    expect(records(text)).toHaveLength(1 + 1 + HOSTILE.length);
    expect(text).toContain("'=1,"); // the U+0085 name
    expect(text).toContain("'=1+1,");
    expect(text).toContain("'+2,");
    expect(text).toContain("'-3,");
    expect(text).toContain("'@sum,");
    expect(text).toContain("?=cmd,"); // the right-to-left override stays visible as "?"
    expect(text).toContain("]0;pwned x,");
  });

  it("since --out", async () => {
    const { dir, zip, earlier } = files();
    const out = join(dir, "since.csv");
    const r = await run(["since", zip, "--earlier", earlier, "--no-save", "--out", out]);
    expect(r.code).toBe(0);
    const text = readFileSync(out, "utf8");
    expectSafeFile(text, "since.csv");
    expect(text).toContain("'=1+1,");
  });

  it("analyze --csv", async () => {
    const { dir, zip } = files();
    const out = join(dir, "queue.csv");
    const r = await run(["analyze", zip, "--no-save", "--csv", out, "--limit", "0"]);
    expect(r.code).toBe(0);
    const text = readFileSync(out, "utf8");
    expectSafeFile(text, "queue.csv");
  });
});
