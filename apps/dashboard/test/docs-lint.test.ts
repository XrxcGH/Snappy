/**
 * Wording lint for the written docs people read (README files and the export guide). The same house
 * rules as the dashboard copy, in the parts that are prose: curly apostrophes and quotes outside code,
 * ZIP in capitals, one name for each thing. Code spans and fenced blocks are left alone.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..", "..");
const DOCS = ["README.md", path.join("apps", "cli", "README.md"), path.join("docs", "EXPORT-GUIDE.md"), path.join("docs", "BETA.md"), path.join("docs", "MACOS.md"), path.join("docs", "images", "README.md"), path.join("docs", "UPDATES.md"), path.join("docs", "UPDATE-RUNBOOKS.md")];

/** The prose of a Markdown file: no fenced blocks, no inline code. One entry per line, with its number. */
function prose(file: string): { n: number; text: string; raw: string }[] {
  const out: { n: number; text: string; raw: string }[] = [];
  let fence = false;
  readFileSync(path.join(root, file), "utf8")
    .split(/\r?\n/)
    .forEach((line, i) => {
      if (/^\s*```/.test(line)) {
        fence = !fence;
        return;
      }
      if (fence) return;
      out.push({ n: i + 1, raw: line, text: line.split(/(`[^`]*`)/).filter((_, k) => k % 2 === 0).join(" ") });
    });
  return out;
}

