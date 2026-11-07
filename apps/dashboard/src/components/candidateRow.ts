import type { Candidate } from "@snappy-export/core";
import type { Actions } from "../actions.ts";
import { announce } from "../announce.ts";
import { brand, categories, common, protection, protectionFallback } from "../copy.ts";
import { h } from "../dom.ts";
import { headlineEvidence } from "../evidence.ts";
import { confidenceBadge } from "./confidenceBadge.ts";
import { button, profileLink } from "./button.ts";
import { disclosureSummary, slideIn } from "./layout.ts";
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

  const reasons = candidate.protectedBy.map((id) => protection[id] ?? protectionFallback);

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
          },
        });

  const row = h(
    "li",
    { class: `candidate candidate-${candidate.category}` },
    h("div", { class: "candidate-head" }, usernameChip(candidate.key, { key: `copy:${candidate.key}` }), confidenceBadge(candidate.confidence)),
    h(
      "p",
      { class: "candidate-evidence" },
      h("strong", {}, `${categories[candidate.category].lead}. `),
      headline ? headline.detail : "",
    ),
    reasons.length > 0 ? h("p", { class: "candidate-protected" }, h("strong", {}, `${common.protectedLabel}: `), reasons.join("; ")) : null,
    h("p", { class: "caption muted" }, brand.basedOn),
    candidate.evidence.length > 1
      ? h(
          "details",
          { class: "why" },
          disclosureSummary(common.why, `why:${candidate.key}`),
          h("ul", { class: "plain-list" }, ...candidate.evidence.map((e) => h("li", {}, e.detail))),
        )
      : null,
    h("div", { class: "candidate-actions" }, decision, options.profileLinks === false ? null : profileLink(candidate.key, "quiet")),
  );
  return slideIn(row, options.index ?? 0);
}
