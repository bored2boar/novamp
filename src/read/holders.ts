/**
 * Who holds this token, and how concentrated is it.
 *
 * There is no `eth_getTokenHolders` on a standard JSON-RPC, so the holder set is
 * reconstructed from Transfer logs: every address that has ever received the
 * token, then a balance read for each. That is a lot of calls, which is why this
 * only ever runs on the members of one cluster and never on the whole index.
 *
 * Two things make the difference between a useful number and a useless one:
 *
 *   1. the curve and the pool are labelled and excluded from the percentages,
 *      because they hold the float and drown out everything else;
 *   2. an incomplete scan is reported as incomplete rather than rounded down to
 *      a comfortable number.
 *
 * STATUS: not yet exercised against mainnet. See docs/LIMITATIONS.md.
 */

import type { PublicClient } from "viem";
import type { Address, HolderSlice, HolderSnapshot, LaunchRecord } from "../types.js";
import { tokenAbi, transferEvent } from "../chain/abi/pons.js";
import { BURN_ADDRESSES } from "../chain/config.js";
import type { RpcGate } from "../chain/gate.js";
import { config } from "../util/env.js";
import { warn } from "../util/log.js";

/** Cap on balance reads per token. Past this the answer is a floor, not a total. */
export const MAX_HOLDER_READS = 400;

export function labelFor(
  address: string,
  record: Pick<LaunchRecord, "curve" | "deployer">,
  poolAddress?: string,
): HolderSlice["label"] {
  const lower = address.toLowerCase();
  if (lower === record.curve.toLowerCase()) return "curve";
  if (poolAddress && lower === poolAddress.toLowerCase()) return "pool";
  if (lower === record.deployer.toLowerCase()) return "deployer";
  if (BURN_ADDRESSES.has(lower)) return "burn";
  return undefined;
}

export async function readHolders(
  client: PublicClient,
  gate: RpcGate,
  record: LaunchRecord,
  opts: { fromBlock?: number; poolAddress?: string } = {},
): Promise<HolderSnapshot> {
  const cfg = config();
  const candidates = new Set<string>();
  let complete = true;

  const head = Number(await gate.retry(() => client.getBlockNumber()));
  const from = opts.fromBlock ?? record.block;

  for (let start = from; start <= head; start += cfg.logChunkBlocks) {
    const end = Math.min(head, start + cfg.logChunkBlocks - 1);
    try {
      const logs = await gate.retry(
        () =>
          client.getLogs({
            address: record.token,
            fromBlock: BigInt(start),
            toBlock: BigInt(end),
            event: transferEvent,
          }),
        "logs",
      );
      for (const log of logs) {
        if (log.args.to) candidates.add(log.args.to.toLowerCase());
      }
    } catch (err) {
      complete = false;
      warn(`holder scan hole at ${start}-${end}: ${(err as Error).message}`);
    }
    if (candidates.size > MAX_HOLDER_READS * 2) {
      complete = false;
      break;
    }
  }

  const supply = await gate
    .retry(() => client.readContract({ address: record.token, abi: tokenAbi, functionName: "totalSupply" }))
    .catch(() => 0n);
  if (supply === 0n) {
    return { top: [], top10Pct: 0, deployerPct: 0, complete: false };
  }

  const addresses = [...candidates].slice(0, MAX_HOLDER_READS);
  if (addresses.length < candidates.size) complete = false;

  const slices: HolderSlice[] = [];
  for (const address of addresses) {
    try {
      const balance = await gate.retry(() =>
        client.readContract({
          address: record.token,
          abi: tokenAbi,
          functionName: "balanceOf",
          args: [address as Address],
        }),
      );
      if ((balance as bigint) === 0n) continue;
      slices.push({
        wallet: address as Address,
        pct: Number(((balance as bigint) * 1_000_000n) / (supply as bigint)) / 10_000,
        label: labelFor(address, record, opts.poolAddress),
      });
    } catch {
      complete = false;
    }
  }

  slices.sort((a, b) => b.pct - a.pct);
  const real = slices.filter((s) => s.label !== "curve" && s.label !== "pool" && s.label !== "burn");
  const top10Pct = real.slice(0, 10).reduce((sum, s) => sum + s.pct, 0);
  const deployerPct = slices.find((s) => s.label === "deployer")?.pct ?? 0;

  return {
    top: slices.slice(0, 25),
    top10Pct,
    deployerPct,
    holderCount: complete ? real.length : undefined,
    complete,
  };
}
