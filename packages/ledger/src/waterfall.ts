import type { WaterfallBucket } from "./schema";
import { waterfallBuckets } from "./schema";

export const BUCKET_LABELS: Record<WaterfallBucket, string> = {
  housing: "Rent or mortgage",
  food: "Food",
  essentialBills: "Essential bills",
  incomeCosts: "Income-earning costs",
  minimumDebt: "Minimum debt payments",
  emergencyFund: "Emergency fund",
  nonEssentialBills: "Non-essential bills",
};

/** Buckets the chart pays before the starter fund. */
export const ESSENTIAL_BUCKETS: readonly WaterfallBucket[] = ["housing", "food", "essentialBills", "incomeCosts", "minimumDebt"];

export interface WaterfallAllocation {
  bucket: WaterfallBucket;
  label: string;
  needMinor: number;
  allocatedMinor: number;
  shortMinor: number;
}

export interface WaterfallResult {
  payMinor: number;
  allocations: WaterfallAllocation[];
  leftoverMinor: number;
  firstShortBucket: WaterfallBucket | null;
  firstShortEssential: WaterfallBucket | null;
}

/** Allocates one pay in the chart's order and reports the first bucket left short. */
export function paydayWaterfall(payMinor: number, needs: Partial<Record<WaterfallBucket, number>>): WaterfallResult {
  let remaining = payMinor;
  const allocations = waterfallBuckets.map((bucket) => {
    const needMinor = Math.max(0, needs[bucket] ?? 0);
    const allocatedMinor = Math.min(needMinor, Math.max(0, remaining));
    remaining -= allocatedMinor;
    return { bucket, label: BUCKET_LABELS[bucket], needMinor, allocatedMinor, shortMinor: needMinor - allocatedMinor };
  });
  const firstShort = allocations.find((a) => a.shortMinor > 0);
  const firstShortEssential = allocations.find((a) => a.shortMinor > 0 && ESSENTIAL_BUCKETS.includes(a.bucket));
  return {
    payMinor,
    allocations,
    leftoverMinor: Math.max(0, remaining),
    firstShortBucket: firstShort?.bucket ?? null,
    firstShortEssential: firstShortEssential?.bucket ?? null,
  };
}