describe.each(DOCS)("%s", (file) => {
  const lines = prose(file);
  const find = (re: RegExp): string[] => lines.filter((l) => re.test(l.text)).map((l) => `${file}:${l.n}: ${l.text.slice(0, 80)}`);

  it("uses curly apostrophes and quotes in prose, never straight ones", () => {
    expect(find(/[A-Za-z]'[a-z]/)).toEqual([]);
    expect(find(/"[^"]+"/)).toEqual([]);
  });

  it("writes ZIP in capitals in prose, and only file names as .zip", () => {
    expect(find(/\bzips?\b/)).toEqual([]);
  });

  it("uses one name for each thing", () => {
    expect(find(/allowlist/i)).toEqual([]);
    expect(find(/Requests no one accepted|Unanswered requests/)).toEqual([]);
    expect(find(/command-line tool/)).toEqual([]);
  });

  it("has no double spaces after a sentence, no trailing spaces and no tabs", () => {
    expect(find(/[.!?]  +[A-Z]/)).toEqual([]);
    expect(lines.filter((l) => /[ \t]+$/.test(l.raw) && l.raw.trim() !== "").map((l) => `${file}:${l.n}`)).toEqual([]);
    expect(find(/\t/)).toEqual([]);
  });
});

/**
 * American English and no pointers to a branch, in every written document. The dashboard's own copy has the same rule
 * (copy.test.ts); the documents had none, and "tick box" and a branch name had both reached the beta text.
 */
describe.each([...DOCS, "CONTRIBUTING.md", "SECURITY.md", path.join("docs", "RELEASES.md"), path.join("docs", "BRAND.md")])("%s voice", (file) => {
  const lines = prose(file);
  const find = (re: RegExp): string[] => lines.filter((l) => re.test(l.text)).map((l) => `${file}:${l.n}: ${l.text.slice(0, 80)}`);

  it("uses American words and names no branch", () => {
    expect(find(/\b(un)?tick(s|ed|ing)?\b/i)).toEqual([]);
    expect(find(/\b(colour|behaviour|organis|centre|favourite|licence)\w*/i)).toEqual([]);
    expect(find(/\bbranch\s+(feat|fix|wip)\//i)).toEqual([]);
  });
});

/**
 * One name for what a passphrase protects: the saved history. The words ledger, sealed, snapshot and saved data are
 * the developer's, and "turned saving on" points to a switch that does not exist (saving means setting a passphrase).
 * The installer's own checkbox label is quoted as the installer shows it, so it is the one exception.
 */
describe.each([...DOCS.filter((f) => !/MACOS/.test(f)), "CONTRIBUTING.md", "SECURITY.md", path.join("docs", "BRAND.md")])("%s terms", (file) => {
  const INSTALLER_LABEL = "Also delete Snappy’s saved data (history and settings)";
  // The brand guide's word-choices table lists the words to avoid, so its table rows are the one place they may appear.
  const lines = prose(file)
    .filter((l) => !(/BRAND/.test(file) && l.raw.startsWith("|")))
    .map((l) => ({ ...l, text: l.text.replace(INSTALLER_LABEL, "") }));

  it("says saved history, not ledger, sealed, snapshot or saved data", () => {
    const bad = lines.filter((l) => /\b(ledger|sealed|snapshots?|saved data)\b|\bseals\b/i.test(l.text) || /turned saving on|saving turned on|turn saving on/i.test(l.text));
    expect(bad.map((l) => `${file}:${l.n}: ${l.text.slice(0, 90)}`)).toEqual([]);
  });

  it("sends the reader to Snapchat by name, not to “the app”, which is Snappy in these documents", () => {
    const bad = lines.filter((l) => /\b(check|look|see|count|note)\b[^.]*\b(in|from) the app\b[^.]*\b(Profile|Friends)\b|check in the app/i.test(l.text));
    expect(bad.map((l) => `${file}:${l.n}: ${l.text.slice(0, 90)}`)).toEqual([]);
  });
});

/**
 * The network claims. Beta 2 added the update check, so a sentence that says there is one network use, only one, or
 * none must name it, in every document and string a person reads. A claim that stays true for the command line
 * tool alone has to say so.
 */
describe("network claims", () => {
  const CLAIM = /one network|only network|sends nothing over a network|nothing else touches the network/i;
  const CLAIM_DOCS = ["README.md", "CONTRIBUTING.md", "SECURITY.md", path.join("apps", "cli", "README.md"), path.join("docs", "BETA.md"), path.join("docs", "RELEASES.md"), path.join("docs", "UPDATES.md")];

  it.each(CLAIM_DOCS)("%s names the update check wherever it counts the network uses", (file) => {
    const bad = prose(file).filter((l) => CLAIM.test(l.raw) && !/update check/i.test(l.raw));
    expect(bad.map((l) => `${file}:${l.n}: ${l.text.slice(0, 80)}`)).toEqual([]);
  });

  it("names the two network features in the same words in README item 5 and SECURITY", () => {
    const readme = prose("README.md").find((l) => /^5\. /.test(l.raw))?.raw ?? "";
    const security = prose("SECURITY.md").find((l) => /network features/i.test(l.raw))?.raw ?? "";
    for (const text of [readme, security]) {
      expect(text).toMatch(/memories --download/);
      expect(text).toMatch(/update check/i);
      expect(text).toMatch(/github\.com/);
      expect(text).toMatch(/turned off|turn it off/);
    }
  });

  it("qualifies the front page's everything-runs-here line", () => {
    const line = prose("README.md").find((l) => /^3\. Everything runs on this device/.test(l.raw))?.raw ?? "";
    expect(line).toMatch(/apart from the two optional network features/);
  });

  it("is kept in the strings the interface shows", async () => {
    const copy = await import("../src/copy.ts");
    const texts: string[] = [];
    const walk = (v: unknown): void => {
      if (typeof v === "string") texts.push(v);
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") Object.values(v).forEach(walk);
    };
    walk(copy);
    expect(texts.filter((t) => CLAIM.test(t) && !/update check/i.test(t))).toEqual([]);
  });
});

/**
 * Someone who installed the app has no Snappy folder, no Node and no npm. The guides say where the command line tool
 * comes from, what it needs, and that the app covers everything but a full Memories rescue.
 */
describe("what the update check can and cannot say about itself", () => {
  it("says in What is sent that the system’s certificate and proxy handling may contact other hosts, outside Snappy’s control", () => {
    const section = prose(path.join("docs", "UPDATES.md")).map((l) => l.raw).join("\n").split(/^## /m).find((s) => s.startsWith("What is sent")) ?? "";
    expect(section).toMatch(/certificate and proxy handling may also contact other hosts/);
    expect(section).toMatch(/Snappy does not control it/);
    expect(section).toMatch(/proxy configuration/);
  });
});

describe("the README's counts and option names", () => {
  const NUMBERS: Record<string, number> = { eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20 };
  const word = (text: string): number => {
    const [tens, ones] = text.toLowerCase().split("-");
    return ones === undefined ? (NUMBERS[tens!] ?? NaN) : (NUMBERS[tens!] ?? { twenty: 20, thirty: 30 }[tens!] ?? NaN) + ({ one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 }[ones] ?? NaN);
  };
  const body = (file: string): string => prose(file).map((l) => l.raw).join("\n");

  it("says as many more commands as the command line has outside the seven it lists first", async () => {
    const { COMMAND_NAMES } = await import("../../cli/src/cli.ts");
    const FIRST_SEVEN = ["analyze", "memories", "inspect", "keep", "unkeep", "history", "demo"];
    for (const name of FIRST_SEVEN) expect(COMMAND_NAMES, name).toContain(name);
    const more = COMMAND_NAMES.length - FIRST_SEVEN.length;
    const readme = /\b(Twenty-two|Twenty-one|Twenty-three|Twenty|Twenty-four)\s+more commands/.exec(body("README.md"))?.[1] ?? "";
    const cli = /These ((?:twenty|thirty)(?:-[a-z]+)?)\s+commands/i.exec(body(path.join("apps", "cli", "README.md")))?.[1] ?? "";
    expect(word(readme), `README says ${readme}`).toBe(more);
    expect(word(cli), `CLI README says ${cli}`).toBe(more);
  });

  it("says as many tools as the Tools page lists", async () => {
    const { TOOLS } = await import("../src/tools/registry.ts");
    const said = /\b(Twenty-two|Twenty-one|Twenty-three|Twenty)\s+small tools\b/.exec(body("README.md"))?.[1] ?? "";
    expect(word(said), `README says ${said}`).toBe(TOOLS.length);
  });

  it("does not double a verb before a button name (choose Choose ZIP files)", () => {
    expect(body("README.md")).not.toMatch(/(choose|select) (Choose|Select)/i);
  });

  it("quotes Snapchat’s option names the way the app does", () => {
    expect(body("README.md")).toMatch(/Select “Export JSON files” and “User information”, and choose “All Time” as the date range/);
    expect(body(path.join("docs", "EXPORT-GUIDE.md"))).toMatch(/\*\*Date range: “All Time”\*\*/);
  });
});

describe("the brand guide names every feature and every command", () => {
  const brand = (): string => prose(path.join("docs", "BRAND.md")).map((l) => l.raw).join("\n");

  it("lists every tool on the Tools page by its title, in the feature names", async () => {
    const { TOOLS } = await import("../src/tools/registry.ts");
    const text = brand();
    const missing = TOOLS.map((t) => t.title).filter((title) => !new RegExp(`^\\| ${title} \\|`, "m").test(text));
    expect(missing).toEqual([]);
    for (const name of ["Tools", "Guided removal", "Keep list"]) expect(text, name).toMatch(new RegExp(`^\\| ${name} \\|`, "m"));
  });

  it("has a row for every documented command in the command-to-feature table", async () => {
    const { COMMAND_NAMES } = await import("../../cli/src/cli.ts");
    const text = brand();
    const table = text.slice(text.indexOf("### Commands and features"), text.indexOf("### American English"));
    const missing = COMMAND_NAMES.filter((name) => !new RegExp(`\`${name}\``).test(table));
    expect(missing).toEqual([]);
  });

  it("adds the word choices for saved history, sample data, Save and check in Snapchat", () => {
    const text = brand();
    for (const row of ["saved history", "sample data", "Save (a file or a list)", "check in Snapchat", "may have removed you or closed their account"]) expect(text, row).toContain(`| ${row} |`);
    expect(text).toMatch(/Never use a word the person did not choose or see elsewhere in Snappy/);
  });
});

describe("the README mentions guided removal, the keep list and the guides", () => {
  const readme = (): string => prose("README.md").map((l) => l.raw).join("\n");

  it("says one thing each about guided removal, the keep list, saving a history, the Export guide, the Privacy page and duplicates", () => {
    const text = readme();
    expect(text).toMatch(/Guided removal takes you through the list one person at a time/);
    expect(text).toMatch(/keep list protects friends you choose to keep/);
    expect(text).toMatch(/save it with a passphrase in Settings/);
    expect(text).toMatch(/The Export guide page says what to select/);
    expect(text).toMatch(/the Privacy page says what Snappy reads and what it skips/);
    expect(text).toMatch(/Likely duplicates are counted from dates, types and sizes/);
  });
});

describe("the export guide for a Mac and for the app", () => {
  const guide = (): string => prose(path.join("docs", "EXPORT-GUIDE.md")).map((l) => l.raw).join("\n");

  it("has a Terminal block with Mac paths, no quotes around a path that starts with a tilde, and pbcopy", () => {
    // The commands sit in fenced blocks, which prose() leaves out, so this one reads the file as written.
    const text = readFileSync(path.join(root, "docs", "EXPORT-GUIDE.md"), "utf8");
    const mac = text.slice(text.indexOf("### On a Mac"), text.indexOf("### Options"));
    expect(mac).toMatch(/inspect ~\/Downloads\/mydata\*\.zip/);
    expect(mac).not.toMatch(/"~\//);
    expect(mac).toMatch(/\| pbcopy/);
    expect(mac).toMatch(/Open safe files after downloading/);
  });

  it("has a Using the app section that says Run asks for the ZIP files and Copy is for the command line tool", () => {
    const text = guide();
    expect(text).toMatch(/^## Using the app$/m);
    expect(text).toMatch(/Run asks you to choose your ZIP files first/);
    expect(text).toMatch(/\*\*Copy\*\* copies the command for the command line tool, not for the app/);
  });

  it("writes Export your Memories with the capital, as the app does", () => {
    expect(guide()).toMatch(/\| 1\. Export your Memories \|/);
    expect(guide()).not.toMatch(/Export your memories/);
  });
});

describe("the command line tool, for people who installed the app", () => {
  const text = (file: string): string => prose(file).map((l) => l.raw).join("\n");

  it("is a section of the beta guide and of the export guide, with its Node version", () => {
    for (const file of [path.join("docs", "BETA.md"), path.join("docs", "EXPORT-GUIDE.md")]) {
      expect(text(file), file).toMatch(/^## Command line tool$/m);
      expect(text(file), file).toMatch(/separate download/);
      expect(text(file), file).toMatch(/Node 22\.18 or later/);
    }
    expect(text(path.join("docs", "BETA.md"))).toMatch(/real Memories rescue/);
  });

  it("opens the export guide with the in-app route and never sends a reader to a Snappy folder", () => {
    const guide = text(path.join("docs", "EXPORT-GUIDE.md"));
    expect(guide).toMatch(/If you installed the Snappy app, you can skip the terminal/);
    expect(guide.indexOf("If you installed the Snappy app")).toBeLessThan(guide.indexOf("## What to select"));
    expect(guide).not.toMatch(/Go to the Snappy folder/);
    expect(guide).toMatch(/Open a terminal in the folder where you downloaded the Snappy command line tool/);
  });

  it("says in the README that the command line tool is a separate download", () => {
    expect(text("README.md")).toMatch(/The command line tool is a separate download/);
  });
});
