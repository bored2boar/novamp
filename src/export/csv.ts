/**
 * Getting the numbers out, so somebody can argue with them properly.
 *
 * The scoring in novamp is a set of opinions with the arithmetic written down.
 * The useful response to that is not agreement, it is somebody re-running the
 * same rows against their own weights and telling me where mine are wrong. That
 * requires the rows, in a format a spreadsheet opens without ceremony.
 *
 * No dependency for this. RFC 4180 quoting is fifteen lines and a CSV writer
 * pulled off npm is a supply chain risk for fifteen lines.
 */

import type { Cluster } from "../types.js";
import type { Farm } from "../vamp/farms.js";

/** Quote a field only when it needs it, escaping embedded quotes by doubling. */
export function csvField(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

export function csvRows(rows: readonly unknown[][]): string {
  return rows.map((row) => row.map(csvField).join(",")).join("\n") + "\n";
}

export const CLUSTER_COLUMNS = [
  "cluster_key",
  "cluster_verdict",
  "rank",
  "symbol",
  "name",
  "verdict",
  "score",
  "risk",
  "lag_sec",
  "token",
  "deployer",
  "funded_by",
  "block",
  "launched_at",
  "phase",
  "dev_share_pct",
  "exempt_wallets",
  "creator_tax_bps",
  "fees_to_deployer",
  "top10_pct",
  "top10_complete",
  "early_buyers",
  "smart_wallets",
  "converged",
  "curve_progress",
  "socials",
  "reasons",
  "flags",
] as const;

export function clusterToCsv(cluster: Cluster): string {
  const rows: unknown[][] = [[...CLUSTER_COLUMNS]];
  for (const member of cluster.members) {
    const record = member.record;
    rows.push([
      cluster.key,
      cluster.verdict,
      member.rank,
      record.symbol,
      record.name,
      member.verdict,
      member.potential,
      member.risk,
      Math.round(member.lagSec),
      record.token,
      record.deployer,
      record.deployerRecord?.fundedBy ?? "",
      record.block,
      record.launchedAt,
      record.phase,
      record.devSharePct,
      record.exemptWallets,
      record.creatorTaxBps,
      record.creatorFeeRecipient.toLowerCase() === record.deployer.toLowerCase(),
      record.holders?.complete ? record.holders.top10Pct.toFixed(2) : "",
      record.holders?.complete ?? false,
      record.uniqueEarlyBuyers ?? "",
      member.smartWallets,
      member.converged,
      record.curveProgress.toFixed(4),
      [record.socials.twitter, record.socials.website, record.socials.telegram]
        .filter(Boolean)
        .join(" "),
      // Reasons and flags carry the "why" into the spreadsheet, which is the
      // whole point: a row without its reasoning is just a number again.
      member.reasons.map((r) => `${r.points >= 0 ? "+" : ""}${r.points} ${r.text}`).join("; "),
      member.flags.map((f) => `${f.level} ${f.code}: ${f.text}`).join("; "),
    ]);
  }
  return csvRows(rows);
}

export const FARM_COLUMNS = [
  "deployer",
  "launches",
  "copies",
  "originals",
  "graduated",
  "names_touched",
  "median_lag_sec",
  "funded_by",
  "sibling_wallets",
] as const;

export function farmsToCsv(farms: readonly Farm[]): string {
  const rows: unknown[][] = [[...FARM_COLUMNS]];
  for (const farm of farms) {
    rows.push([
      farm.deployer,
      farm.launches,
      farm.copies,
      farm.originals,
      farm.graduated,
      farm.namesTouched,
      Math.round(farm.medianLagSec),
      farm.fundedBy ?? "",
      farm.siblings,
    ]);
  }
  return csvRows(rows);
}
