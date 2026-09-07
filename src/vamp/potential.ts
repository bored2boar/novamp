/**
 * The 0 to 100 number, and the lines that produce it.
 *
 * Read this file before you trust the number. Every point traces to one `add()`
 * call here, the reasons come out with the score, and the table prints them, so
 * you end up arguing with a line rather than with a total.
 *
 * What this score is: a measure of whether a launch is the one carrying a name,
 * with money and people behind it.
 *
 * What this score is NOT: a prediction. Most of the inputs are visible in the
 * first two minutes, and two minutes of flow does not tell you what a coin does
 * in an hour. The honest reading of a 90 is "if any launch under this name goes
 * anywhere, it is probably this one", never "this one goes somewhere".
 */

import type { Assessment, LaunchRecord, Reason } from "../types.js";
import type { ConvergenceResult } from "../smart/convergence.js";

export interface PotentialInput {
  record: LaunchRecord;
  /** 1 for the first born. */
  rank: number;
  /** Members in the cluster, including this one. */
  clusterSize: number;
  /** Seconds after the first born. */
  lagSec: number;
  convergence: ConvergenceResult;
  /** Set when the first born looks like a farm launch. */
  firstBornTainted: boolean;
  /** Top-10 concentration, already excluding curve and pool. */
  top10Pct: number | null;
}

export interface PotentialResult {
  score: number;
  reasons: Reason[];
}

export function potentialOf(input: PotentialInput): PotentialResult {
  const { record, rank, lagSec, convergence, firstBornTainted, top10Pct } = input;
  const reasons: Reason[] = [];
  // Base is deliberately low. Everything above it has to be earned by something
  // observed, and a launch that earns every point still lands in the high 90s
  // rather than at a suspiciously round 100.
  let score = 35;

  const add = (points: number, text: string) => {
    score += points;
    reasons.push({ points, text });
  };

  // --- birth order ---------------------------------------------------------
  // The single strongest thing in the file. Being first is not proof of
  // anything, but across this chain the launch that carried a name is the first
  // one far more often than it is any other position.
  if (rank === 1) {
    add(14, "first launch under this name");
  } else if (rank === 2 && firstBornTainted) {
    add(8, "second, but the first born looks like a farm launch");
  } else if (lagSec < 120) {
    add(-15, `copy, ${Math.round(lagSec)}s behind the first`);
  } else {
    add(-22, `copy, ${Math.round(lagSec / 60)}m behind the first`);
  }

  // --- proven wallets ------------------------------------------------------
  if (convergence.converged) {
    add(
      16,
      `${convergence.count} proven wallets, ${convergence.count >= 3 ? "converging" : "present"} inside ${Math.round(convergence.spreadSec ?? 0)}s`,
    );
  } else if (convergence.count >= 2) {
    add(10, `${convergence.count} proven wallets, but spread out`);
  } else if (convergence.count === 1) {
    add(4, "one proven wallet");
  } else {
    add(-5, "no proven wallet has touched this");
  }

  // --- organic flow --------------------------------------------------------
  const uniques = record.uniqueEarlyBuyers;
  if (uniques === undefined) {
    add(0, "early buyer count unread");
  } else if (uniques >= 25) {
    add(10, `${uniques} distinct buyers in the first minute`);
  } else if (uniques >= 10) {
    add(5, `${uniques} distinct buyers in the first minute`);
  } else if (uniques <= 3) {
    add(-12, `only ${uniques} distinct buyers in the first minute`);
  }

  const raced = record.buyers?.filter((b) => b.taxPaidBps > 5000).length ?? 0;
  const totalBuyers = record.buyers?.length ?? 0;
  if (totalBuyers >= 5 && raced === totalBuyers) {
    add(-10, "every early buy paid the opening tax: bots only, no humans yet");
  }

  // --- what the launcher kept ---------------------------------------------
  if (record.devSharePct === 0) {
    add(-8, "no dev buy, nothing at stake");
  } else if (record.devSharePct <= 6) {
    add(10, `dev buy ${record.devSharePct.toFixed(2)}%, inside the 1-6% band`);
  } else if (record.devSharePct <= 10) {
    add(-4, `dev buy ${record.devSharePct.toFixed(2)}%, heavy`);
  } else {
    add(-20, `dev buy ${record.devSharePct.toFixed(2)}%, over 10%`);
  }

  if (record.exemptWallets >= 4) {
    add(-18, `${record.exemptWallets} wallets exempt from the opening tax: declared bundle`);
  } else if (record.exemptWallets > 0) {
    add(-6, `${record.exemptWallets} wallet(s) exempt from the opening tax`);
  }

  // --- concentration -------------------------------------------------------
  if (top10Pct === null) {
    add(0, "holder distribution unread");
  } else if (top10Pct >= 30) {
    add(-18, `top 10 hold ${top10Pct.toFixed(1)}%`);
  } else if (top10Pct >= 20) {
    add(-8, `top 10 hold ${top10Pct.toFixed(1)}%`);
  } else if (top10Pct <= 12) {
    add(6, `top 10 hold ${top10Pct.toFixed(1)}%, spread out`);
  }

  // --- the launcher's record ----------------------------------------------
  const dep = record.deployerRecord;
  if (dep) {
    if (dep.priorLaunches <= 1) {
      add(3, "fresh deployer");
    } else if (dep.graduated >= 1 && dep.graduated / dep.priorLaunches >= 0.3) {
      add(14, `deployer graduated ${dep.graduated} of ${dep.priorLaunches} launches`);
    } else if (dep.priorLaunches >= 5 && dep.graduated === 0) {
      add(-22, `deployer: ${dep.priorLaunches} launches, none graduated`);
    }
  }

  // --- somewhere to go -----------------------------------------------------
  const socialCount = [record.socials.twitter, record.socials.website, record.socials.telegram]
    .filter(Boolean).length;
  if (socialCount === 0) add(-12, "no socials: a launch with nowhere to go");
  else add(Math.min(9, socialCount * 3), `${socialCount} social link(s)`);

  // --- is it actually trading ---------------------------------------------
  if (record.phase === 2) {
    add(8, "graduated to the pool");
  } else if (record.curveProgress >= 0.5) {
    add(6, `curve ${(record.curveProgress * 100).toFixed(0)}% filled`);
  } else if (record.curveProgress <= 0.02) {
    add(-10, "curve has barely moved");
  }

  return { score: Math.max(0, Math.min(100, Math.round(score))), reasons };
}

/** Sort assessments the way a reader wants them: the answer first. */
export function byUsefulness(a: Assessment, b: Assessment): number {
  const weight = (x: Assessment) =>
    x.verdict === "ORIGINAL" ? 3 : x.verdict === "CONTESTED" ? 2 : x.verdict === "TAINTED" ? 1 : 0;
  const w = weight(b) - weight(a);
  if (w !== 0) return w;
  if (b.potential !== a.potential) return b.potential - a.potential;
  return a.rank - b.rank;
}
