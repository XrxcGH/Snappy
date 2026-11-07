import { describe, expect, it } from "vitest";
import { parseMemoriesJson } from "../../src/export/parse.ts";
import { allMessages } from "./helpers.ts";

const URL1 = "https://example.invalid/dl/11111111-1111-1111-1111-111111111111.jpg?sig=abc";

describe("parseMemoriesJson", () => {
  it("projects date, mediaType and the opaque URL only (Location is never read)", () => {
    const { memories, issues } = parseMemoriesJson({
      "Saved Media": [
        {
          Date: "2023-04-01 12:30:00 UTC",
          "Media Type": "Image",
          Location: "Latitude, Longitude: 37.77, -122.41",
          "Download Link": "https://example.invalid/page",
          "Media Download Url": URL1,
        },
      ],
    });
    expect(memories).toHaveLength(1);
    const m = memories[0]!;
    expect(m).toMatchObject({ date: Date.UTC(2023, 3, 1, 12, 30), mediaType: "image", downloadUrl: URL1 });
    expect(Object.keys(m).sort()).toEqual(["date", "downloadUrl", "id", "mediaType"]);
    expect(JSON.stringify(memories)).not.toMatch(/37\.77|122\.41|latitude/i);
    expect(issues).toEqual([]);
  });

  it("falls back to the landing link, infers type from the URL, and requires http(s)", () => {
    const { memories } = parseMemoriesJson({
      "Saved Media": [
        { Date: "2023-01-01 00:00:00 UTC", "Download Link": "https://example.invalid/a.mp4" },
        { Date: "2023-01-02 00:00:00 UTC", "Media Type": "Video", "Download Link": "javascript:alert(1)" },
      ],
    });
    expect(memories[0]).toMatchObject({ mediaType: "video", downloadUrl: "https://example.invalid/a.mp4" });
    expect(memories[1]?.downloadUrl).toBeUndefined();
  });

  it("gives identical items distinct ids", () => {
    const e = { Date: "2023-01-01 00:00:00 UTC", "Media Type": "Image", "Media Download Url": "https://example.invalid/x" };
    const { memories } = parseMemoriesJson({ "Saved Media": [e, e, e] });
    expect(new Set(memories.map((m) => m.id)).size).toBe(3);
  });

  it("reports bad dates and invalid entries by count only", () => {
    const { memories, issues } = parseMemoriesJson({
      "Saved Media": [{ Date: "garbage", "Media Type": "Image" }, "junk", null, { "Media Type": "Video" }],
    });
    expect(memories.map((m) => m.date)).toEqual([null, null]);
    expect(issues.map((i) => i.code).sort()).toEqual(["memories-bad-date", "memories-invalid-entries"]);
  });

  it("accepts a bare array and mixed-case section keys", () => {
    expect(parseMemoriesJson([{ Date: "2023-01-01 00:00:00 UTC", "Media Download Url": "https://example.invalid/x" }]).memories).toHaveLength(1);
    expect(
      parseMemoriesJson({ "saved media": [{ date: "2023-01-01 00:00:00 UTC", "media download url": "https://example.invalid/x" }] }).memories,
    ).toHaveLength(1);
  });

  it.each([null, undefined, 5, "s", {}, { Other: [] }])("never throws on %j", (bad) => {
    const { memories, issues } = parseMemoriesJson(bad);
    expect(memories).toEqual([]);
    expect(issues.length).toBeGreaterThan(0);
  });

  it("does not echo section keys in issues", () => {
    const { issues } = parseMemoriesJson({ CanaryKey: 1 });
    expect(allMessages(issues)).not.toContain("Canary");
  });

  it("handles 60k memories", () => {
    const list = Array.from({ length: 60_000 }, (_, i) => ({
      Date: new Date(Date.UTC(2020, 0, 1) + i * 60_000).toISOString().replace("T", " ").slice(0, 19) + " UTC",
      "Media Type": i % 2 ? "Image" : "Video",
      "Media Download Url": `https://example.invalid/${i}`,
    }));
    const t0 = performance.now();
    const { memories } = parseMemoriesJson({ "Saved Media": list });
    expect(memories).toHaveLength(60_000);
    expect(new Set(memories.map((m) => m.id)).size).toBe(60_000);
    expect(performance.now() - t0).toBeLessThan(3000);
  });
});
