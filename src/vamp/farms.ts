/**
 * Ranking the operators, not the launches.
 *
 * A single vamp is noise. The same wallet producing eighty of them in a week is
 * a business, and that business is visible in the same index every other command
 * already reads: count, for each deployer, how many of its launches were copies
 * of somebody else's name and how many of them ever went anywhere.
 *
 * Pure functions over assessed clusters. No network, no state.
 */

import type { Address, Cluster } from "../types.js";

export interface Farm {
  deployer: Address;
  /** Launches by this deployer in the window. */
  launches: number;
  /** How many of those were copies of a name somebody else launched first. */
  copies: number;
  /** How many were the first under their name. */
  originals: number;
  /** How many reached the pool phase. */
  graduated: number;
  /** Distinct names this deployer has copied. */
  namesTouched: number;
  /** Median seconds between the original and this deployer's copy. */
  medianLagSec: number;
  /** Wallet that funded this deployer, when it could be traced. */
  fundedBy?: Address;
  /** Other deployers in the window that share this funder. */
  siblings: number;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Roll assessed clusters up by deployer.
 *
 * Note what is deliberately not here: any judgement about whether an operator is
 * a scammer. The columns are counts. A deployer with forty copies and no
 * graduations speaks for itself without novamp editorialising, and a deployer
 * with four copies might be somebody who likes a joke.
 */
export function rankFarms(clusters: readonly Cluster[]): Farm[] {
  interface Bucket {
    launches: number;
    copies: number;
    originals: number;
    graduated: number;
    names: Set<string>;
    lags: number[];
    fundedBy?: Address;
  }
  const buckets = new Map<string, Bucket>();

  for (const cluster of clusters) {
    for (const member of cluster.members) {
      const key = member.record.deployer.toLowerCase();
      const bucket: Bucket = buckets.get(key) ?? {
        launches: 0,
        copies: 0,
        originals: 0,
        graduated: 0,
        names: new Set(),
        lags: [],
      };
      bucket.launches++;
      if (member.record.phase === 2) bucket.graduated++;
      if (member.rank === 1) {
        bucket.originals++;
      } else {
        bucket.copies++;
        bucket.names.add(cluster.key);
        bucket.lags.push(member.lagSec);
      }
      if (member.record.deployerRecord?.fundedBy) {
        bucket.fundedBy = member.record.deployerRecord.fundedBy;
      }
      buckets.set(key, bucket);
    }
  }

  // Count how many distinct deployers share each funder, so the table can show
  // an operator running several wallets as one operation rather than as several.
  const byFunder = new Map<string, number>();
  for (const bucket of buckets.values()) {
    if (!bucket.fundedBy) continue;
    const key = bucket.fundedBy.toLowerCase();
    byFunder.set(key, (byFunder.get(key) ?? 0) + 1);
  }

  const farms: Farm[] = [];
  for (const [deployer, bucket] of buckets) {
    farms.push({
      deployer: deployer as Address,
      launches: bucket.launches,
      copies: bucket.copies,
      originals: bucket.originals,
      graduated: bucket.graduated,
      namesTouched: bucket.names.size,
      medianLagSec: median(bucket.lags),
      fundedBy: bucket.fundedBy,
      siblings: bucket.fundedBy ? (byFunder.get(bucket.fundedBy.toLowerCase()) ?? 1) - 1 : 0,
    });
  }

  farms.sort(
    (a, b) => b.copies - a.copies || b.launches - a.launches || a.medianLagSec - b.medianLagSec,
  );
  return farms;
}

/** Operators worth naming: more than one copy, and nothing to show for it. */
export function worstOffenders(farms: readonly Farm[], minCopies = 2): Farm[] {
  return farms.filter((farm) => farm.copies >= minCopies && farm.graduated === 0);
}
