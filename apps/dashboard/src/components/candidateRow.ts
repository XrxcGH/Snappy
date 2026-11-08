import type { Candidate } from "@snappy-export/core";
import type { Actions } from "../actions.ts";
import { announce } from "../announce.ts";
import { categories, common, protection } from "../copy.ts";
import { lists } from "../copy-lists.ts";
import { h } from "../dom.ts";
import { headlineEvidence } from "../evidence.ts";
import { categoryOfCandidate, categoryTag } from "./category.ts";
import { confidenceBadge } from "./confidenceBadge.ts";
import { button, profileLink } from "./button.ts";
import { disclosureSummary, slideIn } from "./layout.ts";
import { showToast } from "./toast.ts";
import { usernameChip } from "./usernameChip.ts";
import { displayUsername } from "../safe.ts";

export type CandidateRowMode = "review" | "protected";

export interface CandidateRowOptions {
  candidate: Candidate;
  actions: Pick<Actions, "keep" | "unkeep">;
  mode?: CandidateRowMode;
  /** Position in the list, for the first-paint slide-in. */
  index?: number;
  /** False for sample data: its invented usernames could belong to real people, so they are never linked. */
  profileLinks?: boolean;
  /** Show the category tag (icon and label) after the confidence badge: for lists that mix categories, such as the cleanup queue. */
  showCategory?: boolean;
}

/** After an Undo the person is back in the list: focus their Keep button again, if the page shows that row. */
function focusKeepButton(host: HTMLElement, key: string): void {
  const scope = host.parentNode as ParentNode | null;
  const wanted = `keep:${key}`;
  const target = [...(scope?.querySelectorAll<HTMLElement>("[data-key]") ?? [])].find((el) => el.dataset.key === wanted);
  target?.focus();
}

/**
 * Brand CandidateRow: username chip, confidence bars and word, one evidence sentence, and a Keep
 * action. Everything shown comes from core's evidence text (no export values) and the username.
 */
export function candidateRow(options: CandidateRowOptions): HTMLElement {
  const { candidate, actions } = options;
  const mode = options.mode ?? "review";
  const headline = headlineEvidence(candidate.evidence);
  const user = displayUsername(candidate.key);
  const onKeepList = candidate.protectedBy.includes("allowlist");

  const reasons = candidate.protectedBy.map((id) => protection[id] ?? common.protectedLabel);

  const decision =
    mode === "protected"
      ? onKeepList
        ? button({
            label: common.unkeep,
            ariaLabel: common.unkeepFor(user),
            icon: "close",
            key: `unkeep:${candidate.key}`,
            onclick: () => {
              actions.unkeep(candidate.key);
              announce(common.unkept(user));
            },
          })
        : null
      : button({
          label: common.keep,
          ariaLabel: common.keepFor(user),
          icon: "check",
          key: `keep:${candidate.key}`,
          onclick: () => {
            actions.keep(candidate.key);
            announce(common.kept(user));
            // The sentence is spoken above; the toast is the visible confirmation, with Undo beside it for eight seconds.
            showToast({
              text: (count) => (count === 1 ? common.kept(user) : lists.keptCount(count)),
              actionLabel: lists.undoButton,
              actionAriaLabel: common.unkeepFor(user),
              onAction: () => {
                actions.unkeep(candidate.key);
                announce(common.unkept(user));
              },
              afterAction: (host) => focusKeepButton(host, candidate.key),
            });
          },
        });

  const row = h(
    "li",
    { class: `candidate candidate-${candidate.category} cat-${categoryOfCandidate(candidate.category)} bar-left` },
    h(
      "div",
      { class: "candidate-head" },
      usernameChip(candidate.key, { key: `copy:${candidate.key}` }),
      confidenceBadge(candidate.confidence),
      options.showCategory ? categoryTag(categoryOfCandidate(candidate.category), categories[candidate.category].label) : null,
    ),
    h(
      "p",
      { class: "candidate-evidence" },
      h("strong", {}, `${categories[candidate.category].lead}. `),
      headline ? headline.detail : "",
    ),
    reasons.length > 0 ? h("p", { class: "candidate-protected" }, h("strong", {}, `${common.protectedLabel}: `), reasons.join("; ")) : null,
    // Always there, so the hint for this level of confidence can be reached without a pointer. The list follows only when more than one signal agrees.
    h(
      "details",
      { class: "why" },
      disclosureSummary(common.why, `why:${candidate.key}`),
      h("p", {}, common.confidenceHint[candidate.confidence]),
      candidate.evidence.length > 1 ? h("ul", { class: "plain-list" }, ...candidate.evidence.map((e) => h("li", {}, e.detail))) : null,
    ),
    h("div", { class: "candidate-actions" }, decision, options.profileLinks === false ? null : profileLink(candidate.key, "quiet")),
  );
  return slideIn(row, options.index ?? 0);
}
