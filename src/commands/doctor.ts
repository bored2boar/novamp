/**
 * Is anything novamp depends on actually there?
 *
 * Run this first, always. A wrong factory address or a chain id that is not 4663
 * produces empty output that looks exactly like "no launches found", and that
 * confusion has cost more time than every other bug in this kind of tool.
 */

import { makeClient, verifyChain } from "../read/launches.js";
import { loadFixtures } from "../source/demo.js";
import { loadRegistry, qualifies } from "../smart/registry.js";
import { storeStats } from "../store/index.js";
import { loadWatchlist } from "../alerts/watchlist.js";
import { telegramFromEnv } from "../alerts/telegram.js";
import { describeWindow } from "../util/window.js";
import { REGISTRY_PATH } from "./context.js";
import { config } from "../util/env.js";
import { bold, dim, green, red, yellow } from "../ui/color.js";
import { renderPairs } from "../ui/table.js";
import { ROBINHOOD_CHAIN_ID } from "../chain/config.js";
import { factoryAbi } from "../chain/abi/pons.js";

const ok = (text: string) => `${green("✓")} ${text}`;
const bad = (text: string) => `${red("✕")} ${text}`;
const meh = (text: string) => `${yellow("!")} ${text}`;

export async function doctor(opts: { probe?: boolean }): Promise<number> {
  const cfg = config();
  const lines: [string, string][] = [];
  let failures = 0;

  const fixtures = await loadFixtures();
  lines.push([
    "fixtures",
    fixtures.launches.length
      ? ok(`${fixtures.launches.length} launches in ${fixtures.files.length} file(s) [${[...fixtures.origins].join(", ")}]`)
      : meh("none found: --demo will have nothing to show"),
  ]);

  const registry = await loadRegistry(REGISTRY_PATH());
  const good = registry.wallets.filter(qualifies).length;
  lines.push([
    "smart wallets",
    registry.wallets.length
      ? ok(`${good} of ${registry.wallets.length} wallets qualify · built ${registry.builtAt} · ${registry.source}`)
      : meh("registry empty: convergence will never fire"),
  ]);

  const store = await storeStats();
  lines.push([
    "local index",
    store.launches
      ? ok(
          `${store.launches} launches over ${describeWindow(store.coverage.spanSec)} in ${store.files} file(s)`,
        )
      : meh("empty: --since is limited to what one live read covers until it fills in"),
  ]);

  const watchlist = await loadWatchlist();
  lines.push([
    "watchlist",
    watchlist.entries.length
      ? ok(
          `${watchlist.entries.length} name(s) · telegram ${telegramFromEnv() ? "configured" : "off"}`,
        )
      : meh("empty"),
  ]);

  lines.push(["rpc url", dim(cfg.rpcUrl)]);
  lines.push(["factory", dim(cfg.factory)]);

  if (opts.probe) {
    try {
      const client = makeClient(cfg.rpcUrl);
      const { ok: matched, chainId } = await verifyChain(client);
      lines.push([
        "chain id",
        matched
          ? ok(`${chainId}`)
          : bad(`${chainId}, expected ${ROBINHOOD_CHAIN_ID}. This RPC is not Robinhood Chain.`),
      ]);
      if (!matched) failures++;

      const head = await client.getBlockNumber();
      lines.push(["head block", ok(head.toString())]);

      try {
        const taxStart = await client.readContract({
          address: cfg.factory,
          abi: factoryAbi,
          functionName: "snipeTaxStartBps",
        });
        const taxSeconds = await client.readContract({
          address: cfg.factory,
          abi: factoryAbi,
          functionName: "snipeTaxSeconds",
        });
        lines.push([
          "pons factory",
          ok(`opening tax ${Number(taxStart) / 100}% decaying over ${taxSeconds}s`),
        ]);
      } catch (err) {
        failures++;
        lines.push([
          "pons factory",
          bad(`no answer at ${cfg.factory}: ${(err as Error).message.split("\n")[0]}`),
        ]);
      }
    } catch (err) {
      failures++;
      lines.push(["rpc", bad((err as Error).message.split("\n")[0] ?? "unreachable")]);
    }
  } else {
    lines.push(["chain", dim("not probed. Run `novamp doctor --probe` to touch the network.")]);
  }

  process.stdout.write(`\n${bold("novamp doctor")}\n\n${renderPairs(lines)}\n\n`);
  if (failures) {
    process.stdout.write(
      `${red(`${failures} check(s) failed.`)} ${dim("Everything still works with --demo.")}\n\n`,
    );
  }
  return failures ? 1 : 0;
}
