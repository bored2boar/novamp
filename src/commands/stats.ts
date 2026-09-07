/**
 * `novamp stats` - two numbers about the chain rather than about one token.
 *
 *   VAMP RATIO  copies per original in the window
 *   VAMP LAG    how long an original gets before the first copy lands
 *
 * Both come out of the same clustering pass the rest of the tool uses, so they
 * cost nothing extra, and both are the kind of number that is interesting mostly
 * as a series. A ratio of 8 means little on its own; a ratio that went from 3 to
 * 8 over a month means the farms found this chain.
 */

import { clusterLaunches, contestedOnly } from "../vamp/cluster.js";
import { makeContext } from "./context.js";
import { renderSourceLine } from "../ui/render.js";
import { renderPairs, renderTable } from "../ui/table.js";
import { bold, dim, yellow } from "../ui/color.js";
import { duration } from "../util/fmt.js";

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export async function stats(opts: {
  demo?: boolean;
  json?: boolean;
  top?: number;
  since?: string;
}): Promise<number> {
  const ctx = await makeContext({ demo: opts.demo, since: opts.since });
  const all = await ctx.launches();
  const clusters = clusterLaunches(all);
  const contested = contestedOnly(clusters);

  const originals = clusters.length;
  const copies = all.length - originals;
  const lags = contested.map((c) => Math.max(0, c.members[1]!.record.launchedAt - c.members[0]!.record.launchedAt));

  const summary: [string, string][] = [
    ["launches in window", String(all.length)],
    ["distinct names", String(originals)],
    ["copies", String(copies)],
    ["vamp ratio", bold((copies / Math.max(1, originals)).toFixed(2))],
    ["contested names", `${contested.length} (${((contested.length / Math.max(1, originals)) * 100).toFixed(1)}% of names)`],
    ["median vamp lag", lags.length ? bold(duration(median(lags))) : dim("no copies in window")],
    ["fastest copy", lags.length ? duration(Math.min(...lags)) : dim("-")],
  ];

  if (opts.json) {
    process.stdout.write(
      JSON.stringify(
        {
          launches: all.length,
          names: originals,
          copies,
          vampRatio: copies / Math.max(1, originals),
          contestedNames: contested.length,
          medianVampLagSec: lags.length ? median(lags) : null,
          fastestVampLagSec: lags.length ? Math.min(...lags) : null,
        },
        null,
        2,
      ) + "\n",
    );
    return 0;
  }

  process.stdout.write(`\n${renderSourceLine(ctx.source.kind, ctx.source.describe)}\n`);
  if (ctx.source.kind === "demo") {
    process.stdout.write(`${yellow("demo mode")} ${dim("fixture data, these are not chain-wide numbers")}\n`);
  }
  process.stdout.write(`\n${bold("chain shape")}\n\n${renderPairs(summary)}\n`);

  const busiest = [...contested].sort((a, b) => b.members.length - a.members.length).slice(0, opts.top ?? 10);
  if (busiest.length) {
    process.stdout.write(`\n${bold("busiest names")}\n\n`);
    process.stdout.write(
      renderTable(
        [
          { header: "name", width: 18 },
          { header: "launches", width: 9, align: "right" },
          { header: "first copy after", width: 16, align: "right" },
        ],
        busiest.map((c) => [
          c.label,
          String(c.members.length),
          duration(Math.max(0, c.members[1]!.record.launchedAt - c.members[0]!.record.launchedAt)),
        ]),
      ) + "\n",
    );
  }
  process.stdout.write("\n");
  return 0;
}
