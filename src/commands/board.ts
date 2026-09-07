/**
 * `novamp board` - the same engine behind a page on 127.0.0.1.
 *
 * The data is rebuilt on each request rather than cached, because the honest
 * failure mode of a board is showing you a stale table without saying so, and a
 * board that reads on demand cannot do that. The page polls every twenty
 * seconds, which on a public RPC is already generous.
 */

import { clusterLaunches } from "../vamp/cluster.js";
import { judgeCluster } from "../vamp/verdict.js";
import { startBoard, type BoardData } from "../board/server.js";
import { makeContext } from "./context.js";
import { bold, dim, green, yellow } from "../ui/color.js";
import { describeWindow } from "../util/window.js";
import { info } from "../util/log.js";

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export interface BoardOptions {
  demo?: boolean;
  since?: string;
  port?: number;
  open?: boolean;
}

export async function board(opts: BoardOptions): Promise<number> {
  const port = opts.port ?? Number(process.env["BOARD_PORT"] ?? 4663);

  const load = async (): Promise<BoardData> => {
    const ctx = await makeContext({ demo: opts.demo, since: opts.since });
    const launches = await ctx.launches();
    const clusters = clusterLaunches(launches).map((raw) => judgeCluster(raw, ctx.verdictOptions));
    const lags = clusters
      .filter((c) => c.vampLagSec !== null)
      .map((c) => c.vampLagSec as number);

    return {
      source: { kind: ctx.source.kind, describe: ctx.source.describe },
      window: describeWindow(ctx.windowSec),
      generatedAt: new Date().toISOString(),
      clusters,
      stats: {
        launches: launches.length,
        names: clusters.length,
        copies: launches.length - clusters.length,
        vampRatio: (launches.length - clusters.length) / Math.max(1, clusters.length),
        medianVampLagSec: median(lags),
      },
    };
  };

  // Fail before opening a port if the source cannot answer at all: a board that
  // starts and then shows an error is harder to diagnose than a command that
  // refuses with the reason.
  const first = await load();
  const server = await startBoard(load, port);

  process.stdout.write(
    `\n${bold("novamp board")} ${dim(`· ${first.clusters.length} names · ${first.stats.launches} launches`)}\n` +
      `  ${green(server.url)}\n` +
      dim(`  ${opts.demo ? "demo fixtures" : "live"} · window ${first.window} · local only, never 0.0.0.0\n`),
  );
  if (opts.demo) {
    process.stdout.write(`  ${yellow("demo mode")} ${dim("fixture data, not a live read\n")}`);
  }
  process.stdout.write(dim("\n  Ctrl-C to stop.\n\n"));

  const stop = async () => {
    info("closing the board");
    await server.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void stop());
  process.on("SIGTERM", () => void stop());

  // Hold the process open. The server keeps the event loop alive on its own,
  // but an explicit never-resolving promise makes that intent readable.
  await new Promise<void>(() => {});
  return 0;
}
