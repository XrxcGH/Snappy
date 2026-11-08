/**
 * The wording and format rules that every tool page keeps, checked on the nine pages of this group as one list. Each rule
 * reads the words of the tool's copy.ts (all its strings, and every function with sample arguments), so a new string that
 * breaks a rule fails here the moment it is written. The pages' own tests check what each page shows.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { collectCopy, textOf } from "../copy-rules.ts";
import { FakeElement, FakeText } from "../fake-dom.ts";
import { renderToolPages, sampleWorkspace } from "./harness.ts";
import type { RenderedToolPage } from "./harness.ts";

vi.mock("snappy:licenses", () => ({ licenses: [] }));

const here = path.dirname(fileURLToPath(import.meta.url));
const toolsDir = path.join(here, "..", "..", "src", "tools");
const IDS = ["export-reminder", "memories-on-this-day", "reach-out-first", "rescue-manifest", "reply-speed", "since-last-export", "storage-planner", "waiting-on-reply", "year-in-review"] as const;

async function words(id: string): Promise<{ id: string; text: string }[]> {
  const { copy } = (await import(`../../src/tools/${id}/copy.ts`)) as { copy: Record<string, unknown> };
  return collectCopy({ copy }).map((e) => ({ id: `${id}: ${e.id}`, text: e.text }));
}

async function all(): Promise<{ id: string; text: string }[]> {
  return (await Promise.all(IDS.map(words))).flat();
}

/** The strings of all nine pages that match, as "where: text", so a failure says which one. */
async function matching(re: RegExp): Promise<string[]> {
  return (await all()).filter((e) => re.test(e.text)).map((e) => `${e.id}: ${e.text}`);
}

describe("a table cell with a bare value and a phrase", () => {
  it("is read once by the lint, as the phrase a screen reader hears", () => {
    const cell = new FakeElement("td");
    const short = new FakeElement("span");
    short.setAttribute("aria-hidden", "true");
    short.appendChild(new FakeText("27"));
    const long = new FakeElement("span");
    long.appendChild(new FakeText("27 sent"));
    cell.appendChild(short);
    cell.appendChild(long);
    expect(textOf(cell)).toBe("27 sent");
  });
});

describe("the words of the nine pages", () => {
  it("tell people to check in Snapchat, never in the app (the app is Snappy)", async () => {
    expect(await matching(/\bin the app\b/i)).toEqual([]);
  });

  it("say Save for a file: Save CSV, Save JSON, Save calendar file, and never Download for one", async () => {
    expect(await matching(/\bDownload (the |a )?(CSV|JSON|calendar|manifest|file)/i)).toEqual([]);
    const buttons = (await all()).filter((e) => /\.download(Label|Button)$/.test(e.id));
    expect(buttons.map((b) => b.text).sort()).toEqual(["Save CSV", "Save CSV", "Save JSON", "Save calendar file"]);
  });

  it("put a thousands separator in every count, so a large export never shows 1234 next to 1,234", async () => {
    // A count that a copy function takes as a number is written through formatCount or countOf, never straight into the sentence.
    // A year (a parameter named year, first or last) is written as it is, and a percent or a day of the month never has four digits.
    const bare: string[] = [];
    for (const id of IDS) {
      const source = readFileSync(path.join(toolsDir, id, "copy.ts"), "utf8");
      for (const block of source.split(/\n(?=  [A-Za-z]+: )/)) {
        const head = /^\s*([A-Za-z]+): \(([^)]*)\)/.exec(block);
        if (head === null) continue;
        for (const param of (head[2] as string).split(",")) {
          const name = /^\s*(\w+): number\b/.exec(param)?.[1];
          if (name === undefined || /^(year|first|last|percent|day)$/.test(name)) continue;
          if (new RegExp(`\\$\\{${name}\\}`).test(block)) bare.push(`${id}: ${head[1] as string}(${name})`);
        }
      }
    }
    expect(bare).toEqual([]);
  });

  it("say one thing when Snappy cannot describe a note, and leave items out (skip is for files)", async () => {
    const others = (await all()).filter((e) => /\.otherNote$/.test(e.id));
    expect(others).toHaveLength(IDS.length);
    for (const o of others) expect(o.text, o.id).toBe("Snappy found something it could not describe. The export check can say more.");
    expect(await matching(/\bskipp?(ed|s|ing)?\b|\bignor|\bdropped\b/i)).toEqual([]);
  });

  it("call the saved store the saved history: no snapshots, no switch to turn saving on", async () => {
    expect(await matching(/\bsnapshots?\b|turned saving on|saved data/i)).toEqual([]);
  });
});

describe("the nine pages as drawn with the sample", () => {
  let pages: RenderedToolPage[] = [];
  beforeAll(async () => {
    await sampleWorkspace();
    pages = (await renderToolPages()).filter((p) => (IDS as readonly string[]).includes(p.id));
  }, 120_000);

  it("write no number of four digits or more without a separator, except a year", () => {
    expect(pages.filter((p) => p.state === "sample")).toHaveLength(IDS.length);
    const bare: string[] = [];
    for (const page of pages) {
      for (const m of textOf(page.root).matchAll(/\b\d{4,}\b/g)) {
        const n = Number(m[0]);
        if (!(n >= 1969 && n <= 2200)) bare.push(`${page.id} (${page.state}): ${m[0]}`);
      }
    }
    expect(bare).toEqual([]);
  });
});
