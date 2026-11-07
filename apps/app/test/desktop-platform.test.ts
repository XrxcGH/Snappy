/**
 * What the desktop app tells the dashboard about itself: which system it is, and that it opens no profile links.
 */
import { afterEach, describe, expect, it } from "vitest";
import { platform, setPlatform } from "../../dashboard/src/platform.ts";
import { desktopKind, desktopPlatform } from "../src/desktop-platform.ts";

afterEach(() => setPlatform(desktopPlatform));

describe("desktop platform", () => {
  it("calls a WebView2 window Windows, and any other engine other", () => {
    const edge = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36 Edg/156.0.0.0";
    const mac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)";
    const linux = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko)";
    expect(desktopKind(edge)).toBe("windows");
    expect(desktopKind(mac)).toBe("other");
    expect(desktopKind(linux)).toBe("other");
    expect(desktopKind("")).toBe("other");
  });

  it("is set as the page's platform as soon as it is loaded, with the profile links off and no reader of its own", () => {
    expect(platform()).toBe(desktopPlatform);
    expect(["windows", "other"]).toContain(desktopPlatform.desktop);
    expect(desktopPlatform.profileLinks).toBe(false);
    expect(desktopPlatform.pickZips).toBeUndefined();
    expect(desktopPlatform.runImport).toBeUndefined();
  });
});
