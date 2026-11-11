/** The empty state a page shows while the saved history is locked: not "No export yet", since Start has the passphrase form. */
import { routeLink } from "../components/button.ts";
import type { Scope } from "../components/category.ts";
import { emptyState } from "../components/layout.ts";
import { common, overview } from "../copy.ts";

export const lockedState = (category?: Scope): HTMLElement =>
  emptyState({ icon: "seal", spot: "import", category, title: overview.lockedTitle, body: common.lockedBody, actions: [routeLink("start", overview.lockedAction, "primary")] });
