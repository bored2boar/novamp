/**
 * `novamp farms` - who is producing the copies.
 *
 * Every other command answers a question about one name. This one turns the
 * index around and asks who keeps showing up on the wrong side of them.
 *
 * The columns are counts, not accusations. A deployer with forty copies and no
 * graduations speaks for itself.
 */

import { writeFile } from "node:fs/promises";
import { clusterLaunches } from "../vamp/cluster.js";
import { judgeCluster } from "../vamp/verdict.js";
import { rankFarms, worstOffenders } from "../vamp/farms.js";
import { farmsToCsv } from "../export/csv.js";
import { makeContext } from "./context.js";
import { renderSourceLine } from "../ui/render.js";
import { renderTable } from "../ui/table.js";
import { bold, dim, green, grey, red, yellow } from "../ui/color.js";
import { duration, shortAddress } from "../util/fmt.js";
import { describeWindow } from "../util/window.js";

export interface FarmsOptions {
  demo?: boolean;
  since?: string;
  top?: number;
  json?: boolean;
  /** Write the full ranking to this path as CSV. */
  csv?: string;
  /** Only operators with at least this many copies. */
  minCopies?: number;
}

export async function farms(opts: FarmsOptions): Promise<number> {
  const ctx = await makeContext({ demo: opts.demo, since: opts.since });
  const launches = await ctx.launches();
  const clusters = clusterLaunches(launches).map((raw) => judgeCluster(raw, ctx.verdictOptions));
  const ranked = rankFarms(clusters);
  const offenders = worstOffenders(ranked, opts.minCopies ?? 2);

  if (opts.csv) {
    await writeFile(opts.csv, farmsToCsv(ranked), "utf8");
  }

  if (opts.json) {
    process.stdout.write(JSON.stringify(ranked.slice(0, opts.top ?? 25), null, 2) + "\n");
    return 0;
  }

  process.stdout.write(`\n${renderSourceLine(ctx.source.kind, ctx.source.describe)}\n`);
  if (ctx.source.kind === "demo") {
    process.stdout.write(`${yellow("demo mode")} ${dim("fixture data, not chain-wide numbers")}\n`);
  }

  const totalCopies = ranked.reduce((sum, farm) => sum + farm.copies, 0);
  process.stdout.write(
    `\n${bold("operators")} ${dim(
      `· ${ranked.length} deployers · ${totalCopies} copies · window ${describeWindow(ctx.windowSec)}`,
    )}\n\n`,
  );

  const shown = ranked.filter((f) => f.copies >= (opts.minCopies ?? 1)).slice(0, opts.top ?? 15);
  if (!shown.length) {
    process.stdout.write(dim("nobody in this window produced a copy.\n\n"));
    return 0;
  }

  process.stdout.write(
    renderTable(
      [
        { header: "deployer", width: 16 },
        { header: "copies", width: 7, align: "right" },
        { header: "names", width: 6, align: "right" },
        { header: "originals", width: 10, align: "right" },
        { header: "graduated", width: 10, align: "right" },
        { header: "median lag", width: 11, align: "right" },
        { header: "sibling wallets", width: 16, align: "right" },
      ],
      shown.map((farm) => [
        shortAddress(farm.deployer),
        farm.copies ? red(String(farm.copies)) : dim("0"),
        String(farm.namesTouched),
        String(farm.originals),
        farm.graduated ? green(String(farm.graduated)) : grey("0"),
        farm.medianLagSec ? duration(farm.medianLagSec) : dim("-"),
        farm.siblings ? red(`${farm.siblings} same funder`) : dim("-"),
      ]),
    ) + "\n",
  );

  if (offenders.length) {
    process.stdout.write(
      `\n${red("→")} ${offenders.length} operator(s) produced ${offenders.reduce((s, f) => s + f.copies, 0)} copies ` +
        `and graduated nothing.\n`,
    );
  }
  if (opts.csv) {
    process.stdout.write(`${green("✓")} full ranking written to ${opts.csv}\n`);
  }
  process.stdout.write(
    dim(
      "\ncopies are launches that were not first under their name. These are counts, not\n" +
        "accusations: a deployer may have simply liked the same joke.\n\n",
    ),
  );
  return 0;
}
