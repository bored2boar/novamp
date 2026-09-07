/**
 * `novamp wallet <address>` - how many of your own positions are copies.
 *
 * Every other command in here asks a question about the market. This one asks a
 * question about you, and it is the one that changes behaviour, because reading
 * "4 of your 9 positions are vamps, and here are the originals" lands somewhere
 * a general statistic never reaches.
 *
 * It reads. It cannot sell anything for you, and there is no code path here that
 * could.
 */

import { clusterLaunches } from "../vamp/cluster.js";
import { judgeCluster } from "../vamp/verdict.js";
import { positionsFromFixtures, readWalletPositions, type WalletScan } from "../read/wallet.js";
import { makeContext } from "./context.js";
import { renderSourceLine } from "../ui/render.js";
import { renderTable } from "../ui/table.js";
import { bold, cyan, dim, green, grey, red, riskColor, verdictColor, yellow } from "../ui/color.js";
import { duration, shortAddress } from "../util/fmt.js";
import { describeWindow } from "../util/window.js";
import { fail, info } from "../util/log.js";
import type { Address, Assessment, Cluster } from "../types.js";

export interface WalletOptions {
  demo?: boolean;
  since?: string;
  json?: boolean;
}

interface Holding {
  assessment: Assessment;
  cluster: Cluster;
  /** The launch that should have been bought instead, when there is one. */
  shouldHaveBeen: Assessment | null;
}

export async function wallet(address: string, opts: WalletOptions): Promise<number> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    fail(`"${address}" is not an address.`);
    return 1;
  }
  const target = address as Address;
  const ctx = await makeContext({ demo: opts.demo, since: opts.since });

  if (!opts.json) {
    process.stdout.write(`\n${renderSourceLine(ctx.source.kind, ctx.source.describe)}\n`);
    if (ctx.source.kind === "demo") {
      process.stdout.write(
        `${yellow("demo mode")} ${dim("fixture data: a wallet counts as holding anything it bought early")}\n`,
      );
    }
  }

  const launches = await ctx.launches();
  if (!launches.length) {
    fail("no launches in the window to check this wallet against.");
    return 1;
  }

  let scan: WalletScan;
  if (ctx.live) {
    info(`checking ${launches.length} launches for a balance. This takes a while on a public RPC.`);
    scan = await readWalletPositions(ctx.live.client, ctx.live.gate, target, launches);
  } else {
    scan = positionsFromFixtures(target, launches);
  }

  if (!scan.positions.length) {
    process.stdout.write(
      `\n${bold(shortAddress(target))} holds none of the ${scan.checked} launches in this window.\n` +
        dim("  A position older than the window is invisible here. Widen it with --since.\n\n"),
    );
    return 0;
  }

  // Cluster the whole window once, then locate each position inside it. Judging
  // each position's cluster separately would re-do the same work per holding.
  const clusters = clusterLaunches(launches).map((raw) => judgeCluster(raw, ctx.verdictOptions));

  const holdings: Holding[] = [];
  for (const position of scan.positions) {
    const cluster = clusters.find((c) =>
      c.members.some((m) => m.record.token === position.record.token),
    );
    if (!cluster) continue;
    const assessment = cluster.members.find((m) => m.record.token === position.record.token)!;
    const better =
      assessment.verdict === "VAMP" || assessment.verdict === "DEAD"
        ? (cluster.members.find((m) => m.verdict === "ORIGINAL" || m.verdict === "CONTESTED") ?? null)
        : null;
    holdings.push({ assessment, cluster, shouldHaveBeen: better });
  }

  const copies = holdings.filter(
    (h) => h.assessment.verdict === "VAMP" || h.assessment.verdict === "DEAD",
  );

  if (opts.json) {
    process.stdout.write(
      JSON.stringify(
        {
          wallet: target,
          checked: scan.checked,
          complete: scan.complete,
          positions: holdings.length,
          copies: copies.length,
          holdings: holdings.map((h) => ({
            symbol: h.assessment.record.symbol,
            token: h.assessment.record.token,
            verdict: h.assessment.verdict,
            rank: h.assessment.rank,
            clusterSize: h.cluster.members.length,
            score: h.assessment.potential,
            risk: h.assessment.risk,
            original: h.shouldHaveBeen
              ? { symbol: h.shouldHaveBeen.record.symbol, token: h.shouldHaveBeen.record.token }
              : null,
          })),
        },
        null,
        2,
      ) + "\n",
    );
    return 0;
  }

  const headline =
    copies.length === 0
      ? green(`none of your ${holdings.length} position(s) is a copy`)
      : red(`${copies.length} of your ${holdings.length} position(s) ${copies.length === 1 ? "is a copy" : "are copies"}`);

  process.stdout.write(
    `\n${bold(shortAddress(target, 10, 6))}  ${headline}` +
      dim(`  · checked ${scan.checked} launches · window ${describeWindow(ctx.windowSec)}`) +
      "\n\n",
  );

  // Copies first: the reason someone runs this command is the bad news, and
  // burying it under three clean rows is the one layout mistake worth avoiding.
  const order = (h: Holding) =>
    h.assessment.verdict === "VAMP" ? 0
    : h.assessment.verdict === "DEAD" ? 1
    : h.assessment.verdict === "CONTESTED" ? 2
    : h.assessment.verdict === "TAINTED" ? 3
    : 4;
  const rows = [...holdings]
    .sort((a, b) => order(a) - order(b) || a.assessment.record.symbol.localeCompare(b.assessment.record.symbol))
    .map((h) => [
    h.assessment.rank === 1 ? bold(h.assessment.record.symbol) : h.assessment.record.symbol,
    verdictColor(h.assessment.verdict)(h.assessment.verdict),
    `#${h.assessment.rank}/${h.cluster.members.length}`,
    h.assessment.rank === 1 ? dim("first") : `+${duration(h.assessment.lagSec)}`,
    String(h.assessment.potential),
    riskColor(h.assessment.risk)(h.assessment.risk === "UNKNOWN" ? "?" : h.assessment.risk),
    h.shouldHaveBeen
      ? `${cyan("→")} ${bold(h.shouldHaveBeen.record.symbol)} ${dim(shortAddress(h.shouldHaveBeen.record.token, 8, 4))}`
      : grey("-"),
    ]);

  process.stdout.write(
    renderTable(
      [
        { header: "you hold", width: 16 },
        { header: "verdict", width: 10 },
        { header: "rank", width: 7 },
        { header: "lag", width: 8, align: "right" },
        { header: "score", width: 5, align: "right" },
        { header: "risk", width: 6 },
        { header: "the one you meant", width: 32 },
      ],
      rows,
    ) + "\n",
  );

  if (!scan.complete) {
    process.stdout.write(
      `\n${yellow("!")} some balance reads failed, so this list is a floor rather than a total.\n`,
    );
  }
  process.stdout.write(
    dim(
      "\nA position in a launch older than the window is invisible here. Nothing in novamp\n" +
        "can sell anything for you; this is a read.\n\n",
    ),
  );
  return 0;
}
