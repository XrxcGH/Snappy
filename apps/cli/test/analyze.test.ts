import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { buildSyntheticExport } from "@snappy-export/core";
import { CLI_ENTRY_HELP } from "./constants.ts";
import { csvCell } from "../src/render-analysis.ts";
import { LATER, makeIo, run, tempDir, writeDemoPair } from "./helpers.ts";

// Synthetic usernames: ghost_N disappeared between the exports, oneway_N never accepted, dormant_N went quiet.
const PASS = "correct horse battery staple";
const env = { SNAPPY_PASSPHRASE: PASS };

describe("analyze --no-save", () => {
  it("compares two exports, prints the queue, asks for no passphrase and writes nothing", async () => {
    const dir = tempDir("an");
    const home = tempDir("home");
    const { earlier, later } = writeDemoPair(dir);
    const io = makeIo({ home });
    const { code, out, err } = await run(["analyze", later, "--earlier", earlier, "--no-save"], io);

    expect(code).toBe(0);
    expect(err).toBe("");
    expect(io.asked).toEqual([]);
    expect(readdirSync(home)).toEqual([]);
    expect(out).toContain("Export check");
    expect(out).toContain("2 exports in your history");
    expect(out).toMatch(/ghost_1 +Disappeared +▰▰▱ Medium/);
    expect(out).toMatch(/oneway_1 +Unaccepted/);
    expect(out).toMatch(/dormant_\d+ +Quiet +▰▱▱ Low/);
    expect(out).toContain("Your saved history was not read or written, as you asked.");
    expect(out).toContain("Nothing here has left this device.");
    expect(out).not.toContain("\x1b");
  });

  it("says plainly that one export cannot show who disappeared", async () => {
    const { later } = writeDemoPair(tempDir("an"));
    const { out } = await run(["analyze", later, "--no-save"]);
    const text = out.replace(/\s+/g, " ");
    expect(text).toContain("Snappy needs two exports to see who disappeared.");
    expect(text).toContain("Request a new one in a few weeks");
    expect(out).not.toMatch(/ghost_\d+ +Disappeared/);
  });

  it("limits the table and points to --csv and --json for the rest", async () => {
    const { earlier, later } = writeDemoPair(tempDir("an"));
    const { out } = await run(["analyze", later, "--earlier", earlier, "--no-save", "--limit", "3"]);
    expect(out.match(/^ {2}\w+_\d+ +(Disappeared|Unaccepted|Quiet)/gm)).toHaveLength(3);
    expect(out).toMatch(/\d+ more not shown\. Use --csv or --json/);
  });

  it("uses a folder of zips as the parts of one export", async () => {
    const dir = tempDir("an");
    const { later } = writeDemoPair(dir);
    const parts = join(dir, "parts");
    mkdirSync(parts);
    copyFileSync(later, join(parts, "part-1.zip"));
    copyFileSync(later, join(parts, "part-2.zip"));
    const single = await run(["analyze", later, "--no-save", "--json"]);
    const folder = await run(["analyze", parts, "--no-save", "--json"]);
    expect(folder.code).toBe(0);
    expect(JSON.parse(folder.out).counts).toEqual(JSON.parse(single.out).counts);
  });

  it("hides results below --min-confidence", async () => {
    const { earlier, later } = writeDemoPair(tempDir("an"));
    const { out } = await run(["analyze", later, "--earlier", earlier, "--no-save", "--min-confidence", "medium"]);
    expect(out).not.toMatch(/Quiet +▰▱▱/);
    expect(out).toMatch(/Disappeared +▰▰▱/);
  });

  it("protects allowed friends and counts them instead of listing them", async () => {
    const { earlier, later } = writeDemoPair(tempDir("an"));
    const { out } = await run(["analyze", later, "--earlier", earlier, "--no-save", "--allow", "ghost_1, ONEWAY_1", "--allow", "ghost_2"]);
    expect(out).not.toMatch(/^ {2}ghost_1 /m);
    expect(out).not.toMatch(/^ {2}oneway_1 /m);
    expect(out).toMatch(/3 friends protected/);
  });

  it("warns when the friend count does not match the export", async () => {
    const { later } = writeDemoPair(tempDir("an"));
    const { out } = await run(["analyze", later, "--no-save", "--friend-count", "400", "--verbose"]);
    expect(out).toMatch(/Warning +The export has 40 friends, not the 400 you expected/);
    expect(out).toContain("code: friend-count-mismatch");
  });
});

