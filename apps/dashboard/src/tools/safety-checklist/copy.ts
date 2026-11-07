/**
 * Safety checklist: every string this tool shows. Voice rules are in docs/BRAND.md. Keys end in the kind of
 * text they are (Heading, Hint, Note, Line, Announce), because the copy lint reads the kind from the key.
 * Nothing here holds an export value: counts come in as arguments, never a username.
 */
import { countOf } from "../../format.ts";

const blockedBase = "Check that the people you blocked are the ones you meant to.";
const pendingBase = "Set who can send you Snaps and friend requests.";

export const copy = {
  title: "Safety checklist",
  oneLiner: "Walk through a short account safety list.",
  description: "Work through a short list of account safety steps in Snapchat, and mark each one you have done.",
  reads: "Only counts of blocked people and pending requests, and only if you added an export.",

  readyAnnounce: (n: number) => `Safety checklist ready, with ${countOf(n, "step", "steps")} to mark.`,

  progressHeading: "Your progress",
  progressLabel: "Safety progress",
  progressText: (done: number, total: number) => (done === total ? `All ${total} marked done` : `${done} of ${total} marked done`),
  reviewLine: "Settings can change. A fresh look every few months may help.",

  stepsHeading: "Safety steps",
  items: {
    "two-step-verification": { label: "Turn on two-step verification", hint: "Asks for a code when you log in, even if someone has your password." },
    "recovery-contacts": { label: "Check recovery email and phone", hint: "Make sure you can still get back in if you lose access." },
    "strong-password": { label: "Use a strong, unique password", hint: "Avoid a password you use on other sites." },
    "connected-apps": { label: "Review connected apps", hint: "Remove apps you no longer use or trust." },
    "who-can-contact-you": { label: "Choose who can contact you", hint: pendingBase },
    "blocked-list": { label: "Review your blocked list", hint: blockedBase },
    "logged-in-devices": { label: "Check logged-in devices", hint: "Log out of any device you do not use or recognize." },
  },
  blockedHint: (n: number) => `${blockedBase} Your export lists ${countOf(n, "blocked person", "blocked people")}.`,
  pendingHint: (n: number) => `${pendingBase} Your export lists ${countOf(n, "pending request", "pending requests")}.`,

  noExportNote: "Add your export to see counts of blocked people and pending requests.",
} as const;
