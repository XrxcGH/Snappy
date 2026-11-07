import type { Evidence } from "@snappy-export/core";

/** The sentence that carries the most weight, or the first one when none is weighted. */
export function headlineEvidence(evidence: readonly Evidence[]): Evidence | undefined {
  return evidence.reduce<Evidence | undefined>((best, e) => (best === undefined || e.weight > best.weight ? e : best), undefined);
}