describe("analyze with a sealed ledger", () => {
  it("builds history across runs, seals it, and never writes the passphrase anywhere", async () => {
    const dir = tempDir("an");
    const home = tempDir("home");
    const ledger = join(home, "led", "ledger.sealed");
    const { earlier, later } = writeDemoPair(dir);

    const first = await run(["analyze", earlier, "--ledger", ledger], makeIo({ env }));
    expect(first.code).toBe(0);
    expect(first.out).toContain("History saved with your passphrase.");
    expect(first.out).toContain("1 export in your history");
    expect(first.out).toContain("Snappy needs two exports to see who disappeared.");

    const second = await run(["analyze", later, "--ledger", ledger], makeIo({ env }));
    expect(second.out).toContain("2 exports in your history");
    expect(second.out).toMatch(/ghost_1 +Disappeared/);

    const everything = first.out + first.err + second.out + second.err + readFileSync(ledger).toString("latin1");
    expect(everything).not.toContain(PASS);
    expect(readFileSync(ledger).includes(Buffer.from("ghost_1"))).toBe(false);
    expect(readdirSync(join(home, "led"))).toEqual(["ledger.sealed"]);
  });

  it("uses ~/.snappy/ledger.sealed by default", async () => {
    const home = tempDir("home");
    const { later } = writeDemoPair(tempDir("an"));
    await run(["analyze", later], makeIo({ env, home }));
    expect(existsSync(join(home, ".snappy", "ledger.sealed"))).toBe(true);
  });

  it("asks for the passphrase twice on a new ledger and once on an existing one", async () => {
    const home = tempDir("home");
    const ledger = join(home, "ledger.sealed");
    const { earlier, later } = writeDemoPair(tempDir("an"));

    const fresh = makeIo({ answers: [PASS, PASS] });
    expect((await run(["analyze", earlier, "--ledger", ledger], fresh)).code).toBe(0);
    expect(fresh.asked).toHaveLength(2);

    const again = makeIo({ answers: [PASS] });
    expect((await run(["analyze", later, "--ledger", ledger], again)).code).toBe(0);
    expect(again.asked).toHaveLength(1);
    expect(again.stderr()).toBe("");
  });

  it("reads the passphrase from --passphrase-file", async () => {
    const dir = tempDir("an");
    const file = join(dir, "pass.txt");
    writeFileSync(file, `${PASS}\n`);
    const ledger = join(dir, "ledger.sealed");
    const { later } = writeDemoPair(dir);
    const io = makeIo();
    expect((await run(["analyze", later, "--ledger", ledger, "--passphrase-file", file], io)).code).toBe(0);
    expect(io.asked).toEqual([]);
    expect(existsSync(ledger)).toBe(true);
  });

  it("refuses a wrong passphrase without changing the ledger", async () => {
    const dir = tempDir("an");
    const ledger = join(dir, "ledger.sealed");
    const { earlier, later } = writeDemoPair(dir);
    await run(["analyze", earlier, "--ledger", ledger], makeIo({ env }));
    const before = readFileSync(ledger);

    const result = await run(["analyze", later, "--ledger", ledger, "--verbose"], makeIo({ env: { SNAPPY_PASSPHRASE: "not it" } }));
    expect(result.code).toBe(1);
    expect(result.err).toContain("(code: wrong-passphrase)");
    expect(result.err).not.toContain("not it");
    expect(readFileSync(ledger).equals(before)).toBe(true);
  });

  it("fails calmly with no terminal and no other passphrase source", async () => {
    const { later } = writeDemoPair(tempDir("an"));
    const result = await run(["analyze", later, "--ledger", join(tempDir("an"), "l.sealed"), "--verbose"]);
    expect(result.code).toBe(1);
    expect(result.err).toContain("(code: no-terminal)");
  });

  it("warns when the export is older than the newest one on record", async () => {
    const dir = tempDir("an");
    const ledger = join(dir, "ledger.sealed");
    const { earlier, later } = writeDemoPair(dir);
    await run(["analyze", later, "--ledger", ledger], makeIo({ env }));
    // The short code under a note is for bug reports, so it shows only with --verbose.
    const plain = await run(["analyze", earlier, "--ledger", ledger], makeIo({ env }));
    expect(plain.out).not.toContain("code: ");
    const { out } = await run(["analyze", earlier, "--ledger", ledger, "--verbose"], makeIo({ env }));
    expect(out).toContain("code: older-than-ledger");
  });

  it("keeps and unkeeps friends, and the saved allowlist protects them in later runs", async () => {
    const dir = tempDir("an");
    const ledger = join(dir, "ledger.sealed");
    const { earlier, later } = writeDemoPair(dir);
    await run(["analyze", earlier, "--ledger", ledger], makeIo({ env }));

    const keep = await run(["keep", "Ghost_1", "ghost_2", "ghost_1", "--ledger", ledger], makeIo({ env }));
    expect(keep.code).toBe(0);
    expect(keep.out).toContain("2 friends added to your keep list. 2 friends in total.");
    expect(keep.out).not.toContain("ghost_");

    const protectedRun = await run(["analyze", later, "--ledger", ledger], makeIo({ env }));
    expect(protectedRun.out).not.toMatch(/^ {2}ghost_1 /m);
    expect(protectedRun.out).toMatch(/ghost_3 +Disappeared/);
    expect(protectedRun.out).toMatch(/2 friends protected/);

    const unkeep = await run(["unkeep", "ghost_1", "someone_else", "--ledger", ledger], makeIo({ env }));
    expect(unkeep.out).toContain("1 friend taken off your keep list (1 not on it). 1 friend left.");
    const after = await run(["analyze", later, "--ledger", ledger], makeIo({ env }));
    expect(after.out).toMatch(/^ {2}ghost_1 +Disappeared/m);
    expect(after.out).not.toMatch(/^ {2}ghost_2 /m);
  });

  it("says name, not friend, for a name the saved history has never seen, without echoing it", async () => {
    const dir = tempDir("an");
    const file = join(dir, "h.sealed");
    const { earlier } = writeDemoPair(dir);
    await run(["analyze", earlier, "--history", file], makeIo({ env }));

    const mixed = await run(["keep", "ghost_1", "nobody_x", "--history", file], makeIo({ env }));
    expect(mixed.out).toContain("2 names added to your keep list. 2 names in total.");
    expect(mixed.out).toContain("1 name is not in your saved history, so it may not match anyone yet. Check the spelling.");
    expect(mixed.out).not.toMatch(/ghost_|nobody_x/);

    const unknownOnly = await run(["keep", "nobody_y", "--history", file], makeIo({ env }));
    expect(unknownOnly.out).toContain("1 name added to your keep list. 3 names in total.");

    const known = await run(["keep", "ghost_2", "--history", file], makeIo({ env }));
    expect(known.out).toContain("1 friend added to your keep list.");
    expect(known.out).not.toContain("not in your saved history");

    const off = await run(["unkeep", "nobody_x", "--history", file], makeIo({ env }));
    expect(off.out).toContain("1 name taken off your keep list.");
  });

  it("calls every name a name while there is no saved history to check it against", async () => {
    const file = join(tempDir("an"), "empty.sealed");
    const { out } = await run(["keep", "sam_01", "--history", file], makeIo({ env }));
    expect(out).toContain("1 name added to your keep list. 1 name in total.");
    expect(out).toContain("1 name is not in your saved history");
  });

  it("keep --list prints the count and the names, sorted, and nothing else about the history", async () => {
    const dir = tempDir("an");
    const file = join(dir, "h.sealed");
    const { earlier } = writeDemoPair(dir);
    await run(["analyze", earlier, "--history", file], makeIo({ env }));
    await run(["keep", "ghost_2", "ghost_1", "--history", file], makeIo({ env }));

    const listed = await run(["keep", "--list", "--history", file], makeIo({ env }));
    expect(listed.code).toBe(0);
    expect(listed.out).toBe("2 names on your keep list.\n\n  ghost_1\n  ghost_2\n\nNothing here has left this device.\n");
    // Listing changes nothing: the same two names are still protected and no name was added.
    expect((await run(["keep", "--list", "--ledger", file], makeIo({ env }))).out).toContain("2 names on your keep list.");
    const one = join(dir, "one.sealed");
    await run(["keep", "ghost_1", "--history", one], makeIo({ env }));
    expect((await run(["keep", "--list", "--history", one], makeIo({ env }))).out).toContain("1 name on your keep list.");
  });

  it("keep --list says the list is empty, and asks for no passphrase when there is no saved history", async () => {
    const file = join(tempDir("an"), "none.sealed");
    const io = makeIo({ env: {} });
    const { code, out } = await run(["keep", "--list", "--history", file], io);
    expect(code).toBe(0);
    expect(out).toContain("Your keep list is empty. Use snappy-export keep to add friends.");
    expect(io.asked).toEqual([]);
    expect(existsSync(file)).toBe(false);

    const dir = tempDir("an");
    const made = join(dir, "h.sealed");
    const { earlier } = writeDemoPair(dir);
    await run(["analyze", earlier, "--history", made], makeIo({ env }));
    expect((await run(["keep", "--list", "--history", made], makeIo({ env }))).out).toContain("Your keep list is empty.");
  });

  it("keep --list takes no names, and unkeep has no --list", async () => {
    expect((await run(["keep", "--list", "sam_01"])).err).toContain("--list shows your keep list and takes no names.");
    expect((await run(["unkeep", "--list"])).err).toContain("To see your keep list, run: snappy-export keep --list");
    expect((await run(["help", "keep"])).out).toContain("snappy-export keep --list");
  });

  it("shows snapshot dates and friend counts in ledger status, never usernames", async () => {
    const dir = tempDir("an");
    const ledger = join(dir, "ledger.sealed");
    const { earlier, later } = writeDemoPair(dir);
    await run(["analyze", earlier, "--ledger", ledger], makeIo({ env }));
    await run(["analyze", later, "--ledger", ledger], makeIo({ env }));
    await run(["keep", "ghost_1", "--ledger", ledger], makeIo({ env }));

    const { code, out } = await run(["history", "status", "--history", ledger], makeIo({ env }));
    expect(code).toBe(0);
    expect(out).toMatch(/^Saved history$/m);
    expect(out).not.toMatch(/ledger(?!\.sealed)/i);
    expect(out).toContain("2 exports in your history.");
    expect(out).toMatch(/Jul 4, 2026 +\d+ +\d+\s*$/m);
    expect(out).toMatch(/Nov 1, 2026 +40 +\d+\s*$/m);
    expect(out).not.toMatch(/Scan|Source/);
    expect(out).toContain("1 friend on your keep list.");
    expect(out).not.toMatch(/ghost_|oneway_|dormant_/);
  });

  it("says so when there is no saved history yet", async () => {
    const { code, out } = await run(["history", "status", "--history", join(tempDir("an"), "none.sealed")], makeIo({ env }));
    expect(code).toBe(0);
    expect(out).toBe("No saved history yet. Run snappy-export analyze on your export to start one.\n");
  });

  it("reads and writes the same file whether it is named with --history or the older --ledger", async () => {
    const dir = tempDir("an");
    const file = join(dir, "ledger.sealed");
    const { earlier, later } = writeDemoPair(dir);
    expect((await run(["analyze", earlier, "--history", file], makeIo({ env }))).code).toBe(0);
    expect((await run(["analyze", later, "--ledger", file], makeIo({ env }))).code).toBe(0);
    for (const flag of ["--history", "--ledger"]) {
      const status = await run(["ledger", "status", flag, file], makeIo({ env }));
      expect(status.out, flag).toContain("2 exports in your history.");
    }
    expect(readdirSync(dir).filter((f) => f.endsWith(".sealed"))).toEqual(["ledger.sealed"]);
  });

  it("says saved history, not ledger, when the passphrase is wrong", async () => {
    const dir = tempDir("an");
    const file = join(dir, "h.sealed");
    const { earlier } = writeDemoPair(dir);
    await run(["analyze", earlier, "--history", file], makeIo({ env }));
    const bad = await run(["history", "status", "--history", file], makeIo({ env: { SNAPPY_PASSPHRASE: "not it" } }));
    expect(bad.err).toContain("Snappy could not unlock your saved history and changed nothing.");
    expect(bad.err).not.toMatch(/ledger/i);
  });
});

