/**
 * Export reminder: every string this tool shows. Voice rules are in docs/BRAND.md. Keys end in the kind of
 * text they are (Heading, Header, Help, Note, Line, Button, Announce), because the copy lint reads the kind from the key.
 * Nothing here holds an export value: dates and counts come in as arguments.
 */
import { countOf } from "../../format.ts";

export const copy = {
  title: "Export reminder",
  oneLiner: "Make a calendar reminder for your next export.",
  description: "Pick when to request a fresh export, then save a calendar file. It holds no personal data.",
  reads: "Only the date your export was made, if you added one.",

  settingsHeading: "Reminder settings",
  lastExportHeader: "Last export date",
  lastExportHelp: "Leave it empty to use the date of your export.",
  monthsHeader: "Months to wait",
  monthsHelp: "Whole months, from 1 to 120.",
  timeHeader: "Time of day",
  timeHelp: "Leave it empty for an all-day event.",
  alertHeader: "Alert before",
  alertHelp: "Whole days, from 0 to 30. Leave it empty for no alert.",
  alertPlaceholder: "Optional",
  zoneHeader: "Time zone",
  zoneHelp: "It decides which calendar day your dates fall on.",

  reminderHeading: "Your reminder",
  dueLine: (date: string) => `Request your next export on ${date}.`,
  lastExportFact: "Last export",
  unknownLine: "Not known",
  waitFact: "Wait",
  eventFact: "Event",
  alertFact: "Alert",
  months: (n: number) => countOf(n, "month", "months"),
  allDayLine: "All day",
  timedLine: (clock: string, minutes: number) => `${clock}, ${countOf(minutes, "minute", "minutes")}`,
  /** A 24-hour time as an American clock, such as "9:00 AM". */
  unitClock: (hour: number, minute: number): string => `${hour % 12 === 0 ? 12 : hour % 12}:${String(minute).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`,
  noAlertLine: "None",
  sameDayLine: "Same day",
  alertBeforeLine: (days: number) => `${countOf(days, "day", "days")} before`,

  noLastNote: "Snappy found no last export date, so the wait counts from today.",
  invalidLastNote: "The last export date could not be used, so the wait counts from today.",
  futureLastNote: "The last export date is in the future, so the wait counts from today. A device clock may be off.",
  monthsAdjustedNote: (n: number) => `The number of months could not be used, so Snappy used ${countOf(n, "month", "months")}.`,
  timeAdjustedNote: "The time could not be used as given, so Snappy used the nearest time it could.",
  alertAdjustedNote: "The alert could not be used as given, so it is set for the same day.",
  zoneAdjustedNote: "The time zone could not be used, so Snappy used UTC days.",
  clampedNote: "That day does not exist in the reminder month, so it falls on the last day of it.",
  passedNote: "Your next export may be due already, so the reminder is set for tomorrow.",
  passedNoDateNote: "The reminder date had already passed, so it is set for tomorrow.",
  otherNote: "Snappy found something it could not describe. The export check can say more.",

  downloadLabel: "Save calendar file",
  downloadNote: "The calendar file holds no personal data.",
  doneAnnounce: (date: string) => `Your next export reminder is due on ${date}.`,
} as const;
