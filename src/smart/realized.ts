/**
 * Building the proven-wallet registry from what wallets actually got back.
 *
 * The previous method counted graduations: a wallet was credited whenever a
 * launch it entered later reached the pool. That is a bad proxy and it was
 * documented as one. A wallet can be early to ten launches that all graduated
 * and still have lost money on every single one, because entering early and
 * exiting well are different skills and only the second one pays.
 *
 * This measures the thing itself. For every wallet, on every launch it entered
 * early, how much quote went in and how much came back out. A position with no
 * sale is not counted as a win or a loss, it is counted as unknown, and a wallet
 * whose positions are nearly all unknown cannot qualify.
 *
 * Pure arithmetic over `LaunchRecord[]`. No network, fully testable offline.
 */

import type { Address, LaunchRecord } from "../types.js";
import type { SmartWallet } from "./registry.js";

/** Buys later than this do not count as an early entry. */
export const ENTRY_WINDOW_SEC = 120;

export interface Position {
  token: string;
  quoteInWei: bigint;
  quoteOutWei: bigint;
  entryLagSec: number;
}

function toWei(value: string): bigint {
  try {
    return BigInt(value || "0");
  } catch {
    return 0n;
  }
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Group every early entry in the window into per-wallet positions.
 *
 * A caveat that matters: the buyer list holds each wallet's *first* buy on a
 * launch, so a wallet that added later has its entry understated and its
 * multiple overstated. Fixing that means keeping every buy rather than the
 * first, which is a heavier read; until then this is a floor on the money in,
 * and the registry is built to be strict enough to survive it.
 */
export function positionsByWallet(
  launches: readonly LaunchRecord[],
  entryWindowSec = ENTRY_WINDOW_SEC,
): Map<string, Position[]> {
  const byWallet = new Map<string, Map<string, Position>>();

  for (const launch of launches) {
    const token = launch.token.toLowerCase();

    for (const buyer of launch.buyers ?? []) {
      if (buyer.entryLagSec > entryWindowSec) continue;
      const wallet = buyer.wallet.toLowerCase();
      const positions = byWallet.get(wallet) ?? new Map<string, Position>();
      const existing = positions.get(token);
      if (existing) {
        existing.quoteInWei += toWei(buyer.quoteInWei);
      } else {
        positions.set(token, {
          token,
          quoteInWei: toWei(buyer.quoteInWei),
          quoteOutWei: 0n,
          entryLagSec: buyer.entryLagSec,
        });
      }
      byWallet.set(wallet, positions);
    }

    for (const sale of launch.sellActivity?.sells ?? []) {
      const wallet = sale.wallet.toLowerCase();
      const position = byWallet.get(wallet)?.get(token);
      // A sale by a wallet that never appeared as an early buyer is somebody who
      // entered later. It is not this wallet's early-entry record, so it is not
      // counted for or against it.
      if (!position) continue;
      position.quoteOutWei += toWei(sale.quoteOutWei);
    }
  }

  const out = new Map<string, Position[]>();
  for (const [wallet, positions] of byWallet) out.set(wallet, [...positions.values()]);
  return out;
}

export interface BuildOptions {
  entryWindowSec: number;
  /** Wallets with fewer entries than this are not written to the registry at all. */
  minEntries: number;
}

export const DEFAULT_BUILD_OPTIONS: BuildOptions = {
  entryWindowSec: ENTRY_WINDOW_SEC,
  minEntries: 4,
};

export function buildWallets(
  launches: readonly LaunchRecord[],
  options: BuildOptions = DEFAULT_BUILD_OPTIONS,
): SmartWallet[] {
  const wallets: SmartWallet[] = [];

  for (const [address, positions] of positionsByWallet(launches, options.entryWindowSec)) {
    if (positions.length < options.minEntries) continue;

    const closed = positions.filter((p) => p.quoteOutWei > 0n);
    const profitable = closed.filter((p) => p.quoteOutWei > p.quoteInWei);

    const inClosed = closed.reduce((sum, p) => sum + p.quoteInWei, 0n);
    const outClosed = closed.reduce((sum, p) => sum + p.quoteOutWei, 0n);
    const realizedMultiple =
      inClosed > 0n ? Number((outClosed * 10_000n) / inClosed) / 10_000 : 0;

    // Gains only. A losing position does not reduce the concentration of the
    // wins, it just is not one of them.
    const gains = closed.map((p) => (p.quoteOutWei > p.quoteInWei ? p.quoteOutWei - p.quoteInWei : 0n));
    const totalGain = gains.reduce((sum, g) => sum + g, 0n);
    const bestGain = gains.reduce((max, g) => (g > max ? g : max), 0n);
    const topEntryShare = totalGain > 0n ? Number((bestGain * 10_000n) / totalGain) / 10_000 : 0;

    wallets.push({
      address: address as Address,
      entries: positions.length,
      closed: closed.length,
      profitable: profitable.length,
      realizedMultiple,
      open: positions.length - closed.length,
      medianLagSec: median(positions.map((p) => p.entryLagSec)),
      topEntryShare,
    });
  }

  return wallets.sort(
    (a, b) => b.realizedMultiple - a.realizedMultiple || b.profitable - a.profitable,
  );
}
