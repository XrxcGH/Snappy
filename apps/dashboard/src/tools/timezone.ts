/**
 * The time zone every tool starts in, in one place.
 *
 * A tool that shows hours, days or dates takes its starting zone from startingOffset(): the zone the person last chose
 * (read from this session, then from what the page remembered), else the zone this device is in now, else UTC. A choice
 * made on one tool's page changes only that page; remembering it for the next page is a separate, explicit call.
 *
 * The list is whole and half hours (plus the three quarter-hour zones in use): fixed offsets, not named zones, so a
 * daylight saving change is not followed. The caption under a result says which offset it used, so a person is never left
 * to guess. Reading the device's offset does not read a clock the export could influence, and nothing here touches an export.
 */
import { zone } from "../copy-tools.ts";
import { h } from "../dom.ts";
import { readZonePreference, writeZonePreference } from "../vault.ts";

/** The time zones offered, in minutes east of UTC: every whole hour, plus the half and quarter hours in common use. */
export const OFFSETS: readonly number[] = [
  -720, -660, -600, -570, -540, -480, -420, -360, -300, -240, -210, -180, -120, -60, 0, 60, 120, 180, 210, 240, 270, 300, 330, 345, 360, 390, 420, 480, 525, 540, 570, 600, 630, 660, 720, 765, 780, 840,
];

const offered = (minutes: number): boolean => OFFSETS.includes(minutes);

/** The offset as a label: "UTC", "UTC+2:00", "UTC-5:30". */
export function offsetLabel(minutes: number): string {
  if (!Number.isFinite(minutes)) return "";
  if (minutes === 0) return "UTC";
  const abs = Math.abs(minutes);
  return `UTC${minutes < 0 ? "-" : "+"}${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, "0")}`;
}

/** Minutes east of UTC where this device is right now. It can be one the list does not offer (a rare zone). Never negative zero. */
export function deviceOffsetMinutes(): number {
  const minutes = -new Date().getTimezoneOffset();
  return Number.isFinite(minutes) ? minutes + 0 : 0;
}

let chosen: number | null = null;

/** Minutes the person last chose, if the list offers it. Null when nothing was chosen or what was kept is not an offered zone. */
export function readPreferredOffset(): number | null {
  if (chosen !== null && offered(chosen)) return chosen;
  const raw = readZonePreference();
  if (raw === null || !/^-?\d{1,4}$/.test(raw)) return null;
  const minutes = Number(raw) + 0;
  return offered(minutes) ? minutes : null;
}

/** Keep a choice for the next page: in memory now, and where the page remembers its theme. A value the list does not offer is ignored. */
export function rememberOffset(minutes: number): void {
  if (!offered(minutes)) return;
  chosen = minutes;
  writeZonePreference(String(minutes));
}

/** Forget the choice (tests, and a person who wants the device's zone back). */
export function forgetPreferredOffset(): void {
  chosen = null;
  writeZonePreference(null);
}

/** Where a tool's time zone starts: the last choice, else the device's zone when the list offers it, else UTC. */
export function startingOffset(): number {
  const preferred = readPreferredOffset();
  if (preferred !== null) return preferred;
  const device = deviceOffsetMinutes();
  return offered(device) ? device : 0;
}

/** The options of a Time zone select, with `selected` marked. */
export function zoneOptions(selected: number): HTMLElement[] {
  return OFFSETS.map((minutes) => h("option", { value: String(minutes), selected: minutes === selected }, offsetLabel(minutes)));
}

/** The line under a result that shows dates or times: "Dates are in UTC-5:00." */
export function zoneCaption(minutes: number): HTMLElement {
  return h("p", { class: "caption zone-caption" }, zone.datesIn(offsetLabel(minutes)));
}
