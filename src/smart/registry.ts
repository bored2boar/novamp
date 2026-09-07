/**
 * The set of wallets whose entries are worth noticing.
 *
 * A wallet earns a place by outcome, not by follower count. The registry is
 * built once from launch history: for every wallet that bought early, how many
 * of those launches reached phase 2, and how consistently it entered rather
 * than caught one lottery ticket.
 *
 * The shipped registry is a file, not a service. That is on purpose: you can
 * read it, argue with it, delete a wallet you think is luck, or rebuild it from
 * your own window with `novamp smart build`.
 */

import { readFile } from "node:fs/promises";
import type { Address, Buyer } from "../types.js";

export interface SmartWallet {
  address: Address;
  /** Early entries inside the window the registry was built from. */
  entries: number;
  /** How many of those launches reached the pool phase. */
  graduated: number;
  /** graduated / entries, precomputed so the table does not do arithmetic. */
  hitRate: number;
  /** Median seconds between launch and this wallet's buy. */
  medianLagSec: number;
  /**
   * Share of this wallet's graduated entries that came from its single best
   * launch. High means one lucky ticket wearing a track record's clothes.
   */
  topEntryShare: number;
  note?: string;
}

export interface Registry {
  /** Where the numbers came from, so nobody has to guess. */
  source: string;
  builtAt: string;
  windowBlocks: number;
  wallets: SmartWallet[];
}

export const EMPTY_REGISTRY: Registry = {
  source: "empty",
  builtAt: "1970-01-01T00:00:00Z",
  windowBlocks: 0,
  wallets: [],
};

/**
 * Does this wallet clear the bar?
 *
 * Deliberately strict. A registry that lets in every wallet with one graduation
 * turns the convergence signal into noise, and the convergence signal is the
 * only part of novamp that could ever be called alpha.
 */
export function qualifies(wallet: SmartWallet): boolean {
  if (wallet.entries < 8) return false;
  if (wallet.graduated < 3) return false;
  if (wallet.hitRate < 0.12) return false;
  // One trade carrying the whole record is a lottery ticket, not a method.
  if (wallet.topEntryShare > 0.6) return false;
  return true;
}

export async function loadRegistry(path: string): Promise<Registry> {
  try {
    const text = await readFile(path, "utf8");
    const parsed = JSON.parse(text) as Registry;
    if (!Array.isArray(parsed.wallets)) throw new Error("registry has no wallets array");
    return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return EMPTY_REGISTRY;
    throw err;
  }
}

/** Lowercased lookup set, built once per command run. */
export function indexOf(registry: Registry): Map<string, SmartWallet> {
  const map = new Map<string, SmartWallet>();
  for (const wallet of registry.wallets) {
    if (!qualifies(wallet)) continue;
    map.set(wallet.address.toLowerCase(), wallet);
  }
  return map;
}

/** Which registered wallets show up in a launch's early buyers. */
export function matchBuyers(
  buyers: readonly Buyer[] | undefined,
  index: Map<string, SmartWallet>,
): { wallet: SmartWallet; buyer: Buyer }[] {
  if (!buyers) return [];
  const out: { wallet: SmartWallet; buyer: Buyer }[] = [];
  for (const buyer of buyers) {
    const wallet = index.get(buyer.wallet.toLowerCase());
    if (wallet) out.push({ wallet, buyer });
  }
  return out.sort((a, b) => a.buyer.entryLagSec - b.buyer.entryLagSec);
}
