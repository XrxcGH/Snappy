/**
 * The Memories page flows its sections down two columns on a wide screen. The advice that follows the reasons for
 * missing files must stay in the same column block as them, and every block must start with an h2 so the headings
 * of one row share a level. Synthetic data only.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { analyze } from "../src/analysis.ts";
import { memories } from "../src/copy.ts";
import { pairingFacts } from "../src/pairing-facts.ts";
import type { State } from "../src/reducer.ts";
import { memoriesView } from "../src/views/memories.ts";
import { FakeElement } from "./fake-dom.ts";
import { render, sampleState } from "./tools/harness.ts";

vi.mock("../src/announce.ts", () => ({ announce: () => undefined }));

let state: State;
beforeAll(async () => {
  state = await sampleState();
}, 120_000);

describe("the Memories columns", () => {
  it("keeps the advice with the reasons, in the block that starts with the files heading", () => {
    const a = analyze(state);
    expect(pairingFacts(a.parsed, a.workspace.issues)?.missing).toBeGreaterThan(0);
    const cols = render(memoriesView, state).root.querySelector(".cols") as unknown as FakeElement;
    const blocks = cols.childNodes.filter((n): n is FakeElement => n instanceof FakeElement);
    const headings = (el: FakeElement): string[] => el.descendants().filter((n) => n.tagName === "h2" || n.tagName === "h3").map((n) => n.textContent);
    expect(blocks.map((b) => b.tagName)).toEqual(["section", "section"]);
    expect(headings(blocks[0] as FakeElement)).toEqual([memories.pairingHeading, memories.pairingWhyHeading, memories.pairingTodoHeading]);
    expect(headings(blocks[1] as FakeElement)).toEqual([memories.meterHeading]);
    for (const block of blocks) expect((block.firstChild as FakeElement).tagName).toBe("h2");
  });
});
