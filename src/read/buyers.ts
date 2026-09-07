/**
 * Who bought this launch, how fast, and what they paid for the privilege.
 *
 * The opening tax makes this list unusually informative. On pons v2 the tax
 * starts at 99 % and decays to zero over three seconds, and it is charged per
 * recipient, so `taxPaidBps` tells you what a buyer was doing without any
 * guessing: 9900 means a bot raced the block and burned almost the whole buy,
 * and something near zero means a wallet waited on purpose.
 *
 * A launch where every early buy paid the full tax has no humans in it yet.
 *
 * STATUS: not yet exercised against mainnet. See docs/LIMITATIONS.md.
 */

import { getAddress, type PublicClient } from "viem";
import type { Address, Buyer } from "../types.js";
import { curveBuyEvent } from "../chain/abi/pons.js";
import type { RpcGate } from "../chain/gate.js";
import { config } from "../util/env.js";
import { warn } from "../util/log.js";

export interface BuyerWindow {
  /** How many seconds after the launch to keep reading. */
  seconds: number;
  /** Hard cap on events, so one busy launch cannot stall a cluster. */
  maxEvents: number;
}

export const DEFAULT_WINDOW: BuyerWindow = { seconds: 120, maxEvents: 500 };

export async function readEarlyBuyers(
  client: PublicClient,
  gate: RpcGate,
  launch: { curve: Address; block: number; launchedAt: number },
  window: BuyerWindow = DEFAULT_WINDOW,
): Promise<{ buyers: Buyer[]; unique: number; complete: boolean }> {
  const cfg = config();
  // Blocks seal about every 100 ms, so the window converts to blocks directly.
  const blockSpan = Math.ceil((window.seconds * 1000) / 100);
  const from = launch.block;
  const to = launch.block + blockSpan;

  const firstBuyByWallet = new Map<string, Buyer>();
  let complete = true;
  let seen = 0;

  for (let start = from; start <= to; start += cfg.logChunkBlocks) {
    const end = Math.min(to, start + cfg.logChunkBlocks - 1);
    try {
      const logs = await gate.retry(
        () =>
          client.getLogs({
            address: launch.curve,
            fromBlock: BigInt(start),
            toBlock: BigInt(end),
            event: curveBuyEvent,
          }),
        "logs",
      );
      for (const log of logs) {
        if (seen++ >= window.maxEvents) {
          complete = false;
          break;
        }
        const args = log.args;
        if (!args.recipient || args.quoteIn === undefined || args.tax === undefined) continue;
        const wallet = getAddress(args.recipient) as Address;
        const key = wallet.toLowerCase();
        if (firstBuyByWallet.has(key)) continue;

        const quoteIn = args.quoteIn;
        const tax = args.tax;
        // Tax is charged out of the incoming quote, so the ratio recovers the bps.
        const taxBps = quoteIn > 0n ? Number((tax * 10_000n) / quoteIn) : 0;
        // Block distance is a better clock than a block timestamp here: the
        // whole event happens inside a few seconds.
        const lagSec = Math.max(0, (Number(log.blockNumber ?? 0n) - launch.block) * 0.1);

        firstBuyByWallet.set(key, {
          wallet,
          entryLagSec: lagSec,
          quoteInWei: quoteIn.toString(),
          taxPaidBps: taxBps,
        });
      }
    } catch (err) {
      complete = false;
      warn(`buyer scan hole at ${start}-${end}: ${(err as Error).message}`);
    }
  }

  const buyers = [...firstBuyByWallet.values()].sort((a, b) => a.entryLagSec - b.entryLagSec);
  const unique = buyers.filter((b) => b.entryLagSec <= 60).length;
  return { buyers, unique, complete };
}
