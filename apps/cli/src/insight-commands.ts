/**
 * The insight commands, in the order the help overview lists them inside each group. Adding a
 * command is one import and one line here: main.ts dispatches on `name` and help.ts reads the
 * synopsis, summary, group and usage from the same object.
 */
import { anniversariesCommand } from "./commands/anniversaries.ts";
import { backupCommand } from "./commands/backup.ts";
import { blockedCommand } from "./commands/blocked.ts";
import { closestCommand } from "./commands/closest.ts";
import { exportCheckCommand } from "./commands/export-check.ts";
import { friendCountCommand } from "./commands/friend-count.ts";
import { habitsCommand } from "./commands/habits.ts";
import { onThisDayCommand } from "./commands/on-this-day.ts";
import { privacyCommand } from "./commands/privacy.ts";
import { reachOutCommand } from "./commands/reach-out.ts";
import { remindCommand } from "./commands/remind.ts";
import { repliesCommand } from "./commands/replies.ts";
import { replySpeedCommand } from "./commands/reply-speed.ts";
import { rescueCommand } from "./commands/rescue.ts";
import { safetyCommand } from "./commands/safety.ts";
import { storageCommand } from "./commands/storage.ts";
import type { InsightCommand } from "./insights-command.ts";

export const INSIGHT_COMMANDS: readonly InsightCommand[] = [
  exportCheckCommand,
  remindCommand,
  closestCommand,
  anniversariesCommand,
  backupCommand,
  blockedCommand,
  friendCountCommand,
  repliesCommand,
  replySpeedCommand,
  reachOutCommand,
  habitsCommand,
  storageCommand,
  onThisDayCommand,
  rescueCommand,
  safetyCommand,
  privacyCommand,
];
