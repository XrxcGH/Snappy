/**
 * The decisions of the words pass, one assertion each, so a later edit cannot quietly bring an old wording back.
 * The general voice rules are in copy.test.ts, copy-quality.test.ts and copy-lint.test.ts; this file pins the
 * specific choices: what the Start page says, which name a thing has, and which words are gone.
 */
import { describe, expect, it } from "vitest";
import * as copy from "../src/copy.ts";

describe("Start page words", () => {
  it("says that Snapchat takes a while to prepare an export, in step 1", () => {
    expect(copy.start.exportBody).toMatch(/prepares it, which can take a while/);
    expect(copy.start.exportBody).toMatch(/emails you a link/);
  });

  it("names the file with no number by its name, not as part 1", () => {
    expect(copy.start.laterPartsOnly).toBe("These are the numbered parts, which hold photos and videos. Add the file that has no number at the end of its name.");
  });

  it("has a message for an unzipped export and a separate Mac tip about Safari", () => {
    expect(copy.start.unzipped).toBe("This looks like an unzipped export. Choose the ZIP files instead.");
    expect(copy.start.unzippedMacTip).toMatch(/^On a Mac, turn off “Open safe files after downloading” in Safari’s settings/);
  });
});
