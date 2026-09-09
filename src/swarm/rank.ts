/**
 * Which one of these is the real one.
 *
 * By the time this file runs, the hard work is done: the burst is clustered, the
 * members are judged, every one of them has a score with its reasons attached.
 * All that is left is the selection rule, and the only thing that matters about
 * a selection rule is that it is written down in one place and does not change
 * depending on who is reading it.
 *
 * The rule, in order:
 *
 *   1. Anything the verdict layer called VAMP or DEAD is out. Not ranked lower -
 *      out. A copy is not a worse version of the original, it is a different
 *      thing, and letting a high-scoring copy win on points is how a resolver
 *      turns into the exact mistake it exists to prevent.
 *   2. Of what is left, highest score wins.
 *   3. Ties break on converged proven wallets, then on early buyers, then on
 *      birth order. Birth order last, because being first is already worth
 *      points and counting it twice would just be counting it twice.
 *
 * Then the gates, which are separate on purpose. Winning the cluster is a
 * comparison; clearing the bar is an absolute. The best token in a bad cluster
 * is still a bad token, and a resolver that cannot say "none of these" is not
 * telling you anything.
 *
 * Pure. No network, no clock, no side effects.
 */

import type { Assessment, Cluster } from "../types.js";

export interface RankOptions {
  /** Below this score, novamp names no winner at all. */
  minScore: number;
  /** Refuse a winner carrying this risk level. */
  refuseRisk: "RED" | "AMBER" | "none";
  /**
   * Refuse a pick whose own deployer is funded from a wallet that also funded
   * another member of the cluster.
   *
   * Note what this is not: it is not "refuse anything in a FARM cluster". Almost
   * every burst worth looking at contains farm-launched copies, because a farm
   * is precisely the thing that shows up to copy a hot name, and refusing the
   * whole cluster on their account would mean the command never picked anything
   * on the days it exists for. The question is whether the *pick* is one of
   * them, and that is a question about one deployer's funding, not the
   * cluster's.
   */
  refuseFarm: boolean;
}

export const DEFAULT_RANK: RankOptions = {
  minScore: 70,
  refuseRisk: "RED",
  refuseFarm: true,
};

export interface Ranking {
  /** The member that wins, or null when nothing clears the bar. */
  winner: Assessment | null;
  /** Why there is no winner. Empty when there is one. */
  refusals: string[];
  /** The member that would have won, present even when it was refused. */
  best: Assessment | null;
  /** Everything else in the burst, worst first, so the alert can name what to avoid. */
  avoid: Assessment[];
  /** The line that explains the pick to a human in one sentence. */
  summary: string;
}

function eligible(member: Assessment): boolean {
  return member.verdict === "ORIGINAL" || member.verdict === "CONTESTED";
}

/**
 * Other launches in this cluster paid for by the same wallet that paid for this
 * one.
 *
 * A shared funder is the heaviest single piece of evidence novamp can find,
 * because it survives everything an operator does to look like several people:
 * different deployers, randomised dev buys, shuffled taxes, staggered timing.
 * The money still came from one place.
 */
function fundingSiblings(member: Assessment, cluster: Cluster): Assessment[] {
  const funder = member.record.deployerRecord?.fundedBy?.toLowerCase();
  if (!funder) return [];
  return cluster.members.filter(
    (other) =>
      other !== member &&
      other.record.deployerRecord?.fundedBy?.toLowerCase() === funder,
  );
}

/** Rank the members of one judged cluster. */
export function rankSwarm(cluster: Cluster, options: RankOptions = DEFAULT_RANK): Ranking {
  const candidates = cluster.members.filter(eligible);

  const ordered = [...candidates].sort(
    (a, b) =>
      b.potential - a.potential ||
      Number(b.converged) - Number(a.converged) ||
      b.smartWallets - a.smartWallets ||
      (b.record.uniqueEarlyBuyers ?? 0) - (a.record.uniqueEarlyBuyers ?? 0) ||
      a.rank - b.rank,
  );

  const best = ordered[0] ?? null;
  const avoid = cluster.members
    .filter((member) => member !== best)
    .sort((a, b) => a.potential - b.potential);

  const refusals: string[] = [];

  if (!best) {
    refusals.push(
      cluster.members.length
        ? `every launch in this swarm is a copy or dead: nothing here is the original`
        : `the swarm is empty`,
    );
    return { winner: null, best: null, refusals, avoid, summary: refusals[0]! };
  }

  if (options.refuseFarm) {
    const siblings = fundingSiblings(best, cluster);
    if (siblings.length) {
      refusals.push(
        `the pick shares a funding wallet with ${siblings.length} other launch(es) here: ` +
          siblings.map((s) => s.record.symbol).join(", "),
      );
    }
  }
  if (best.potential < options.minScore) {
    refusals.push(
      `the best launch scores ${best.potential}, under the ${options.minScore} bar`,
    );
  }
  if (options.refuseRisk !== "none") {
    const barred =
      options.refuseRisk === "RED" ? ["RED"] : ["RED", "AMBER"];
    if (barred.includes(best.risk)) {
      refusals.push(`the best launch carries ${best.risk} risk`);
    }
    if (best.risk === "UNKNOWN") {
      refusals.push(`risk could not be measured on the best launch`);
    }
  }

  const winner = refusals.length ? null : best;
  const summary = winner
    ? `${winner.record.symbol} is ${winner.verdict.toLowerCase()}, scores ${winner.potential}, ` +
      `${cluster.members.length - 1} other launch(es) under this name`
    : `no pick: ${refusals.join("; ")}`;

  return { winner, best, refusals, avoid, summary };
}

/**
 * The reasons worth printing, trimmed.
 *
 * The scorer produces every reason it used, positive and negative, which is
 * right for `vamp` and far too much for an alert on a phone. This keeps the
 * heaviest few in each direction.
 */
export function topReasons(member: Assessment, limit = 4): string[] {
  const sorted = [...member.reasons].sort((a, b) => Math.abs(b.points) - Math.abs(a.points));
  return sorted.slice(0, limit).map((reason) => {
    const sign = reason.points >= 0 ? "+" : "";
    return `${sign}${reason.points} ${reason.text}`;
  });
}
