/**
 * Who is the original, and does being first still mean anything here.
 *
 * The naive rule is "first born wins". It is right most of the time and wrong in
 * the case that costs the most money: an operator launches the bait himself,
 * loads it with a bundle, and lets the crowd assume first means real.
 *
 * So the first born has to survive a check before it is called ORIGINAL. If it
 * does not, novamp says so and looks at where the flow actually went, which is
 * the CONTESTED state. Nothing here decides for you; it decides what to call the
 * rows so you can read the table in one pass.
 */

import type {
  Assessment,
  Cluster,
  ClusterVerdict,
  LaunchRecord,
  TokenVerdict,
} from "../types.js";
import type { RawCluster } from "./cluster.js";
import { assessRisk, concentration, DEFAULT_RISK, type RiskThresholds } from "./risk.js";
import { potentialOf } from "./potential.js";
import { detectConvergence, DEFAULT_CONVERGENCE, type ConvergenceOptions } from "../smart/convergence.js";
import { matchBuyers, type SmartWallet } from "../smart/registry.js";

export interface VerdictOptions {
  risk: RiskThresholds;
  convergence: ConvergenceOptions;
  smartIndex: Map<string, SmartWallet>;
  /** A deployer with this many launches and no graduation is a farm. */
  serialLaunches: number;
}

export const DEFAULT_VERDICT_OPTIONS: VerdictOptions = {
  risk: DEFAULT_RISK,
  convergence: DEFAULT_CONVERGENCE,
  smartIndex: new Map(),
  serialLaunches: 5,
};

/**
 * Does the first born look like the operator's own bait?
 *
 * Any single one of these is common enough to be innocent. Two together is the
 * pattern, and the caller gets the list so the output can say which two.
 */
export function taintOf(
  record: LaunchRecord,
  cluster: readonly LaunchRecord[],
  options: VerdictOptions,
): { tainted: boolean; grounds: string[] } {
  const grounds: string[] = [];

  if (record.devSharePct > options.risk.taintDevSharePct) {
    grounds.push(`dev buy ${record.devSharePct.toFixed(2)}%`);
  }
  if (record.exemptWallets >= options.risk.taintExemptWallets) {
    grounds.push(`${record.exemptWallets} wallets exempt from the opening tax`);
  }
  const dep = record.deployerRecord;
  if (dep && dep.priorLaunches >= options.serialLaunches && dep.graduated === 0) {
    grounds.push(`deployer has ${dep.priorLaunches} launches and no graduation`);
  }
  if (record.holders?.complete && concentration(record.holders) >= options.risk.redPct) {
    grounds.push(`top 10 hold ${concentration(record.holders).toFixed(1)}%`);
  }

  // The heaviest ground of all: the same hand launched the copies. Randomised
  // dev buys and shuffled taxes do not hide a shared funding wallet.
  const funder = record.deployerRecord?.fundedBy?.toLowerCase();
  if (funder) {
    const siblings = cluster.filter(
      (other) =>
        other.token !== record.token &&
        other.deployerRecord?.fundedBy?.toLowerCase() === funder,
    );
    if (siblings.length >= 1) {
      grounds.push(
        `${siblings.length} other launch(es) in this cluster were funded from the same wallet`,
      );
    }
  }

  return { tainted: grounds.length >= 2, grounds };
}

/** Is anything happening on this launch at all? */
function isDead(record: LaunchRecord): boolean {
  if (record.phase === 2) return false;
  const noBuyers = (record.uniqueEarlyBuyers ?? 0) <= 1;
  const flatCurve = record.curveProgress <= 0.01;
  return noBuyers && flatCurve;
}

/**
 * Turn a raw name cluster into the table novamp prints.
 *
 * One pass to assess every member on its own, one pass to decide the labels
 * relative to each other, because CONTESTED only exists in relation to the
 * first born.
 */
