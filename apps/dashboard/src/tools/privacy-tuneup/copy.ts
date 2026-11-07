/**
 * Privacy tune-up: every string this tool shows. Voice rules are in docs/BRAND.md. Keys end in the kind of
 * text they are (Heading, Header, Note, Line), because the copy lint reads the kind from the key. The
 * checklist is self-reported, so nothing here says a setting was checked, verified or found safe.
 */
import { countOf } from "../../format.ts";

export const copy = {
  title: "Privacy tune-up",
  oneLiner: "Review your Snapchat privacy settings.",
  description: "A short list of privacy settings to review in Snapchat. Mark each one as you go.",
  reads: "Nothing from your export, only the marks you make on this page.",

  doneAnnounce: (n: number) => `Privacy tune-up ready. ${countOf(n, "setting", "settings")} to review.`,

  progressHeading: "Your progress",
  progressLabel: "Settings marked done",
  meterName: "Progress",
  progressText: (done: number, total: number) => `${done} of ${total} marked done`,
  doneHeader: "Marked done",
  leftHeader: "Left to review",
  percentHeader: "Progress",
  unitOf: (done: number, total: number) => `${done} of ${total}`,
  unitPercent: (percent: number) => `${Math.round(percent)}%`,

  listHeading: "Settings to review",
  /** One entry per checklist item id from core. The wording is general: the app's own menus may differ. */
  items: {
    "contact-me": { label: "Who can contact you", hint: "Check who may send you Snaps and chats." },
    "group-invites": { label: "Group chat invites", hint: "Check who may add you to group chats." },
    "view-story": { label: "Who can see your story", hint: "Choose friends only, custom or public." },
    "quick-add": { label: "Quick add suggestions", hint: "Decide whether you show up in suggestions." },
    search: { label: "Who can find you", hint: "Check whether people can look you up." },
    "map-location": { label: "Map and ghost mode", hint: "Check who may see you on the Snap Map." },
    "spotlight-profile": { label: "Spotlight and public profile", hint: "Check what is public." },
    "personalized-ads": { label: "Personalized ads", hint: "Check which ad settings are on." },
    "data-sharing": { label: "Data sharing", hint: "Check what you share with apps and partners." },
  } as Record<string, { label: string; hint: string }>,

  menusNote: "Snapchat may rename or move these settings, so look for the closest match.",
  generalNote: "This list is general. Your own needs may call for different choices.",
  nothingMarkedNote: "Nothing is marked yet. Open Snapchat and go through the list.",
  allDoneNote: "Every setting is marked done. Looking again every few months may help.",
} as const;
