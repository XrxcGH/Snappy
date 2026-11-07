/**
 * The one list of tools. The hub, the router and the tests read it; nothing else names a tool.
 * Adding a tool is one import and one line in TOOLS, after the tool's own folder is done. The order
 * here is the order on the hub inside each group.
 */
import type { Scope } from "../components/category.ts";
import { descriptor as anniversaries } from "./anniversaries/index.ts";
import { descriptor as blockedReview } from "./blocked-review/index.ts";
import { descriptor as closestFading } from "./closest-fading/index.ts";
import { descriptor as exportCheck } from "./export-check/index.ts";
import { descriptor as exportReminder } from "./export-reminder/index.ts";
import { descriptor as friendCountHistory } from "./friend-count-history/index.ts";
import { descriptor as friendsBackup } from "./friends-backup/index.ts";
import { descriptor as habits } from "./habits/index.ts";
import { descriptor as lookalikeUsernames } from "./lookalike-usernames/index.ts";
import { descriptor as memoriesOnThisDay } from "./memories-on-this-day/index.ts";
import { descriptor as privacyTuneup } from "./privacy-tuneup/index.ts";
import { descriptor as reachOutFirst } from "./reach-out-first/index.ts";
import { descriptor as replySpeed } from "./reply-speed/index.ts";
import { descriptor as rescueManifest } from "./rescue-manifest/index.ts";
import { descriptor as safetyChecklist } from "./safety-checklist/index.ts";
import { descriptor as sinceLastExport } from "./since-last-export/index.ts";
import { descriptor as storagePlanner } from "./storage-planner/index.ts";
import { descriptor as waitingOnReply } from "./waiting-on-reply/index.ts";
import { descriptor as yearInReview } from "./year-in-review/index.ts";
import type { ToolDescriptor, ToolGroupId } from "./types.ts";

export const TOOLS: readonly ToolDescriptor[] = [
  exportCheck,
  exportReminder,
  sinceLastExport,
  yearInReview,
  friendsBackup,
  friendCountHistory,
  closestFading,
  anniversaries,
  blockedReview,
  lookalikeUsernames,
  waitingOnReply,
  replySpeed,
  reachOutFirst,
  habits,
  storagePlanner,
  memoriesOnThisDay,
  rescueManifest,
  safetyChecklist,
  privacyTuneup,
];

export interface ToolGroup {
  id: ToolGroupId;
  /** The color the group's tiles and pages use. Orange belongs to Memories alone. */
  category: Scope;
}

/** The hub's groups, in order. A group with no tools is not shown. Group names are in copy.ts (tools.groups). */
export const GROUPS: readonly ToolGroup[] = [
  { id: "your-export", category: "cleanup" },
  { id: "friends", category: "requests" },
  { id: "chats", category: "quiet" },
  { id: "memories", category: "memories" },
  { id: "checklists", category: "neutral" },
];

const byId = new Map(TOOLS.map((t) => [t.id, t]));

/** The tool for a route part such as "export-check", or undefined. */
export function toolById(id: string): ToolDescriptor | undefined {
  return byId.get(id);
}

/** The hub's view of the registry: each non-empty group with its tools. */
export function groupedTools(): { group: ToolGroup; tools: ToolDescriptor[] }[] {
  return GROUPS.map((group) => ({ group, tools: TOOLS.filter((t) => t.group === group.id) })).filter((g) => g.tools.length > 0);
}
