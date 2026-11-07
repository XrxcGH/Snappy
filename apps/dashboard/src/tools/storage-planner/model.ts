/**
 * Storage planner: the pure step. It hands the Memories list the dashboard already holds to core's
 * storagePlanner and returns the plan as it is, minus the opaque Memory ids that core lists in each batch: a result
 * here holds counts, sizes, years and ZIP part numbers, never an id, link or path.
 *
 * The goal starts at the free storage cap the person set on the Memories page (data.capGiB), so the two pages agree
 * until the person asks for another goal here.
 */
import { insights } from "@snappy-export/core";
import type { ToolData } from "../data.ts";
import { gibToBytes } from "../../format.ts";

export type StoragePlanOrder = insights.storagePlanner.StoragePlanOrder;
type Plan = insights.storagePlanner.StoragePlan;
export type PlanBatch = Omit<insights.storagePlanner.PlanBatch, "itemIds">;

export interface StoragePlannerParams {
  /** The goal in GB, or null to use the free storage cap. */
  goalGiB: number | null;
  order: StoragePlanOrder;
}

export const DEFAULT_PARAMS: StoragePlannerParams = { goalGiB: null, order: "newest-first" };

export interface StoragePlannerResult {
  plan: Omit<Plan, "batches"> & { batches: PlanBatch[] };
  /** The goal that was used, in GB. */
  goalGiB: number;
}

const usable = (n: number | null): n is number => n !== null && Number.isFinite(n) && n > 0;

export function computeStoragePlanner(data: ToolData, params: StoragePlannerParams = DEFAULT_PARAMS): StoragePlannerResult {
  const { parsed } = data;
  if (parsed === null) throw new Error("needs an export");
  const goalGiB = usable(params.goalGiB) ? params.goalGiB : data.capGiB;
  const plan = insights.storagePlanner.planMemoryStorage(parsed.memories, gibToBytes(goalGiB), { order: params.order, now: data.now });
  return { plan: { ...plan, batches: plan.batches.map(({ itemIds: _ids, ...rest }) => rest) }, goalGiB };
}
