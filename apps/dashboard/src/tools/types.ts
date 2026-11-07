/**
 * The shapes every tool shares. A tool is one folder, src/tools/<id>/, with its own copy.ts, model.ts,
 * view.ts and index.ts (the descriptor). Nothing else in the app knows a tool by name except the one
 * list in registry.ts. See "Adding a tool" in CONTRIBUTING.md.
 */
import type { Scope } from "../components/category.ts";
import type { IconName } from "../components/icon.ts";
import type { View } from "../views/context.ts";

/** The five groups on the hub, in the order they appear. */
export type ToolGroupId = "your-export" | "friends" | "chats" | "memories" | "checklists";

/**
 * What a tool needs before it can say anything. The hub shows "Ready" or the first thing missing, and the tool
 * page shows an honest empty state instead of an empty result.
 *   export    an export read in this session (saved history alone is not enough)
 *   friends   a friends list
 *   chats     chat or Snap history
 *   memories  a Memories list
 */
export type ToolNeed = "export" | "friends" | "chats" | "memories";

export interface ToolDescriptor {
  /** Lowercase words joined by hyphens. The page is #/tools/<id>, and the folder under src/tools has the same name. */
  id: string;
  /** The h1 and the tile title. From the tool's copy.ts. */
  title: string;
  /** One short sentence for the tile, 56 characters or fewer with its period. From the tool's copy.ts. */
  oneLiner: string;
  group: ToolGroupId;
  /** The color scope of the tile and the page. `memories` (orange) only for tools in the Memories group. */
  category: Scope;
  /** The tile's icon, from the shared sprite. */
  icon: IconName;
  needs: readonly ToolNeed[];
  /** Builds the page. Use toolPage() from components/toolPage.ts. */
  view: View;
}

/** What a tool states about itself besides its words: the descriptor's fields that are not copy or the view. */
export type ToolMeta = Pick<ToolDescriptor, "id" | "group" | "category" | "icon" | "needs">;

/** The strings every tool declares in its copy.ts, plus whatever else its page needs. */
export interface ToolCopy {
  title: string;
  oneLiner: string;
  /** One short, plain description under the title: one or two sentences. */
  description: string;
  /** What this tool reads, in one sentence: the kinds of metadata only. The shell adds what is never read. */
  reads: string;
  /** Shown when the tool ran and found nothing, so the page is never blank. Absent when a result always exists. */
  empty?: { title: string; body: string };
}
