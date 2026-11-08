/**
 * Lint for the pictures in the docs: every image the README (and the screenshots page) shows exists, is a local
 * file and has alt text, and the docs/images folder stays within its size budget. It reads files only; it does not
 * look at what the pictures show (they are made from the built-in sample data, see docs/images/README.md).
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..", "..");
const IMAGES = path.join(root, "docs", "images");
const PAGES = ["README.md", path.join("docs", "images", "README.md")];

/** The whole folder, in bytes. The README promises about 6 MB at most. */
const FOLDER_BUDGET = 6 * 1024 * 1024;
/** One file. Kept small so the README loads quickly. */
const FILE_BUDGET = 1024 * 1024;

interface ImageRef {
  page: string;
  line: number;
  alt: string;
  target: string;
}

/** Every Markdown image (and HTML img tag) outside fenced code. */
function imagesIn(page: string): ImageRef[] {
  const out: ImageRef[] = [];
  let fence = false;
  readFileSync(path.join(root, page), "utf8")
    .split(/\r?\n/)
    .forEach((text, i) => {
      if (/^\s*```/.test(text)) {
        fence = !fence;
        return;
      }
      if (fence) return;
      for (const m of text.matchAll(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) out.push({ page, line: i + 1, alt: m[1] ?? "", target: m[2] ?? "" });
      for (const m of text.matchAll(/<img\b[^>]*>/gi)) {
        const tag = m[0];
        out.push({ page, line: i + 1, alt: /\balt\s*=\s*"([^"]*)"/i.exec(tag)?.[1] ?? "", target: /\bsrc\s*=\s*"([^"]*)"/i.exec(tag)?.[1] ?? "" });
      }
    });
  return out;
}

const resolveTarget = (ref: ImageRef): string => path.resolve(root, path.dirname(ref.page), decodeURIComponent(ref.target));
const place = (ref: ImageRef): string => `${ref.page}:${ref.line} (${ref.target})`;

describe("docs images", () => {
  const refs = PAGES.flatMap(imagesIn);

  it("finds images on both pages", () => {
    for (const page of PAGES) expect(refs.filter((r) => r.page === page).length).toBeGreaterThan(0);
  });

  it("links only local files, never a remote picture", () => {
    expect(refs.filter((r) => /^[a-z][a-z0-9+.-]*:/i.test(r.target) || r.target.startsWith("//")).map(place)).toEqual([]);
  });

  it("points every image at a file that exists inside docs/images", () => {
    const missing = refs.filter((r) => {
      const file = resolveTarget(r);
      return !existsSync(file) || !file.startsWith(IMAGES + path.sep);
    });
    expect(missing.map(place)).toEqual([]);
  });

  it("gives every image alt text that says what it shows", () => {
    expect(refs.filter((r) => r.alt.trim().length < 12).map(place)).toEqual([]);
    expect(refs.filter((r) => /\.(png|webp|jpe?g)\b/i.test(r.alt) || /^(image|screenshot|picture)\b/i.test(r.alt.trim())).map(place)).toEqual([]);
  });

  it("opens the README with the header image", () => {
    const first = imagesIn("README.md")[0];
    expect(first?.target).toBe("docs/images/readme-header.webp");
  });

  it("shows every image in the folder on the screenshots page", () => {
    const shown = new Set(imagesIn(PAGES[1] as string).map((r) => path.basename(r.target)));
    const files = readdirSync(IMAGES).filter((f) => !f.endsWith(".md"));
    expect(files.filter((f) => !shown.has(f))).toEqual([]);
  });

  it("holds only PNG and WebP pictures (and the page that describes them)", () => {
    const odd = readdirSync(IMAGES).filter((f) => !/\.(png|webp)$/.test(f) && f !== "README.md");
    expect(odd).toEqual([]);
  });

  it("stays within the size budget", () => {
    const sizes = readdirSync(IMAGES).map((f) => ({ f, bytes: statSync(path.join(IMAGES, f)).size }));
    expect(sizes.filter((s) => s.bytes > FILE_BUDGET).map((s) => s.f)).toEqual([]);
    expect(sizes.reduce((sum, s) => sum + s.bytes, 0)).toBeLessThanOrEqual(FOLDER_BUDGET);
  });

  it("keeps one social preview, the brand one, at 1280 by 640", () => {
    expect(existsSync(path.join(IMAGES, "social-preview.png"))).toBe(false);
    const png = readFileSync(path.join(root, "brand", "social-preview.png"));
    expect(png.subarray(1, 4).toString("latin1")).toBe("PNG");
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1280, 640]);
  });
});
