/**
 * Year in review: the two files a person can keep or share, built from the result the page already shows. Both hold
 * the year, the tile numbers and the month totals, and nothing else: no username, no date of a person, no file name.
 * They are made only when the person presses a button, never while the page is drawn.
 *
 * The card is an SVG image (text and shapes, no font or picture to load, nothing fetched). A file cannot read the page's
 * theme, so its three colors are the brand's own theme-independent tokens (ink, bone and violet), read from the page when the
 * file is made. Where a page has none (a test with no stylesheet) plain color words stand in; no color is written here.
 */
import { toCsv } from "../../csv.ts";
import { formatCount } from "../../format.ts";
import { copy } from "./copy.ts";
import type { YearView } from "./model.ts";

interface Palette {
  ink: string;
  bone: string;
  violet: string;
}

/** The brand tokens as the page resolves them now, or color words when the page has no style to ask. */
function palette(): Palette {
  const read = (token: string, fallback: string): string => {
    try {
      const value = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
      return /^#[0-9a-f]{3,8}$/i.test(value) ? value : fallback;
    } catch {
      return fallback;
    }
  };
  return { ink: read("--brand-ink", "black"), bone: read("--brand-bone", "white"), violet: read("--brand-violet", "blue") };
}

/** The year of the result, or null when the export holds no year to sum up. */
const yearOf = (v: YearView): number | null => v.result.year;

/** "snappy-year-in-review-2025.csv". With no year the name has none. */
export function cardFileName(v: YearView, extension: "csv" | "svg"): string {
  const year = yearOf(v);
  return year === null ? `snappy-year-in-review.${extension}` : `snappy-year-in-review-${year}.${extension}`;
}

/** The numbers of the tiles with their labels, in the order the page shows them. A missing value is null. */
function tiles(v: YearView): { label: string; value: number | null }[] {
  const t = v.tiles;
  return [
    { label: copy.chatsLabel, value: t.chats },
    { label: copy.activeDaysLabel, value: t.activeDays },
    { label: copy.memoriesLabel, value: t.memories },
    { label: copy.newFriendsLabel, value: t.newFriends },
    { label: copy.removedLabel, value: t.removedFriends },
    { label: copy.gapLabel, value: t.gapDays },
  ];
}

/** The numbers as CSV text: a section, an item and a count on each row. A number the export cannot give is an empty cell. */
export function cardCsvText(v: YearView): string {
  const cell = (n: number | null): string => (n === null ? "" : String(n));
  const rows: string[][] = tiles(v).map((t) => [copy.glanceHeading, t.label, cell(t.value)]);
  if (v.activity !== null) copy.months.forEach((name, i) => rows.push([copy.monthHeading, name, cell(v.activity?.byMonth[i]?.total ?? 0)]));
  if (v.memories !== null) copy.months.forEach((name, i) => rows.push([copy.memoriesMonthHeading, name, cell(v.memories?.byMonth[i]?.total ?? 0)]));
  return toCsv(copy.csvHeaders, rows);
}

const escapeXml = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A text element. Everything written into the image goes through here, so no value can add markup. */
function text(x: number, y: number, size: number, weight: number, fill: string, value: string, anchor: "start" | "middle" | "end" = "start", opacity = 1): string {
  return `<text x="${x}" y="${y}" font-family="system-ui, Segoe UI, Helvetica, Arial, sans-serif" font-size="${size}" font-weight="${weight}" fill="${fill}" fill-opacity="${opacity}" text-anchor="${anchor}">${escapeXml(value)}</text>`;
}

const TILE = "white";
const MUTED_OPACITY = 0.72;
const WIDTH = 1200;
const HEIGHT = 630;

/** The name-free card as SVG text: the year, the six numbers, the busiest month and a bar for each month of activity. */
export function cardSvg(v: YearView): string {
  const year = yearOf(v);
  const { ink: INK, bone: BONE, violet: VIOLET } = palette();
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="${escapeXml(copy.cardLabel(year ?? 0))}">`,
    `<rect width="${WIDTH}" height="${HEIGHT}" fill="${BONE}"/>`,
    `<rect x="0" y="0" width="14" height="${HEIGHT}" fill="${VIOLET}"/>`,
    text(64, 96, 44, 700, INK, year === null ? copy.title : copy.cardTitle(year)),
  ];
  tiles(v).forEach((t, i) => {
    const x = 64 + (i % 3) * 368;
    const y = 128 + Math.floor(i / 3) * 128;
    parts.push(`<rect x="${x}" y="${y}" width="336" height="108" rx="14" fill="${TILE}" stroke="${INK}" stroke-opacity="0.15"/>`);
    parts.push(text(x + 24, y + 44, 20, 500, INK, t.label, "start", MUTED_OPACITY));
    parts.push(text(x + 24, y + 88, 40, 700, INK, t.value === null ? copy.noValue : formatCount(t.value)));
  });
  const month = v.activity?.busiestMonth ?? null;
  if (month !== null) parts.push(text(64, 420, 24, 600, INK, copy.cardBusiestLine(copy.monthsLong[month.key - 1] ?? copy.noValue)));
  if (v.activity !== null) {
    const counts = v.activity.byMonth.map((m) => m.total);
    const max = Math.max(1, ...counts);
    counts.forEach((count, i) => {
      const barHeight = Math.max(count > 0 ? 4 : 0, Math.round((count / max) * 120));
      const x = 64 + i * 92;
      parts.push(`<rect x="${x}" y="${560 - barHeight}" width="64" height="${barHeight}" rx="6" fill="${VIOLET}"/>`);
      parts.push(text(x + 32, 584, 16, 500, INK, copy.months[i] ?? "", "middle", MUTED_OPACITY));
    });
  }
  parts.push(text(WIDTH - 64, 80, 18, 500, INK, copy.cardFooter, "end", MUTED_OPACITY));
  parts.push("</svg>");
  return parts.join("\n");
}
