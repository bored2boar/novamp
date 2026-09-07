/**
 * `novamp scan <token>` - one launch, everything novamp can say about it,
 * including the cluster it belongs to whether or not the user knew there was
 * one. Most of the value is in that last part: people scan a token they are
 * already in, and find out it is number six.
 */

import { findCluster } from "../vamp/cluster.js";
import { judgeCluster } from "../vamp/verdict.js";
import { renderMember, renderSourceLine } from "../ui/render.js";
import { makeContext } from "./context.js";
import { fail } from "../util/log.js";
import { bold, dim, verdictColor, yellow } from "../ui/color.js";
import { duration } from "../util/fmt.js";

export async function scan(
  token: string,
  opts: { demo?: boolean; json?: boolean; since?: string },
): Promise<number> {
  const ctx = await makeContext({ demo: opts.demo, since: opts.since });
  if (!opts.json) {
    process.stdout.write(`\n${renderSourceLine(ctx.source.kind, ctx.source.describe)}\n`);
    if (ctx.source.kind === "demo") {
      process.stdout.write(`${yellow("demo mode")} ${dim("fixture data")}\n`);
    }
  }

  const all = await ctx.launches();
  const record =
    all.find((r) => r.token.toLowerCase() === token.toLowerCase()) ??
    (await ctx.source.byToken(token));
  if (!record) {
    fail(`${token} is not a pons v2 launch in this window.`);
    return 1;
  }

  const raw = findCluster(all, record.symbol);
  if (!raw) {
    fail("could not build a cluster for this token.");
    return 1;
  }
  if (ctx.live) {
    await ctx.live.deepen(raw.members.map((m) => m.record), { funding: raw.members.length > 1 });
  }

  const cluster = judgeCluster(raw, ctx.verdictOptions);
  const mine = cluster.members.find(
    (m) => m.record.token.toLowerCase() === record.token.toLowerCase(),
  );
  if (!mine) {
    fail("token dropped out of its own cluster, which is a bug. Please open an issue.");
    return 1;
  }

  if (opts.json) {
    process.stdout.write(JSON.stringify({ cluster: cluster.key, member: mine }, null, 2) + "\n");
    return 0;
  }

  process.stdout.write("\n" + renderMember(mine) + "\n");
  process.stdout.write("\n" + dim("why this score:") + "\n");
  for (const reason of mine.reasons) {
    if (reason.points === 0) continue;
    process.stdout.write(
      `  ${reason.points > 0 ? `+${reason.points}` : reason.points}  ${reason.text}\n`,
    );
  }

  if (cluster.members.length > 1) {
    const first = cluster.members[0]!;
    process.stdout.write(
      `\n${bold("cluster")} ${cluster.label} · ${verdictColor(cluster.verdict)(cluster.verdict)} · ` +
        `${cluster.members.length} launches under this name\n`,
    );
    if (mine.rank > 1) {
      process.stdout.write(
        `${yellow("→")} this is #${mine.rank}, launched ${duration(mine.lagSec)} after ${first.record.symbol}\n`,
      );
    }
    process.stdout.write(dim(`run \`novamp vamp ${cluster.label} --all\` for the whole fight\n`));
  }
  process.stdout.write("\n");
  return 0;
}
