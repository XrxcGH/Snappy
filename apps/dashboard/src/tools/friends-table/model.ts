/**
 * Friends table: the pure step. It hands the friends list and the chats the dashboard already holds to core's friendsTable,
 * which reads usernames, added dates and, per one-to-one chat or Snap, a direction and a time. It then sorts and filters the
 * rows for the page. Usernames are in the rows only, for the result table and the file; counts, dates and codes hold no name.
 *
 * Days are read in UTC, as the command does, so the page and the command agree. Time is data.now, never a clock.
 * The table itself is built once per data object: changing the sort or a filter only reorders and trims rows.
 */
import { insights } from "@snappy-export/core";
import { displayUsername } from "../../safe.ts";
import type { ToolData } from "../data.ts";

export type FriendRow = insights.friendsTable.FriendRow;
export type FriendsTable = insights.friendsTable.FriendsTable;
export type FriendsTableNote = insights.friendsTable.FriendsTableNote;
export type FriendsSortKey = insights.friendsTable.FriendsSortKey;

/** Which hint to show: everyone, or only the friends with that hint. */
export type ShowFilter = "all" | "quiet" | "one-sided" | "waiting" | "waiting-you" | "waiting-them";

export interface FriendsTableParams {
  sort: FriendsSortKey;
  /** Highest or newest first. */
  desc: boolean;
  /** The start of a username, in any case. Empty means everyone. */
  prefix: string;
  show: ShowFilter;
}

export const DEFAULT_PARAMS: FriendsTableParams = { sort: "username", desc: false, prefix: "", show: "all" };

export const SHOW_FILTERS: readonly ShowFilter[] = ["all", "quiet", "one-sided", "waiting", "waiting-you", "waiting-them"];

/** The orders the page offers, as a sort key and a direction. The words for each id are in copy.ts (sortLabels). */
export const SORT_ORDERS = [
  { id: "username-asc", sort: "username", desc: false },
  { id: "username-desc", sort: "username", desc: true },
  { id: "added-desc", sort: "added", desc: true },
  { id: "added-asc", sort: "added", desc: false },
  { id: "last-desc", sort: "last", desc: true },
  { id: "last-asc", sort: "last", desc: false },
  { id: "first-asc", sort: "first", desc: false },
  { id: "total-desc", sort: "total", desc: true },
  { id: "total-asc", sort: "total", desc: false },
  { id: "recent-desc", sort: "recent", desc: true },
  { id: "sent-desc", sort: "sent", desc: true },
  { id: "received-desc", sort: "received", desc: true },
] as const satisfies readonly { id: string; sort: FriendsSortKey; desc: boolean }[];

export type SortOrderId = (typeof SORT_ORDERS)[number]["id"];

/** The id of the order a pair of sort and direction is offered as, or the first order when it is not offered. */
export function orderIdOf(params: Pick<FriendsTableParams, "sort" | "desc">): SortOrderId {
  return (SORT_ORDERS.find((o) => o.sort === params.sort && o.desc === params.desc) ?? SORT_ORDERS[0]).id;
}

/** The longest username start the filter takes. Snapchat usernames are far shorter. */
export const MAX_PREFIX = 64;

export interface FriendsTableResult {
  /** Every friend, by username, with the counts and notes. */
  table: FriendsTable;
  /** The rows that match the filters, in the chosen order. */
  rows: FriendRow[];
  /** A filter other than "all friends" is on. */
  filtered: boolean;
  /** The days used for the hints, so the page can say them. */
  limits: { quietDays: number; windowDays: number };
  /** The order the rows are in, as the id the page offers it under. */
  order: SortOrderId;
  /** What the filters are, as one string, so the page can tell a change of order from a change of filter. Never spoken. */
  filterKey: string;
}

const held = new WeakMap<ToolData, FriendsTable>();

function tableOf(data: ToolData): FriendsTable {
  const known = held.get(data);
  if (known !== undefined) return known;
  const { parsed } = data;
  if (parsed === null) throw new Error("needs an export");
  const table = insights.friendsTable.buildFriendsTable(parsed, { now: data.now });
  held.set(data, table);
  return table;
}

function filterOf(params: FriendsTableParams): insights.friendsTable.FriendsFilter {
  const prefix = params.prefix.trim().slice(0, MAX_PREFIX);
  return {
    ...(prefix !== "" && { prefix }),
    ...(params.show === "quiet" && { quiet: true }),
    ...(params.show === "one-sided" && { oneSided: true }),
    ...(params.show === "waiting" && { waiting: true }),
    ...(params.show === "waiting-you" && { waitingOn: "you" as const }),
    ...(params.show === "waiting-them" && { waitingOn: "them" as const }),
  };
}

export function computeFriendsTable(data: ToolData, params: FriendsTableParams = DEFAULT_PARAMS): FriendsTableResult {
  const table = tableOf(data);
  const filter = filterOf(params);
  const rows = insights.friendsTable.sortRows(insights.friendsTable.filterRows(table.rows, filter), params.sort, params.desc ? "desc" : "asc");
  const d = insights.friendsTable.FRIENDS_TABLE_DEFAULTS;
  return {
    table,
    rows,
    filtered: Object.keys(filter).length > 0,
    limits: { quietDays: d.quietDays, windowDays: d.waiting.windowDays },
    order: orderIdOf(params),
    filterKey: JSON.stringify(filter),
  };
}

/** The file name: the day of the data, so the same table always gets the same name. */
export function csvFileName(asOf: number | null): string {
  return asOf === null ? "friends-table.csv" : `friends-table-${new Date(asOf).toISOString().slice(0, 10)}.csv`;
}

/**
 * The CSV text for the rows shown. Core neutralizes anything a spreadsheet could run as a formula; here characters that reorder
 * or hide text become "?" first, exactly as on screen, so a spreadsheet shows the name the page did.
 */
export function csvText(rows: readonly FriendRow[]): string {
  return insights.friendsTable.toCsv(rows.map((r) => ({ ...r, username: displayUsername(r.username) })));
}
