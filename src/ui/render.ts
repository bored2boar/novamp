/**
 * Turning an assessed cluster into the thing you actually look at.
 *
 * The rule the layout follows: the answer is the first row, the reason is on the
 * same line, and nothing is hidden behind a flag except detail nobody needs on
 * every run. `--all` opens every member up in full.
 */

import type { Assessment, Cluster } from "../types.js";
import { renderPairs, renderTable, type Column } from "./table.js";
import { bold, cyan, dim, green, grey, red, riskColor, verdictColor } from "./color.js";
import { duration, ether, iso, pct, shortAddress } from "../util/fmt.js";
import { byUsefulness } from "../vamp/potential.js";

const COLUMNS: Column[] = [
  { header: "#", width: 3, align: "right" },
  { header: "symbol", width: 16 },
  { header: "verdict", width: 10 },
  { header: "score", width: 5, align: "right" },
  { header: "risk", width: 6 },
  { header: "lag", width: 7, align: "right" },
  { header: "top10", width: 6, align: "right" },
  { header: "dev", width: 6, align: "right" },
  { header: "smart", width: 6, align: "right" },
  { header: "buyers", width: 6, align: "right" },
  { header: "token", width: 14 },
];

function row(assessment: Assessment): string[] {
  const record = assessment.record;
  const top10 = record.holders?.complete ? pct(record.holders.top10Pct, 0) : dim("?");
  const smart = assessment.smartWallets
    ? assessment.converged
      ? bold(`${assessment.smartWallets}★`)
      : `${assessment.smartWallets}`
    : dim("0");
  return [
    String(assessment.rank),
    assessment.rank === 1 ? bold(record.symbol) : record.symbol,
    verdictColor(assessment.verdict)(assessment.verdict),
    String(assessment.potential),
    riskColor(assessment.risk)(assessment.risk === "UNKNOWN" ? "?" : assessment.risk),
    assessment.rank === 1 ? dim("first") : `+${duration(assessment.lagSec)}`,
    top10,
    pct(record.devSharePct, 1),
    smart,
    record.uniqueEarlyBuyers === undefined ? dim("?") : String(record.uniqueEarlyBuyers),
    dim(shortAddress(record.token, 8, 4)),
  ];
}

export function renderCluster(cluster: Cluster, options: { all?: boolean } = {}): string {
  const out: string[] = [];
  const ordered = [...cluster.members].sort(byUsefulness);

  out.push("");
  out.push(
    `${bold(cluster.label)} ${dim(`· key "${cluster.key}"`)}  ${verdictColor(cluster.verdict)(cluster.verdict)}`,
  );
  const copies = cluster.members.length - 1;
  out.push(
    dim(
      `${cluster.members.length} launch(es) under this name · ${copies} cop${copies === 1 ? "y" : "ies"}` +
        (cluster.vampLagSec === null
          ? ""
          : ` · first copy ${duration(cluster.vampLagSec)} after the original`),
    ),
  );
  out.push("");
  out.push(renderTable(COLUMNS, ordered.map(row)));

  if (cluster.notes.length) {
    out.push("");
    for (const note of cluster.notes) out.push(`${cyan("→")} ${note}`);
  }

  const headline = ordered[0];
  if (headline) {
    out.push("");
    out.push(dim(`why ${headline.record.symbol} scores ${headline.potential}:`));
    for (const reason of headline.reasons) {
      if (reason.points === 0) continue;
      const sign = reason.points > 0 ? `+${reason.points}` : `${reason.points}`;
      out.push(`  ${reason.points > 0 ? sign : grey(sign)}  ${reason.text}`);
    }
    if (headline.flags.length) {
      out.push("");
      for (const flag of headline.flags) {
        out.push(`  ${riskColor(flag.level)("●")} ${flag.text}`);
      }
    }
  }

  if (options.all) {
    for (const assessment of ordered.slice(1)) {
      out.push("");
      out.push(renderMember(assessment));
    }
  } else if (ordered.length > 1) {
    out.push("");
    out.push(dim(`${ordered.length - 1} more member(s). Add --all for the full breakdown.`));
  }

  out.push("");
  return out.join("\n");
}

export function renderMember(assessment: Assessment): string {
  const record = assessment.record;
  const out: string[] = [];
  out.push(
    `${bold(record.symbol)} ${dim(record.name)}  ${verdictColor(assessment.verdict)(assessment.verdict)} ${dim(
      `score ${assessment.potential}`,
    )}`,
  );
  out.push(
    renderPairs([
      ["token", record.token],
      ["curve", record.curve],
      ["deployer", record.deployer],
      ["launched", `${iso(record.launchedAt)}  block ${record.block}`],
      ["birth order", assessment.rank === 1 ? "first" : `#${assessment.rank}, +${duration(assessment.lagSec)}`],
      ["phase", ["curve", "swept", "pool", "rescued"][record.phase] ?? "?"],
      ["curve filled", pct(record.curveProgress * 100, 1)],
      ["reserve", `${ether(record.quoteReserveWei)} ${record.pairSymbol || ""}`.trim()],
      ["creator tax", pct(record.creatorTaxBps / 100, 2)],
      [
        "fees to",
        record.creatorFeeRecipient.toLowerCase() === record.deployer.toLowerCase()
          ? dim("the deployer")
          : `${shortAddress(record.creatorFeeRecipient)} (not the deployer)`,
      ],
      ["dev share", pct(record.devSharePct, 2)],
      ["exempt wallets", String(record.exemptWallets)],
      [
        "top 10",
        record.holders?.complete
          ? pct(record.holders.top10Pct, 1)
          : dim("unread or incomplete"),
      ],
      ["early buyers", record.uniqueEarlyBuyers === undefined ? dim("unread") : String(record.uniqueEarlyBuyers)],
      [
        "early money in",
        record.flow?.complete
          ? `${ether(record.flow.quoteInWei)} ${record.pairSymbol || ""}`.trim() +
            dim(`  top 3 are ${(record.flow.top3Share * 100).toFixed(0)}%`)
          : dim("unread"),
      ],
      [
        "sell side",
        !record.sellActivity?.complete
          ? dim("unread")
          : record.sellActivity.sells.length === 0
            ? green("nothing has sold yet")
            : [
                `${record.sellActivity.sells.length} sale(s)`,
                record.sellActivity.deployerSold
                  ? red(`deployer sold at ${duration(record.sellActivity.deployerSoldAtSec ?? 0)}`)
                  : "deployer has not sold",
                record.sellActivity.firstBigSellSec !== null
                  ? `biggest took ${(record.sellActivity.largestShare * 100).toFixed(0)}% at ${duration(record.sellActivity.firstBigSellSec)}`
                  : "none of them large",
              ].join(dim(" · ")),
      ],
      [
        "proven wallets",
        assessment.smartWallets
          ? `${assessment.smartWallets}${assessment.converged ? " (converged)" : ""}`
          : dim("none"),
      ],
      [
        "socials",
        [record.socials.twitter, record.socials.website, record.socials.telegram]
          .filter(Boolean)
          .join("  ") || dim("none"),
      ],
    ]),
  );
  if (assessment.flags.length) {
    out.push("");
    for (const flag of assessment.flags) out.push(`  ${riskColor(flag.level)("●")} ${flag.text}`);
  }
  return out.join("\n");
}

/** The banner every command prints, so nobody wonders where the numbers came from. */
export function renderSourceLine(kind: "live" | "demo", describe: string): string {
  return kind === "demo"
    ? `${dim("source")} ${bold("demo")} ${dim(describe)}`
    : `${dim("source")} ${bold("live")} ${dim(describe)}`;
}
