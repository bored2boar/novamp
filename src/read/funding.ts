/**
 * Where a deployer wallet got its first ETH.
 *
 * This is the heaviest single signal novamp has and the cheapest one for a farm
 * to forget about. An operator can randomise the dev buy down to the wei, shuffle
 * the creator tax, rewrite the socials and use a fresh wallet for every launch,
 * and all of those wallets still had to be funded from somewhere. When two
 * members of the same name cluster trace back to one funder, the "competition"
 * between them was staged.
 *
 * Standard JSON-RPC has no "transactions by address" method, so this walks the
 * wallet's earliest blocks. That is slow and bounded, and when it comes back
 * empty the honest answer is "unknown", not "independent".
 *
 * STATUS: not yet exercised against mainnet. On a public endpoint expect this to
 * be the first thing that gets rate limited; a private RPC or an explorer API
 * makes it practical. See docs/LIMITATIONS.md.
 */

import type { PublicClient } from "viem";
import type { Address } from "../types.js";
import type { RpcGate } from "../chain/gate.js";
import { warn } from "../util/log.js";

export interface FundingTrace {
  funder?: Address;
  /** Block the funding transfer was found in. */
  block?: number;
  /** False when the search was cut short: absence is not evidence here. */
  conclusive: boolean;
}

/**
 * Scan backwards from the deployer's first known activity for the transaction
 * that gave it a balance.
 *
 * `searchBlocks` is intentionally small. This is a targeted question about one
 * wallet, not an indexer, and the tool should refuse to spend ten minutes on it.
 */
export async function traceFunding(
  client: PublicClient,
  gate: RpcGate,
  wallet: Address,
  firstSeenBlock: number,
  searchBlocks = 5_000,
): Promise<FundingTrace> {
  const from = Math.max(0, firstSeenBlock - searchBlocks);
  try {
    for (let block = firstSeenBlock; block >= from; block--) {
      const full = await gate.retry(() =>
        client.getBlock({ blockNumber: BigInt(block), includeTransactions: true }),
      );
      for (const tx of full.transactions) {
        if (typeof tx === "string") continue;
        if (!tx.to) continue;
        if (tx.to.toLowerCase() !== wallet.toLowerCase()) continue;
        if (tx.value === 0n) continue;
        return { funder: tx.from as Address, block, conclusive: true };
      }
    }
    return { conclusive: false };
  } catch (err) {
    warn(`funding trace for ${wallet} stopped: ${(err as Error).message}`);
    return { conclusive: false };
  }
}

/** Group addresses by funder, dropping the ones we could not trace. */
export function groupByFunder(
  traces: ReadonlyMap<string, FundingTrace>,
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [wallet, trace] of traces) {
    if (!trace.funder) continue;
    const key = trace.funder.toLowerCase();
    const list = out.get(key) ?? [];
    list.push(wallet);
    out.set(key, list);
  }
  for (const [key, list] of out) if (list.length < 2) out.delete(key);
  return out;
}
