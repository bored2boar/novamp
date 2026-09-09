/**
 * Finding the moment a name goes from nothing to a fight.
 *
 * A clone war has a shape in time. For hours a name does not exist; then in the
 * space of a few minutes eight, twelve, forty launches appear carrying it, from
 * wallets that have never touched each other. Nobody coordinates that. It is
 * what a crowd looks like when it reads the same sentence at the same time.
 *
 * That burst is the observable, and it is observable *before* anyone knows which
 * of the launches is going to be the one. novamp does not predict it and cannot;
 * what it can do is notice it inside a block or two of it starting, and answer
 * the question the burst raises, which is not "will this pump" but "eleven of
 * these are copies, which one is not".
 *
 * Two things separate a news burst from a farm spraying the same ticker:
 *
 *   - distinct deployers. A farm is one hand and a stack of wallets. Funding
 *     ties them together, and `judgeCluster` already labels that FARM. A crowd
 *     is unrelated hands.
 *   - a cold start. A name that has been launching steadily all day is a meme,
 *     not news. The burst has to be a step change from what the name was doing
 *     before it.
 *
 * Everything in this file is pure. It takes launches and returns findings, and
 * it has never heard of an RPC, a feed or a wallet.
 */

import type { LaunchRecord } from "../types.js";
import { clusterLaunches, type ClusterMember, type RawCluster } from "../vamp/cluster.js";

export interface SwarmOptions {
  /** Launches inside the window before a cluster counts as a swarm. */
  minMembers: number;
  /** How tight the burst has to be, in seconds. */
  windowSec: number;
  /** Distinct deployers required. One hand with ten wallets is a farm, not news. */
  minDeployers: number;
}

export const DEFAULT_SWARM: SwarmOptions = {
  minMembers: 5,
  windowSec: 600,
  minDeployers: 3,
};

export interface Swarm {
  /** The cluster the burst happened in, with every member it has ever had. */
  cluster: RawCluster;
  /** The members inside the burst window, in time order. */
  burst: ClusterMember[];
  /**
   * Everything eligible to be called the original: the burst, plus every member
   * of the cluster that launched before it.
   *
   * These are two different sets and conflating them is a mistake worth naming.
   * The burst is the *evidence* - a rate of launching that says a crowd is
   * reacting. The contenders are the *field* - and the launch the crowd is
   * copying is very often a few minutes ahead of the burst rather than inside
   * it, because somebody has to go first before there is anything to copy.
   * Ranking the burst alone would systematically throw away the one launch the
   * whole command exists to find.
   */
  contenders: ClusterMember[];
  /** Unix seconds of the first and last launch in the burst. */
  startedAt: number;
  endedAt: number;
  /** Distinct deployer addresses across the burst. */
  deployers: number;
  /** Launches per minute across the burst, which is the number worth reading. */
  perMinute: number;
  /**
   * Members of this cluster that launched before the burst, if any.
   *
   * Zero is the interesting case: the name did not exist an hour ago. A high
   * number means this is a name that launches all day and the burst is noise.
   */
  priorMembers: number;
}

/**
 * The densest window of `windowSec` in a time-ordered member list.
 *
 * Two pointers, one pass. Ties go to the EARLIER window, which is not an
 * arbitrary choice: when a name bursts, the run that includes the launch the
 * crowd was copying is the run worth reporting, and that launch is at the front.
 * Preferring the later window on a tie silently cuts the original out of its own
 * swarm, which is a bug this code had for exactly one run.
 */
function densestWindow(
  members: readonly ClusterMember[],
  windowSec: number,
): { from: number; to: number } {
  let bestFrom = 0;
  let bestTo = 0;
  let from = 0;
  for (let to = 0; to < members.length; to++) {
    const at = members[to]!.record.launchedAt;
    while (at - members[from]!.record.launchedAt > windowSec) from++;
    if (to - from > bestTo - bestFrom) {
      bestFrom = from;
      bestTo = to;
    }
  }
  return { from: bestFrom, to: bestTo };
}

/** Every swarm in a launch list, busiest first. */
export function findSwarms(
  records: readonly LaunchRecord[],
  options: SwarmOptions = DEFAULT_SWARM,
): Swarm[] {
  const out: Swarm[] = [];

  for (const cluster of clusterLaunches(records)) {
    if (cluster.members.length < options.minMembers) continue;

    // clusterLaunches already sorts by birth order, which is block position and
    // not timestamp. The window walk needs time, and on a 100 ms chain the two
    // orders disagree often enough to matter, so sort again explicitly.
    const byTime = [...cluster.members].sort(
      (a, b) => a.record.launchedAt - b.record.launchedAt,
    );

    const { from, to } = densestWindow(byTime, options.windowSec);
    const burst = byTime.slice(from, to + 1);
    if (burst.length < options.minMembers) continue;

    const deployers = new Set(burst.map((m) => m.record.deployer.toLowerCase())).size;
    if (deployers < options.minDeployers) continue;

    const startedAt = burst[0]!.record.launchedAt;
    const endedAt = burst[burst.length - 1]!.record.launchedAt;
    const spanSec = Math.max(1, endedAt - startedAt);

    out.push({
      cluster,
      burst,
      contenders: byTime.slice(0, to + 1),
      startedAt,
      endedAt,
      deployers,
      perMinute: (burst.length / spanSec) * 60,
      priorMembers: from,
    });
  }

  out.sort((a, b) => b.burst.length - a.burst.length || b.startedAt - a.startedAt);
  return out;
}

/**
 * The strings this swarm could have been named after.
 *
 * Every symbol and every token name in the burst, deduplicated. The news matcher
 * checks headlines against all of them rather than against the cluster key alone,
 * because the key is the *first born's* symbol folded, and the crowd frequently
 * names the thing better than the first person to launch it did.
 */
export function swarmTerms(swarm: Swarm): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const member of swarm.burst) {
    for (const term of [member.record.symbol, member.record.name]) {
      const clean = term.trim();
      if (!clean) continue;
      const lower = clean.toLowerCase();
      if (seen.has(lower)) continue;
      seen.add(lower);
      out.push(clean);
    }
  }
  return out;
}

/** A swarm that is still adding members, as of `now`. */
export function isLive(swarm: Swarm, now: number, graceSec = 300): boolean {
  return now - swarm.endedAt <= graceSec;
}