describe("analyze output formats", () => {
  it("--json prints only JSON with usernames as the sole personal data", async () => {
    const { earlier, later } = writeDemoPair(tempDir("an"));
    const { code, out } = await run(["analyze", later, "--earlier", earlier, "--no-save", "--json"]);
    expect(code).toBe(0);
    const data = JSON.parse(out);
    expect(Object.keys(data)).toEqual(
      expect.arrayContaining(["generatedAt", "issues", "exportsOnRecord", "counts", "changes", "disappearedFriendsAvailable", "summary", "queue", "protected", "ledger"]),
    );
    expect(data.generatedAt).toBe("2026-11-06T12:00:00.000Z");
    expect(data.disappearedFriendsAvailable).toBe(true);
    expect(data.ledger).toBe("skipped");
    expect(data.summary.byCategory).toEqual({ disappeared: expect.any(Number), "not-accepted": expect.any(Number), quiet: expect.any(Number) });
    const first = data.queue[0];
    expect(Object.keys(first).sort()).toEqual(["category", "confidence", "evidence", "score", "username"]);
    expect(first.username).toMatch(/^[a-z0-9_.-]+$/);
    expect(data.queue.map((q: { category: string }) => q.category)).not.toContain("ghost");
    expect(out).not.toContain("\x1b");
  });

  it("--json reports a stopped analysis for a broken export", async () => {
    const dir = tempDir("an");
    const zip = join(dir, "broken.zip");
    writeFileSync(zip, zipSync({ "html/index.html": new TextEncoder().encode("<html></html>") }));
    const { code, out } = await run(["analyze", zip, "--no-save", "--json"]);
    expect(code).toBe(2);
    const data = JSON.parse(out);
    expect(data.stopped).toBe("export-errors");
    expect(data.issues[0].code).toBe("html-only-export");
    expect(data.queue).toBeUndefined();
  });

  it("--csv writes username, category, confidence and score", async () => {
    const dir = tempDir("an");
    const { earlier, later } = writeDemoPair(dir);
    const csv = join(dir, "out", "queue.csv");
    const { code, out } = await run(["analyze", later, "--earlier", earlier, "--no-save", "--csv", csv]);
    expect(code).toBe(0);
    expect(out).toContain(`CSV saved: ${csv}`);
    const lines = readFileSync(csv, "utf8").trimEnd().split("\r\n");
    expect(lines[0]).toBe("username,category,confidence,score");
    expect(lines[1]).toMatch(/^[a-z0-9_.-]+,(disappeared|not-accepted|quiet),(low|medium|high),\d\.\d\d$/);
    expect(lines).toHaveLength(1 + Number(/(\d+) friends to review/.exec(out)?.[1]));
  });

  it("only writes CSV to a .csv file", async () => {
    const dir = tempDir("an");
    const { later } = writeDemoPair(dir);
    const victim = join(dir, "friends.json");
    writeFileSync(victim, "keep me");
    const { code, err } = await run(["analyze", later, "--no-save", "--csv", victim, "--verbose"]);
    expect(code).toBe(1);
    expect(err).toContain("(code: usage)");
    expect(readFileSync(victim, "utf8")).toBe("keep me");
  });

  it("neutralizes spreadsheet formulas in CSV cells", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("-bob")).toBe("'-bob");
    expect(csvCell("@sum")).toBe("'@sum");
    expect(csvCell("\t=x")).toBe("'=x");
    expect(csvCell("\u0085=1")).toBe("'=1");
    expect(csvCell("a\u001b]0;pwned\u0007")).toBe("a ]0;pwned");
    expect(csvCell("plain_name")).toBe("plain_name");
    expect(csvCell("0.62")).toBe("0.62");
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(csvCell("=a,b")).toBe(`"'=a,b"`);
  });

  it("colors only on a color terminal, and never with NO_COLOR or --no-color", async () => {
    const { earlier, later } = writeDemoPair(tempDir("an"));
    const args = ["analyze", later, "--earlier", earlier, "--no-save"];
    const tty = await run(args, makeIo({ interactive: true, env: { COLORTERM: "truecolor" } }));
    expect(tty.out).toContain("\x1b[38;2;");
    expect(tty.out).toContain("\x1b[33m"); // medium confidence is yellow
    expect((await run(args, makeIo({ interactive: true, env: { NO_COLOR: "1" } }))).out).not.toContain("\x1b");
    expect((await run([...args, "--no-color"], makeIo({ interactive: true }))).out).not.toContain("\x1b");
  });
});

