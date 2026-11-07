/**
 * What an insight command module exports. Registering a command is one line in a list, because
 * everything the CLI needs to know about it (its name, its help row, its usage text and its
 * function) travels in this one object.
 */
import type { Io } from "./io.ts";

/** Where a command sits in the help overview. */
export type InsightGroup = "Your export" | "Friends" | "Chats" | "Memories" | "Checklists";

export interface InsightCommand {
  /** What the person types: lowercase words joined by hyphens, like "friend-count". */
  name: string;
  /** The left column of the help row: the name plus its inputs. At most 28 characters. */
  synopsis: string;
  /**
   * The right column of the help row, written as one full sentence with its final period: at most 49
   * characters including the period. The copy lint needs the period; the help list prints the row without it.
   */
  summary: string;
  group: InsightGroup;
  /** The whole text printed by "help <name>" and "<name> --help". Starts with "Usage: snappy-export <name>". */
  usage: string;
  /** Returns the exit code. Throws CliError for mistakes; main.ts turns them into calm messages. */
  run(args: string[], io: Io): Promise<number>;
}
