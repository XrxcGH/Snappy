/**
 * Everything the "insights" features offer, one namespace per feature so that generic names such as
 * `InsightNote` in two modules never collide. Each is pure: data and a clock value go in, plain results come out.
 */
export * as activityCalendar from "./activity-calendar.ts";
export * as anniversaries from "./anniversaries.ts";
export * as blockedReview from "./blocked-review.ts";
export * as closestFading from "./closest-fading.ts";
export * as exportCheck from "./export-check.ts";
export * as exportReminder from "./export-reminder.ts";
export * as friendCountHistory from "./friend-count-history.ts";
export * as friendsBackup from "./friends-backup.ts";
export * as friendsTable from "./friends-table.ts";
export * as habits from "./habits.ts";
export * as lookalikeUsernames from "./lookalike-usernames.ts";
export * as memoriesGaps from "./memories-gaps.ts";
export * as memoriesOnThisDay from "./memories-on-this-day.ts";
export * as privacyTuneup from "./privacy-tuneup.ts";
export * as reachOutFirst from "./reach-out-first.ts";
export * as replySpeed from "./reply-speed.ts";
export * as rescueManifest from "./rescue-manifest.ts";
export * as safetyChecklist from "./safety-checklist.ts";
export * as sinceLastExport from "./since-last-export.ts";
export * as storagePlanner from "./storage-planner.ts";
export * as waitingOnReply from "./waiting-on-reply.ts";
export * as yearInReview from "./year-in-review.ts";