describe("analyze with broken input", () => {
  it("stops with exit code 2, shows errors first, and neither asks for a passphrase nor writes a ledger", async () => {
    const dir = tempDir("an");
    const zip = join(dir, "broken.zip");
    writeFileSync(zip, zipSync({ "html/index.html": new TextEncoder().encode("<html></html>") }));
    const ledger = join(dir, "ledger.sealed");
    const io = makeIo();
    const { code, out } = await run(["analyze", zip, "--ledger", ledger, "--verbose"], io);

    expect(code).toBe(2);
    expect(io.asked).toEqual([]);
    expect(existsSync(ledger)).toBe(false);
    expect(out.indexOf("Error")).toBeGreaterThan(-1);
    expect(out.indexOf("Error")).toBeLessThan(out.indexOf("Snappy stopped. It will not suggest removals"));
    expect(out).toContain("code: html-only-export");
    expect(out).not.toContain("Cleanup queue");
  });

  it("exits 2 for a file that is not a readable zip", async () => {
    const dir = tempDir("an");
    const zip = join(dir, "junk.zip");
    writeFileSync(zip, "this is not a zip file at all");
    const { code, out } = await run(["analyze", zip, "--no-save", "--verbose"]);
    expect(code).toBe(2);
    expect(out).toContain("code: zip-unreadable");
  });

  it("rejects bad options with a usage message and exit code 1", async () => {
    const { later } = writeDemoPair(tempDir("an"));
    for (const bad of [["--limit", "x"], ["--min-confidence", "huge"], ["--friend-count", "-3"], ["--allow", "has space"], ["--ledger"], ["--no-save=1"]]) {
      const result = await run(["analyze", later, "--no-save", "--verbose", ...bad]);
      expect(result.code, bad.join(" ")).toBe(1);
      expect(result.err, bad.join(" ")).toContain("(code: usage)");
      expect(result.out).toBe("");
    }
    expect((await run(["analyze", "--verbose"])).err).toContain("(code: no-input)");
    expect((await run(["analyze", join(tempDir("an"), "missing.zip"), "--verbose"])).err).toContain("(code: not-found)");
  });

  it("shows the short error code only with --verbose or SNAPPY_DEBUG=1", async () => {
    const missing = join(tempDir("an"), "missing.zip");
    const plain = await run(["analyze", missing]);
    expect(plain.err).toContain("Check the path and try again.");
    expect(plain.err).not.toContain("code");
    expect((await run(["analyze", missing, "--verbose"])).err).toContain("(code: not-found)");
    expect((await run(["analyze", missing], makeIo({ env: { SNAPPY_DEBUG: "1" } }))).err).toContain("(code: not-found)");
    // --verbose is accepted by every command, so it never turns an error into a different one.
    expect((await run(["ledger", "status", "--verbose", "--ledger", join(tempDir("an"), "none.sealed")])).code).toBe(0);
  });

  it("prints its own help", async () => {
    const { code, out } = await run(["analyze", "--help"]);
    expect(code).toBe(0);
    expect(out).toContain(CLI_ENTRY_HELP.analyze);
  });
});

describe("a synthetic export without chat history", () => {
  it("says what that costs", async () => {
    const dir = tempDir("an");
    const files = buildSyntheticExport({ now: LATER, friendCount: 40, memoryCount: 5 });
    delete files["json/chat_history.json"];
    const later = join(dir, "no-chats.zip");
    writeFileSync(later, zipSync(files));
    const { out } = await run(["analyze", later, "--no-save"]);
    expect(out).toContain("This export has no chats or Snaps, so quiet friends cannot be found.");
  });
});
