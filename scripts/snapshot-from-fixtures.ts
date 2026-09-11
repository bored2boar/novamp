/**
 * The same snapshot, built from the demo fixtures instead of from an indexer.
 *
 *   npx tsx scripts/snapshot-from-fixtures.ts
 *
 * This exists so the website can be built, styled and reviewed before anybody
 * has an API key, and so the page has something to render when the scheduled job
 * has never run. It writes the identical schema, with `source` saying plainly
 * that it is synthetic, which the page prints as a banner rather than hiding.
 *
 * It is also the regression test for the snapshot format: if this stops matching
 * what the site expects, that is caught here and not by a blank page.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadFixtures } from "../src/source/demo.js";
import { clusterLaunches } from "../src/vamp/cluster.js";
import { judgeCluster, DEFAULT_VERDICT_OPTIONS } from "../src/vamp/verdict.js";
import { loadRegistry, indexOf } from "../src/smart/registry.js";
import { looseKey } from "../src/vamp/normalize.js";

const OUT = resolve(process.cwd(), process.env["SNAPSHOT_OUT"] || "site/data");

async function main(): Promise<void> {
  const { launches, files } = await loadFixtures();
  if (!launches.length) {
    process.stderr.write("no fixtures found\n");
    process.exit(1);
  }

  const registry = await loadRegistry(resolve(process.cwd(), "fixtures/smart-wallets.json"));
  const options = { ...DEFAULT_VERDICT_OPTIONS, smartIndex: indexOf(registry) };

  const clusters = clusterLaunches(launches).sort(
    (a, b) => b.members.length - a.members.length,
  );

  const judged = clusters.map((raw) => {
    const cluster = judgeCluster(raw, options);
    return {
      key: cluster.key,
      label: cluster.label,
      verdict: cluster.verdict,
      vampLagSec: cluster.vampLagSec,
      notes: cluster.notes,
      depth: "full" as const,
      members: cluster.members.map((m) => ({
        token: m.record.token,
        symbol: m.record.symbol,
        name: m.record.name,
        rank: m.rank,
        lagSec: m.lagSec,
        verdict: m.verdict,
        score: m.potential,
        risk: m.risk,
        launchedAt: m.record.launchedAt,
        deployer: m.record.deployer,
        top10Pct: m.record.holders?.top10Pct ?? null,
        holdersComplete: m.record.holders?.complete ?? false,
        reasons: m.reasons.map((r) => ({ points: r.points, text: r.text })),
        flags: m.flags.map((f) => ({ level: f.level, code: f.code, text: f.text })),
      })),
    };
  });

  const search: Record<string, string> = {};
  for (const cluster of judged) {
    for (const member of cluster.members) {
      for (const term of [member.symbol, member.name]) {
        const key = looseKey(term);
        if (key.length >= 3 && !search[key]) search[key] = cluster.key;
      }
    }
  }

  const times = launches.map((l) => l.launchedAt);
  const snapshot = {
    schema: "novamp.snapshot.v1",
    takenAt: new Date().toISOString(),
    source: "SYNTHETIC fixtures, not chain data",
    window: {
      requestedHours: 0,
      oldestLaunch: Math.min(...times),
      newestLaunch: Math.max(...times),
      launches: launches.length,
      unreadable: 0,
    },
    gaps: [
      "this snapshot is built from hand-shaped fixture launches and describes no real token",
    ],
    clusters: judged,
    search,
  };

  await mkdir(OUT, { recursive: true });
  await writeFile(resolve(OUT, "snapshot.json"), JSON.stringify(snapshot) + "\n", "utf8");
  process.stdout.write(
    `wrote ${OUT}/snapshot.json from ${files.length} fixture file(s): ` +
      `${judged.length} clusters, ${launches.length} launches\n`,
  );
}

main().catch((err) => {
  process.stderr.write(`${(err as Error).stack ?? String(err)}\n`);
  process.exit(1);
});
