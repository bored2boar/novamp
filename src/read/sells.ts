/**
 * What came back out of the curve, and how big it was against what was in it.
 *
 * A sale means nothing in absolute terms. Half an ETH out of a curve holding
 * forty is noise; half an ETH out of a curve holding two is the launch ending.
 * So this reader does not just list sales, it reconstructs how much quote was
 * sitting on the curve at the moment each one landed.
 *
 * **How the reserve is reconstructed.** Both `CurveBuy` and `CurveSell` carry
 * their quote amounts, so replaying them in chain order from the launch gives a
 * running balance. It is an approximation: it ignores fees skimmed off the
 * curve and anything that moved outside these two events. It is close enough to
 * answer "was that a fifth of everything or a rounding error", which is the only
 * question being asked of it, and it is honest about being an approximation
 * rather than reading a number that does not exist historically.
 *
 * STATUS: not yet exercised against mainnet. See docs/LIMITATIONS.md.
 */

import { getAddress, type PublicClient } from "viem";
import type { Address, Sell } from "../types.js";
import { curveBuyEvent, curveSellEvent } from "../chain/abi/pons.js";
import type { RpcGate } from "../chain/gate.js";
import { ratio } from "../vamp/flow.js";
import { config } from "../util/env.js";
import { warn } from "../util/log.js";

export interface SellWindow {
  /** How many seconds after the launch to keep reading. */
  seconds: number;
  /** Hard cap on events, so one busy launch cannot stall a cluster. */
  maxEvents: number;
}

export const DEFAULT_SELL_WINDOW: SellWindow = { seconds: 600, maxEvents: 800 };

interface Movement {
  block: number;
  logIndex: number;
  kind: "buy" | "sell";
  wallet: Address;
  quoteWei: bigint;
}

export async function readSells(
  client: PublicClient,
  gate: RpcGate,
  launch: { curve: Address; deployer: Address; block: number },
  window: SellWindow = DEFAULT_SELL_WINDOW,
): Promise<{ sells: Sell[]; complete: boolean }> {
  const cfg = config();
  // Blocks seal about every 100 ms, so the window converts to blocks directly.
  const blockSpan = Math.ceil((window.seconds * 1000) / 100);
  const from = launch.block;
  const to = launch.block + blockSpan;

  const movements: Movement[] = [];
  let complete = true;
  let seen = 0;

  for (let start = from; start <= to; start += cfg.logChunkBlocks) {
    const end = Math.min(to, start + cfg.logChunkBlocks - 1);

    for (const event of [curveBuyEvent, curveSellEvent] as const) {
      try {
        const logs = await gate.retry(
          () =>
            client.getLogs({
              address: launch.curve,
              fromBlock: BigInt(start),
              toBlock: BigInt(end),
              event,
            }),
          "logs",
        );
        for (const log of logs) {
          if (seen++ >= window.maxEvents) {
            complete = false;
            break;
          }
          const args = log.args as Record<string, unknown>;
          const isBuy = event === curveBuyEvent;
          const quote = isBuy ? args["quoteIn"] : args["quoteOut"];
          const who = isBuy ? args["recipient"] : args["seller"];
          if (typeof quote !== "bigint" || typeof who !== "string") continue;

          movements.push({
            block: Number(log.blockNumber ?? 0n),
            logIndex: log.logIndex ?? 0,
            kind: isBuy ? "buy" : "sell",
            wallet: getAddress(who) as Address,
            quoteWei: quote,
          });
        }
      } catch (err) {
        complete = false;
        warn(`sell scan hole at ${start}-${end}: ${(err as Error).message}`);
      }
    }
  }

  movements.sort((a, b) => a.block - b.block || a.logIndex - b.logIndex);

  const deployer = launch.deployer.toLowerCase();
  const sells: Sell[] = [];
  let reserve = 0n;

  for (const move of movements) {
    if (move.kind === "buy") {
      reserve += move.quoteWei;
      continue;
    }
    // Share is measured against the reserve *before* this sale landed, which is
    // what a person watching the chart would have felt.
    sells.push({
      wallet: move.wallet,
      atSec: Math.max(0, (move.block - launch.block) * 0.1),
      quoteOutWei: move.quoteWei.toString(),
      shareOfReserve: ratio(move.quoteWei, reserve),
      isDeployer: move.wallet.toLowerCase() === deployer,
    });
    reserve = reserve > move.quoteWei ? reserve - move.quoteWei : 0n;
  }

  return { sells, complete };
}
