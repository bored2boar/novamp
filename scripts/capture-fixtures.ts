/**
 * Record real launches from Robinhood Chain into a fixture file.
 *
 * The fixtures novamp ships are synthetic, and they say so. This script is how
 * you replace them with the real thing:
 *
 *   npx tsx scripts/capture-fixtures.ts PEANUT
 *   npx tsx scripts/capture-fixtures.ts --busiest 3
 *
 * The file it writes carries `"origin": "capture"` and the block it was taken
 * at, so `--demo` stops calling itself synthetic and any screenshot taken from
 * it is a screenshot of the chain.
 *
 * Nothing in here signs anything. It reads and writes JSON.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { liveSource } from "../src/source/live.js";
import { clusterLaunches, contestedOnly, findCluster } from "../src/vamp/cluster.js";
import { config } from "../src/util/env.js";
import type { RawCluster } from "../src/vamp/cluster.js";

async function writeCluster(cluster: RawCluster, block: number): Promise<void> {
  const dir = resolve(process.cwd(), "fixtures/clusters");
  await mkdir(dir, { recursive: true });
  const file = `${cluster.key.replace(/[^a-z0-9]/g, "") || "cluster"}.json`;
  const body = {
    origin: "capture" as const,
    note: `Captured from Robinhood Chain at block ${block}. Real launches, real numbers.`,
    capturedAt: new Date().toISOString(),
    launches: cluster.members.map((m) => m.record),
  };
  await writeFile(resolve(dir, file), JSON.stringify(body, null, 2) + "\n", "utf8");
  process.stdout.write(`wrote fixtures/clusters/${file} (${cluster.members.length} launches)\n`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const source = liveSource();
  const cfg = config();

  process.stdout.write(`reading ${cfg.rpcUrl}, last ${cfg.indexLookbackBlocks} blocks\n`);
  const launches = await source.recent();
  if (!launches.length) {
    process.stderr.write("no launches in the window. Check RPC_URL and PONS_V2_FACTORY.\n");
    process.exit(1);
  }
  const head = Math.max(...launches.map((l) => l.block));

  const busiestFlag = args.indexOf("--busiest");
  if (busiestFlag >= 0) {
    const count = Number(args[busiestFlag + 1] ?? 3);
    const clusters = contestedOnly(clusterLaunches(launches))
      .sort((a, b) => b.members.length - a.members.length)
      .slice(0, count);
    if (!clusters.length) {
      process.stderr.write("no contested names in this window. Widen INDEX_LOOKBACK_BLOCKS.\n");
      process.exit(1);
    }
    for (const cluster of clusters) {
      await source.deepen(cluster.members.map((m) => m.record), { funding: true });
      await writeCluster(cluster, head);
    }
    return;
  }

  const query = args[0];
  if (!query) {
    process.stderr.write(
      "usage: capture-fixtures.ts <name>   |   capture-fixtures.ts --busiest <n>\n",
    );
    process.exit(1);
  }
  const cluster = findCluster(launches, query);
  if (!cluster) {
    process.stderr.write(`nothing launched under a name like "${query}" in this window.\n`);
    process.exit(1);
  }
  await source.deepen(cluster.members.map((m) => m.record), { funding: true });
  await writeCluster(cluster, head);
}

main().catch((err: unknown) => {
  process.stderr.write(`${(err as Error).message ?? String(err)}\n`);
  process.exit(1);
});
