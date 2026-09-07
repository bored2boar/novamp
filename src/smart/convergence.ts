/**
 * Several proven wallets arriving at the same launch inside one window.
 *
 * One good wallet buying is a coincidence. Three inside ninety seconds is the
 * closest thing to a real signal that exists in this market, because those
 * wallets are not talking to each other through your timeline: they are reading
 * the same thing off the chain and reacting to it.
 *
 * Everything here is arithmetic over a buyer list. No model, no weighting that
 * is not written down in this file.
 */

import type { Buyer } from "../types.js";
import type { SmartWallet } from "./registry.js";

export interface ConvergenceOptions {
  windowSec: number;
  minWallets: number;
}

export const DEFAULT_CONVERGENCE: ConvergenceOptions = {
  windowSec: 90,
  minWallets: 3,
};

export interface ConvergenceResult {
  /** Registered wallets found in this launch at all. */
  count: number;
  /** True when `minWallets` of them landed inside `windowSec` of each other. */
  converged: boolean;
  /** Lag of the first wallet in the tightest qualifying window. */
  firstLagSec: number | null;
  /** Width of that window, in seconds. */
  spreadSec: number | null;
  members: { wallet: SmartWallet; buyer: Buyer }[];
}

/**
 * Sliding window over the matched buyers, ordered by entry lag.
 *
 * The tightest window wins, not the first one found: a launch where four
 * wallets landed in eleven seconds and a fifth wandered in an hour later should
 * report eleven seconds, because that is the thing that happened.
 */
export function detectConvergence(
  matched: readonly { wallet: SmartWallet; buyer: Buyer }[],
  options: ConvergenceOptions = DEFAULT_CONVERGENCE,
): ConvergenceResult {
  const members = [...matched].sort((a, b) => a.buyer.entryLagSec - b.buyer.entryLagSec);
  const base: ConvergenceResult = {
    count: members.length,
    converged: false,
    firstLagSec: members.length ? members[0]!.buyer.entryLagSec : null,
    spreadSec: null,
    members,
  };
  if (members.length < options.minWallets) return base;

  let bestStart = -1;
  let bestSpread = Number.POSITIVE_INFINITY;

  let left = 0;
  for (let right = 0; right < members.length; right++) {
    while (members[right]!.buyer.entryLagSec - members[left]!.buyer.entryLagSec > options.windowSec) {
      left++;
    }
    const inWindow = right - left + 1;
    if (inWindow < options.minWallets) continue;
    const spread = members[right]!.buyer.entryLagSec - members[left]!.buyer.entryLagSec;
    if (spread < bestSpread) {
      bestSpread = spread;
      bestStart = left;
    }
  }

  if (bestStart < 0) return base;
  return {
    ...base,
    converged: true,
    firstLagSec: members[bestStart]!.buyer.entryLagSec,
    spreadSec: bestSpread,
  };
}
