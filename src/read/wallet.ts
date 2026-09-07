/**
 * Which pons v2 launches a wallet is actually holding.
 *
 * There is no `eth_getTokenBalances` on a standard JSON-RPC, so a wallet's
 * positions cannot be enumerated directly. novamp does it the only honest cheap
 * way: take the launches it already knows about, and ask each token contract for
 * this wallet's balance. That means the answer is bounded by the index rather
 * than by the wallet, and a position in a launch outside the window is invisible.
 *
 * The command says so. "You hold 3 copies out of 7 positions" would be a lie if
 * the 7 were secretly 12.
 *
 * STATUS: not yet exercised against mainnet. See docs/LIMITATIONS.md.
 */

import type { PublicClient } from "viem";
import type { Address, LaunchRecord } from "../types.js";
import { tokenAbi } from "../chain/abi/pons.js";
import type { RpcGate } from "../chain/gate.js";
import { warn } from "../util/log.js";

export interface Position {
  record: LaunchRecord;
  /** Raw token balance. */
  balanceWei: string;
  /** Share of total supply, as a percentage. */
  supplyPct: number;
}

export interface WalletScan {
  wallet: Address;
  positions: Position[];
  /** How many launches were checked. The denominator of everything below. */
  checked: number;
  /** False when a balance read failed: the position list is a floor. */
  complete: boolean;
}

/**
 * Balance-check a wallet against a known launch list.
 *
 * One read per launch, through the gate. Passing the whole index here on a
 * public RPC will take a while and get throttled, so callers should narrow with
 * `--since` first.
 */
export async function readWalletPositions(
  client: PublicClient,
  gate: RpcGate,
  wallet: Address,
  launches: readonly LaunchRecord[],
): Promise<WalletScan> {
  const positions: Position[] = [];
  let complete = true;

  for (const record of launches) {
    try {
      const balance = await gate.retry(() =>
        client.readContract({
          address: record.token,
          abi: tokenAbi,
          functionName: "balanceOf",
          args: [wallet],
        }),
      );
      if ((balance as bigint) === 0n) continue;

      const supply = await gate
        .retry(() =>
          client.readContract({ address: record.token, abi: tokenAbi, functionName: "totalSupply" }),
        )
        .catch(() => 0n);

      positions.push({
        record,
        balanceWei: (balance as bigint).toString(),
        supplyPct:
          (supply as bigint) > 0n
            ? Number(((balance as bigint) * 1_000_000n) / (supply as bigint)) / 10_000
            : 0,
      });
    } catch (err) {
      complete = false;
      warn(`balance read failed for ${record.symbol}: ${(err as Error).message}`);
    }
  }

  return { wallet, positions, checked: launches.length, complete };
}

/**
 * The demo path: read balances out of the fixture's own buyer lists.
 *
 * Fixtures do not carry balances, so a wallet that appears as an early buyer is
 * treated as still holding. That is enough to exercise the command end to end,
 * and the banner says the data is fixture data.
 */
export function positionsFromFixtures(
  wallet: Address,
  launches: readonly LaunchRecord[],
): WalletScan {
  const key = wallet.toLowerCase();
  const positions: Position[] = [];
  for (const record of launches) {
    const bought = record.buyers?.some((b) => b.wallet.toLowerCase() === key);
    if (!bought) continue;
    positions.push({ record, balanceWei: "0", supplyPct: 0 });
  }
  return { wallet, positions, checked: launches.length, complete: true };
}
