/**
 * `novamp smart` - read or rebuild the proven-wallet registry.
 *
 * The registry is the only part of novamp that carries an opinion from one run
 * to the next, so it gets its own command and its own file rather than hiding
 * inside the scoring. Read it, argue with it, delete a wallet you think is luck.
 *
 * Since 0.3 a wallet earns its place on realized results: quote out against
 * quote in, per position. Being early to something that later graduated is not
 * a result, because entering early and exiting well are different skills and
 * only the second one pays.
 */

import { writeFile } from "node:fs/promises";
import { loadRegistry, qualifies, type Registry } from "../smart/registry.js";
import { buildWallets, DEFAULT_BUILD_OPTIONS } from "../smart/realized.js";
import { makeContext, REGISTRY_PATH } from "./context.js";
import { renderTable } from "../ui/table.js";
import { bold, dim, green, grey, red, yellow } from "../ui/color.js";
import { duration, shortAddress } from "../util/fmt.js";
import { describeWindow } from "../util/window.js";

export async function smartList(opts: { all?: boolean }): Promise<number> {
  const registry = await loadRegistry(REGISTRY_PATH());
  if (!registry.wallets.length) {
    process.stdout.write(
      `\n${yellow("registry is empty.")} ${dim("Run `novamp smart build` against a live RPC.")}\n\n`,
    );
    return 0;
  }
  const wallets = opts.all ? registry.wallets : registry.wallets.filter(qualifies);
  wallets.sort((a, b) => b.realizedMultiple - a.realizedMultiple || b.profitable - a.profitable);

  process.stdout.write(
    `\n${bold("proven wallets")} ${dim(`· ${registry.source} · built ${registry.builtAt}`)}\n\n`,
  );
  process.stdout.write(
    renderTable(
      [
        { header: "wallet", width: 16 },
        { header: "entries", width: 8, align: "right" },
        { header: "closed", width: 7, align: "right" },
        { header: "in profit", width: 10, align: "right" },
        { header: "realized", width: 9, align: "right" },
        { header: "open", width: 5, align: "right" },
        { header: "median lag", width: 11, align: "right" },
        { header: "top win", width: 8, align: "right" },
        { header: "", width: 10 },
      ],
      wallets.map((w) => [
        shortAddress(w.address),
        String(w.entries),
        String(w.closed),
        String(w.profitable),
        w.realizedMultiple >= 1
          ? green(`${w.realizedMultiple.toFixed(2)}x`)
          : red(`${w.realizedMultiple.toFixed(2)}x`),
        w.open ? String(w.open) : dim("0"),
        duration(w.medianLagSec),
        `${(w.topEntryShare * 100).toFixed(0)}%`,
        qualifies(w) ? green("qualifies") : grey("filtered"),
      ]),
    ) + "\n\n",
  );
  process.stdout.write(
    dim(
      "realized is quote out over quote in across closed positions. open positions have\n" +
        "no sale yet, so their outcome is unknown and they count for nothing either way.\n" +
        "top win is the share of total gain from one position: over 60% is a lottery ticket.\n\n",
    ),
  );
  return 0;
}

/**
 * Rebuild the registry from the window.
 *
 * Slow, and honest about why: it needs the buyers *and* the sales for every
 * launch in the window, which is two log sweeps per launch. On a public RPC
 * this will take a while and will not finish cleanly; narrow it with `--since`
 * and let the local index do the accumulating instead.
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
    process.stdout.write(
      dim(`\nreading buyers and sales for ${launches.length} launches. This is slow.\n`),
    );
    await ctx.live.deepen(launches);
  }

  const wallets = buildWallets(launches, {
    ...DEFAULT_BUILD_OPTIONS,
    minEntries: opts.minEntries ?? DEFAULT_BUILD_OPTIONS.minEntries,
  });

  const withOutcomes = launches.filter((l) => l.sellActivity?.complete).length;
  const registry: Registry = {
    source:
      ctx.source.kind === "demo"
        ? "built from fixtures (SYNTHETIC)"
        : `built from ${ctx.cfg.rpcUrl} over ${describeWindow(ctx.windowSec)}`,
    builtAt: new Date().toISOString(),
    windowBlocks: ctx.cfg.indexLookbackBlocks,
    wallets,
  };

  await writeFile(REGISTRY_PATH(), JSON.stringify(registry, null, 2) + "\n", "utf8");
  const good = wallets.filter(qualifies).length;

  process.stdout.write(
    `\n${green("✓")} wrote ${wallets.length} wallets (${good} qualify) to ${REGISTRY_PATH()}\n`,
  );
  if (withOutcomes < launches.length) {
    process.stdout.write(
      `${yellow("!")} the sell side read cleanly on ${withOutcomes} of ${launches.length} launches.\n` +
        dim("  Positions on the rest count as open, not as losses. Rebuild when the index is deeper.\n"),
    );
  }
  process.stdout.write("\n");
  return 0;
}
