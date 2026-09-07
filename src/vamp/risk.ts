/**
 * Holder concentration and the flags that come off it.
 *
 * The subtle part is what you exclude. On pons v2 the bonding curve holds the
 * unsold supply, and after graduation the Uniswap v4 pool holds the float. Both
 * are contracts, both are enormous, and a top-holder table that leaves them in
 * says every launch on the chain is 90 % held by one wallet, which is true and
 * useless. novamp labels them and takes them out of the percentages.
 *
 * The deployer is a different case: it is excluded from the *contract* set but
 * kept in the concentration number, because a deployer sitting on 24 % is
 * exactly the thing the number exists to warn you about.
 */

import type { HolderSnapshot, LaunchRecord, RiskFlag, RiskLevel } from "../types.js";

export interface RiskThresholds {
  amberPct: number;
  redPct: number;
  taintDevSharePct: number;
  taintExemptWallets: number;
}

export const DEFAULT_RISK: RiskThresholds = {
  amberPct: 20,
  redPct: 30,
  taintDevSharePct: 10,
  taintExemptWallets: 4,
};

/** Addresses that are plumbing, not holders. */
export function isContractHolder(label?: string): boolean {
  return label === "curve" || label === "pool" || label === "escrow" || label === "burn";
}

/** Recompute top-10 concentration from a snapshot, ignoring plumbing. */
export function concentration(snapshot: HolderSnapshot): number {
  return snapshot.top
    .filter((slice) => !isContractHolder(slice.label))
    .slice(0, 10)
    .reduce((sum, slice) => sum + slice.pct, 0);
}

function worst(a: RiskLevel, b: RiskLevel): RiskLevel {
  const order: RiskLevel[] = ["UNKNOWN", "GREEN", "AMBER", "RED"];
  return order.indexOf(a) >= order.indexOf(b) ? a : b;
}

/**
 * Every risk flag novamp raises, with the level it raises it at.
 *
 * These describe measurements, not intent. A deployer holding 30 % may be a
 * long-term holder and a top-10 at 45 % may be four exchanges. The flag says
 * what was measured; the decision is still yours.
 */
export function assessRisk(
  record: LaunchRecord,
  thresholds: RiskThresholds = DEFAULT_RISK,
): { level: RiskLevel; flags: RiskFlag[] } {
  const flags: RiskFlag[] = [];
  let level: RiskLevel = "GREEN";

  const holders = record.holders;
  if (!holders || !holders.complete) {
    level = "UNKNOWN";
    flags.push({
      level: "UNKNOWN",
      code: "holders-unread",
      text: holders
        ? "holder scan stopped early, concentration is a floor not a total"
        : "no holder scan on this launch",
    });
  } else {
    const top10 = concentration(holders);
    if (top10 >= thresholds.redPct) {
      level = worst(level, "RED");
      flags.push({
        level: "RED",
        code: "top10-concentration",
        text: `top 10 wallets hold ${top10.toFixed(1)}% of the float, over the ${thresholds.redPct}% line`,
      });
    } else if (top10 >= thresholds.amberPct) {
      level = worst(level, "AMBER");
      flags.push({
        level: "AMBER",
        code: "top10-concentration",
        text: `top 10 wallets hold ${top10.toFixed(1)}% of the float`,
      });
    } else {
      flags.push({
        level: "GREEN",
        code: "top10-concentration",
        text: `top 10 wallets hold ${top10.toFixed(1)}% of the float`,
      });
    }

    if (holders.deployerPct >= thresholds.redPct) {
      level = worst(level, "RED");
      flags.push({
        level: "RED",
        code: "deployer-holding",
        text: `deployer still holds ${holders.deployerPct.toFixed(1)}% of supply`,
      });
    } else if (holders.deployerPct >= thresholds.taintDevSharePct) {
      level = worst(level, "AMBER");
      flags.push({
        level: "AMBER",
        code: "deployer-holding",
        text: `deployer holds ${holders.deployerPct.toFixed(1)}% of supply`,
      });
    }
  }

  if (record.exemptWallets >= thresholds.taintExemptWallets) {
    level = worst(level, "RED");
    flags.push({
      level: "RED",
      code: "declared-bundle",
      text: `${record.exemptWallets} wallets were declared exempt from the opening tax at launch`,
    });
  } else if (record.exemptWallets > 0) {
    level = worst(level, "AMBER");
    flags.push({
      level: "AMBER",
      code: "declared-bundle",
      text: `${record.exemptWallets} wallet(s) exempt from the opening tax`,
    });
  }

  if (record.creatorTaxBps > 500) {
    level = worst(level, "RED");
    flags.push({
      level: "RED",
      code: "creator-tax",
      text: `creator tax ${(record.creatorTaxBps / 100).toFixed(2)}%, traders pay it on both sides`,
    });
  } else if (record.creatorTaxBps > 200) {
    level = worst(level, "AMBER");
    flags.push({
      level: "AMBER",
      code: "creator-tax",
      text: `creator tax ${(record.creatorTaxBps / 100).toFixed(2)}%`,
    });
  }

  if (record.creatorFeeRecipient.toLowerCase() !== record.deployer.toLowerCase()) {
    flags.push({
      level: "AMBER",
      code: "fees-routed",
      text: "creator fees are paid to an address that is not the deployer",
    });
    level = worst(level, "AMBER");
  }

  const dep = record.deployerRecord;
  if (dep && dep.priorLaunches >= 5 && dep.graduated === 0) {
    level = worst(level, "RED");
    flags.push({
      level: "RED",
      code: "serial-deployer",
      text: `deployer has ${dep.priorLaunches} launches in the window and none graduated`,
    });
  }

  return { level, flags };
}
