/**
 * `novamp watch` - the live feed, filtered for the only thing novamp cares
 * about: a launch that is copying something that already exists.
 *
 * A new launch that starts its own cluster gets one quiet line. A new launch
 * that lands inside an existing cluster gets the loud one, with how far behind
 * it is and what the original is doing.
 *
 * STATUS: written, not yet exercised against mainnet. See docs/LIMITATIONS.md.
 */

import { clusterLaunches, birthOrder } from "../vamp/cluster.js";
import { judgeCluster } from "../vamp/verdict.js";
import { makeContext } from "./context.js";
import { renderSourceLine } from "../ui/render.js";
import { bold, dim, grey, red, verdictColor, yellow } from "../ui/color.js";
import { duration, shortAddress } from "../util/fmt.js";
import { sleep } from "../chain/gate.js";
import { info } from "../util/log.js";
import type { LaunchRecord } from "../types.js";

export async function watch(opts: { demo?: boolean; minMembers?: number }): Promise<number> {
  const ctx = await makeContext({ demo: opts.demo });
  process.stdout.write(`\n${renderSourceLine(ctx.source.kind, ctx.source.describe)}\n`);

  if (ctx.source.kind === "demo") {
    process.stdout.write(
      `${yellow("demo mode")} ${dim("replaying the fixture launches in birth order, one per second")}\n\n`,
    );
    const all = (await ctx.launches()).sort(birthOrder);
    const seen: LaunchRecord[] = [];
    for (const record of all) {
      seen.push(record);
      printLine(record, seen);
      await sleep(600);
    }
    process.stdout.write(`\n${dim("end of fixture")}\n\n`);
    return 0;
  }

  info("watching for new launches. Ctrl-C to stop.");
  const seen = new Map<string, LaunchRecord>();
  const known = await ctx.launches();
  for (const record of known) seen.set(record.token.toLowerCase(), record);
  process.stdout.write(dim(`${seen.size} launches already in the window\n\n`));

  // Polling rather than a subscription: one loop, one failure mode, and it works
  // on an endpoint that does not serve websockets.
  for (;;) {
    await sleep(Math.max(500, ctx.cfg.pollMs));
    let fresh: LaunchRecord[] = [];
    try {
      const source = ctx.live;
      if (!source) break;
      // `recent()` caches the window, so the cache is dropped before each poll.
      source.invalidate();
      fresh = await source.recent();
    } catch (err) {
      process.stderr.write(`${red("!")} ${(err as Error).message}\n`);
      continue;
    }
    for (const record of fresh) {
      const key = record.token.toLowerCase();
      if (seen.has(key)) continue;
      seen.set(key, record);
      printLine(record, [...seen.values()]);
    }
  }
  return 0;
}

function printLine(record: LaunchRecord, universe: LaunchRecord[]): void {
  const clusters = clusterLaunches(universe);
  const mine = clusters.find((c) => c.members.some((m) => m.record.token === record.token));
  if (!mine || mine.members.length === 1) {
    process.stdout.write(
      `${grey(new Date(record.launchedAt * 1000).toISOString().slice(11, 19))} ` +
        `${dim("new")}  ${record.symbol}  ${grey(shortAddress(record.token))}\n`,
    );
    return;
  }

  const judged = judgeCluster(mine);
  const me = judged.members.find((m) => m.record.token === record.token)!;
  const first = judged.members[0]!;
  process.stdout.write(
    `${grey(new Date(record.launchedAt * 1000).toISOString().slice(11, 19))} ` +
      `${verdictColor(me.verdict)(me.verdict.padEnd(9))} ${bold(record.symbol)}  ` +
      `#${me.rank} of ${judged.members.length}, +${duration(me.lagSec)} behind ${first.record.symbol}  ` +
      `${grey(shortAddress(record.token))}\n`,
  );
}
