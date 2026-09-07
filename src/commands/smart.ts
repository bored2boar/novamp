/**
 * `novamp smart` - read or rebuild the proven-wallet registry.
 *
 * The registry is the only part of novamp that carries an opinion from one run
 * to the next, so it gets its own command and its own file rather than hiding
 * inside the scoring. Read it, argue with it, rebuild it from your own window.
 */

import { writeFile } from "node:fs/promises";
import { clusterLaunches } from "../vamp/cluster.js";
import { loadRegistry, qualifies, type Registry, type SmartWallet } from "../smart/registry.js";
import { makeContext, REGISTRY_PATH } from "./context.js";
import { renderTable } from "../ui/table.js";
import { bold, dim, green, grey, yellow } from "../ui/color.js";
import { duration, shortAddress } from "../util/fmt.js";
import type { Address, LaunchRecord } from "../types.js";

export async function smartList(opts: { all?: boolean }): Promise<number> {
  const registry = await loadRegistry(REGISTRY_PATH());
  if (!registry.wallets.length) {
    process.stdout.write(
      `\n${yellow("registry is empty.")} ${dim("Run `novamp smart build` against a live RPC.")}\n\n`,
    );
    return 0;
  }
  const wallets = opts.all ? registry.wallets : registry.wallets.filter(qualifies);
  wallets.sort((a, b) => b.hitRate - a.hitRate || b.entries - a.entries);

  process.stdout.write(
    `\n${bold("proven wallets")} ${dim(`· ${registry.source} · built ${registry.builtAt}`)}\n\n`,
  );
  process.stdout.write(
    renderTable(
      [
        { header: "wallet", width: 16 },
        { header: "entries", width: 8, align: "right" },
        { header: "graduated", width: 10, align: "right" },
        { header: "hit rate", width: 9, align: "right" },
        { header: "median lag", width: 11, align: "right" },
        { header: "top entry", width: 10, align: "right" },
        { header: "", width: 10 },
      ],
      wallets.map((w) => [
        shortAddress(w.address),
        String(w.entries),
        String(w.graduated),
        `${(w.hitRate * 100).toFixed(1)}%`,
        duration(w.medianLagSec),
        `${(w.topEntryShare * 100).toFixed(0)}%`,
        qualifies(w) ? green("qualifies") : grey("filtered"),
      ]),
    ) + "\n\n",
  );
  process.stdout.write(
    dim(
      "hit rate is graduations over early entries. top entry is the share of graduations\n" +
        "coming from this wallet's single best launch: over 60% is a lottery ticket, not a method.\n\n",
    ),
  );
  return 0;
}

/**
 * Rebuild the registry from the launch window.
 *
 * A wallet's entries are its first buys inside two minutes of a launch; its
 * graduations are the ones that reached phase 2. That is the whole method, and
 * its weakness is written down in docs/SMART-WALLETS.md: a window that only
 * covers eleven hours cannot see a wallet that trades twice a week.
 */
export async function smartBuild(opts: {
  demo?: boolean;
  minEntries?: number;
  since?: string;
}): Promise<number> {
  const ctx = await makeContext({ demo: opts.demo, since: opts.since });
  const launches = await ctx.launches();
  if (!launches.length) {
    process.stdout.write(`\n${yellow("no launches in the window, nothing to build from")}\n\n`);
    return 1;
  }

  if (ctx.live) {
    process.stdout.write(dim(`\nreading early buyers for ${launches.length} launches. This is slow.\n`));
    await ctx.live.deepen(launches);
  }

  const byWallet = new Map<string, { entries: LaunchRecord[]; lags: number[] }>();
  for (const launch of launches) {
    for (const buyer of launch.buyers ?? []) {
      if (buyer.entryLagSec > 120) continue;
      const key = buyer.wallet.toLowerCase();
      const bucket = byWallet.get(key) ?? { entries: [], lags: [] };
      bucket.entries.push(launch);
      bucket.lags.push(buyer.entryLagSec);
      byWallet.set(key, bucket);
    }
  }

  const wallets: SmartWallet[] = [];
  for (const [address, bucket] of byWallet) {
    const graduated = bucket.entries.filter((l) => l.phase === 2);
    if (bucket.entries.length < (opts.minEntries ?? 4)) continue;
    const sortedLags = [...bucket.lags].sort((a, b) => a - b);
    const median = sortedLags[Math.floor(sortedLags.length / 2)] ?? 0;
    // "Best launch" is approximated by curve fill, the only size proxy that is
    // free here. docs/SMART-WALLETS.md explains why that is a weak proxy.
    const best = Math.max(0, ...graduated.map((l) => l.curveProgress));
    const totalProgress = graduated.reduce((sum, l) => sum + l.curveProgress, 0);
    wallets.push({
      address: address as Address,
      entries: bucket.entries.length,
      graduated: graduated.length,
      hitRate: graduated.length / bucket.entries.length,
      medianLagSec: median,
      topEntryShare: totalProgress > 0 ? best / totalProgress : 0,
    });
  }

  const registry: Registry = {
    source: ctx.source.kind === "demo" ? "built from fixtures (SYNTHETIC)" : `built from ${ctx.cfg.rpcUrl}`,
    builtAt: new Date().toISOString(),
    windowBlocks: ctx.cfg.indexLookbackBlocks,
    wallets: wallets.sort((a, b) => b.hitRate - a.hitRate),
  };

  await writeFile(REGISTRY_PATH(), JSON.stringify(registry, null, 2) + "\n", "utf8");
  const good = wallets.filter(qualifies).length;
  process.stdout.write(
    `\n${green("✓")} wrote ${wallets.length} wallets (${good} qualify) to ${REGISTRY_PATH()}\n` +
      `${dim("clusters seen: " + clusterLaunches(launches).length)}\n\n`,
  );
  return 0;
}
