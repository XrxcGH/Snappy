/**
 * Safety checklist: every string this tool shows. Voice rules are in docs/BRAND.md. Keys end in the kind of
 * text they are (Heading, Hint, Note, Line, Announce), because the copy lint reads the kind from the key.
 * Nothing here holds an export value: counts come in as arguments, never a username.
 */
import { insights } from "@snappy-export/core";
import { countOf } from "../../format.ts";

/** The words for each step come from core, so the command line says the same thing. */
const itemText = insights.safetyChecklist.SAFETY_ITEM_TEXT;
const blockedBase = itemText["blocked-list"].hint;
const pendingBase = itemText["who-can-contact-you"].hint;

export const copy = {
  title: "Safety checklist",
  oneLiner: "Walk through a short account safety list.",
  description: "Work through a short list of account safety steps in Snapchat, and mark each one you have done.",
  reads: "Only counts of blocked people and pending requests, and only if you added an export.",

  readyAnnounce: (n: number) => `Safety checklist ready, with ${countOf(n, "step", "steps")} to mark.`,

  progressHeading: "Your progress",
  progressLabel: "Safety progress",
  meterName: "Progress",
  progressText: (done: number, total: number) => (done === total ? `All ${total} marked done` : `${done} of ${total} marked done`),
  reviewLine: "Settings can change. A fresh look every few months may help.",

  stepsHeading: "Safety steps",
  items: itemText,
  blockedHint: (n: number) => `${blockedBase} Your export lists ${countOf(n, "blocked person", "blocked people")}.`,
  pendingHint: (n: number) => `${pendingBase} Your export lists ${countOf(n, "pending request", "pending requests")}.`,

  noExportNote: "Add your export to see counts of blocked people and pending requests.",
} as const;