export function judgeCluster(
  raw: RawCluster,
  options: VerdictOptions = DEFAULT_VERDICT_OPTIONS,
): Cluster {
  const records = raw.members.map((m) => m.record);
  const first = records[0]!;
  const notes: string[] = [];

  const taint = taintOf(first, records, options);
  if (taint.tainted) {
    notes.push(`first born is suspect: ${taint.grounds.join("; ")}`);
  }

  const assessments: Assessment[] = raw.members.map((member, index) => {
    const record = member.record;
    const rank = index + 1;
    const lagSec = Math.max(0, record.launchedAt - first.launchedAt);
    const matched = matchBuyers(record.buyers, options.smartIndex);
    const convergence = detectConvergence(matched, options.convergence);
    const top10 = record.holders?.complete ? concentration(record.holders) : null;

    const { score, reasons } = potentialOf({
      record,
      rank,
      clusterSize: raw.members.length,
      lagSec,
      convergence,
      firstBornTainted: taint.tainted,
      top10Pct: top10,
    });

    const { level, flags } = assessRisk(record, options.risk);

    if (member.joinedBy !== "exact") {
      const how =
        member.joinedBy === "tight"
          ? `symbol matches ${raw.label} after folding lookalike characters (${member.keys.foldedChars.join(" ") || "case"})`
          : member.joinedBy === "name"
            ? `different symbol, same token name as ${raw.label}: "${first.name}"`
            : `matches ${raw.label} loosely`;
      flags.push({ level: "AMBER", code: "name-fold", text: how });
    }
    if (member.keys.hasHiddenChars && rank > 1) {
      flags.push({
        level: "RED",
        code: "hidden-chars",
        text: "the symbol contains characters that do not render as what they look like",
      });
    }

    return {
      record,
      rank,
      lagSec,
      verdict: "VAMP" as TokenVerdict, // rewritten below
      potential: score,
      reasons,
      risk: level,
      flags,
      smartWallets: convergence.count,
      converged: convergence.converged,
    };
  });

  // --- second pass: labels relative to the first born ----------------------
  const firstAssessment = assessments[0]!;
  firstAssessment.verdict = taint.tainted ? "TAINTED" : "ORIGINAL";
  if (isDead(first) && !taint.tainted) firstAssessment.verdict = "DEAD";

  // Who actually has the money, ignoring the first born.
  const challengers = assessments.slice(1);
  const leader = challengers
    .filter((a) => !isDead(a.record))
    .sort((a, b) =>
      b.smartWallets - a.smartWallets ||
      (b.record.uniqueEarlyBuyers ?? 0) - (a.record.uniqueEarlyBuyers ?? 0) ||
      b.potential - a.potential,
    )[0];

  for (const assessment of challengers) {
    assessment.verdict = isDead(assessment.record) ? "DEAD" : "VAMP";
  }

  if (leader && taint.tainted) {
    const meaningful = leader.converged || leader.smartWallets >= 2 || leader.potential >= 65;
    if (meaningful) {
      leader.verdict = "CONTESTED";
      notes.push(
        `flow is on ${leader.record.symbol} (rank ${leader.rank}), not on the first born`,
      );
    }
  }

  let clusterVerdict: ClusterVerdict;
  if (assessments.length === 1) clusterVerdict = "SOLO";
  else if (challengers.some((a) => a.verdict === "CONTESTED")) clusterVerdict = "CONTESTED";
  else clusterVerdict = "CLEAN";

  // One operator behind several members outranks everything else.
  const funders = new Map<string, number>();
  for (const record of records) {
    const funder = record.deployerRecord?.fundedBy?.toLowerCase();
    if (!funder) continue;
    funders.set(funder, (funders.get(funder) ?? 0) + 1);
  }
  const sharedFunder = [...funders.entries()].find(([, count]) => count >= 2);
  if (sharedFunder && assessments.length > 1) {
    clusterVerdict = "FARM";
    notes.push(
      `${sharedFunder[1]} launches in this cluster were funded from ${sharedFunder[0].slice(0, 10)}…: one operator, several wallets`,
    );
  }

  const vampLagSec = records.length > 1 ? Math.max(0, records[1]!.launchedAt - first.launchedAt) : null;

  return {
    key: raw.key,
    label: raw.label,
    verdict: clusterVerdict,
    members: assessments,
    vampLagSec,
    vampRatio: assessments.length - 1,
    notes,
  };
}
