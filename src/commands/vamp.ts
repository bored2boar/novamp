/**
 * `novamp vamp <name>` - the command the whole tool exists for.
 *
 * Give it a ticker, a name or a narrative word. It finds every launch fighting
 * over that name, works out which one was first, decides whether being first
 * still means anything here, and prints the lot with the reasoning attached.
 */

import { writeFile } from "node:fs/promises";
import { findCluster } from "../vamp/cluster.js";
import { clusterToCsv } from "../export/csv.js";
import { judgeCluster } from "../vamp/verdict.js";
import { renderCluster, renderSourceLine } from "../ui/render.js";
import { makeContext } from "./context.js";
import { fail, info } from "../util/log.js";
import { dim, green, yellow } from "../ui/color.js";

export interface VampOptions {
  demo?: boolean;
  since?: string;
  all?: boolean;
  json?: boolean;
  /** Skip the expensive second pass. Faster, and the score says so. */
  shallow?: boolean;
  /** Write the cluster to this path as CSV, reasons and flags included. */
  csv?: string;
}

export async function vamp(query: string, opts: VampOptions): Promise<number> {
  const ctx = await makeContext({ demo: opts.demo, since: opts.since });
  if (!opts.json) {
    process.stdout.write(`\n${renderSourceLine(ctx.source.kind, ctx.source.describe)}\n`);
    if (ctx.source.kind === "demo") {
      process.stdout.write(
        `${yellow("demo mode")} ${dim("fixture data, not a live read of Robinhood Chain")}\n`,
      );
    }
  }

  const all = await ctx.launches();
  if (all.length === 0) {
    fail("no launches in the window. With --demo, check that fixtures/clusters has files.");
    return 1;
  }

  const raw = findCluster(all, query);
  if (!raw) {
    fail(`nothing launched under a name like "${query}" in this window.`);
    return 1;
  }

  if (ctx.live && !opts.shallow) {
    info(`reading holders, buyers and funding for ${raw.members.length} launch(es)`);
    await ctx.live.deepen(
      raw.members.map((m) => m.record),
      { funding: raw.members.length > 1 },
    );
  }

  const cluster = judgeCluster(raw, ctx.verdictOptions);

  if (opts.csv) {
    await writeFile(opts.csv, clusterToCsv(cluster), "utf8");
    if (!opts.json) process.stdout.write(`${green("✓")} ${cluster.members.length} rows written to ${opts.csv}\n`);
  }

  if (opts.json) {
    process.stdout.write(JSON.stringify(cluster, null, 2) + "\n");
    return 0;
  }

  process.stdout.write(renderCluster(cluster, { all: opts.all }));
  return 0;
}
