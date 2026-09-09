/** Minimal launch builder, so a test says only what it is actually testing. */

import type { Address, Buyer, HolderSnapshot, LaunchRecord, Sell } from "../src/types.js";

let counter = 0;

/**
 * A launch with sensible defaults.
 *
 * When a test does not care about the token name, the name is set to the symbol.
 * Giving every fixture the same placeholder name would silently join every
 * record in a test into one cluster now that novamp matches on the name too,
 * which is exactly the kind of shared default that makes a suite lie.
 */
export function launch(overrides: Partial<LaunchRecord> = {}): LaunchRecord {
  counter++;
  const hex = counter.toString(16).padStart(2, "0");
  const record: LaunchRecord = {
    token: `0x${hex}${"a".repeat(38)}` as Address,
    curve: `0x${hex}${"b".repeat(38)}` as Address,
    deployer: `0x${hex}${"c".repeat(38)}` as Address,
    name: "Test Launch",
    symbol: `TEST${counter}`,
    block: 1_000 + counter,
    txIndex: 0,
    logIndex: 0,
    launchedAt: 1_700_000_000 + counter,
    pairToken: `0x${"0".repeat(40)}` as Address,
    pairSymbol: "ETH",
    phase: 0,
    creatorTaxBps: 100,
    creatorFeeRecipient: `0x${hex}${"c".repeat(38)}` as Address,
    devSharePct: 3,
    exemptWallets: 0,
    socials: { twitter: "https://x.com/test" },
    quoteReserveWei: "1000000000000000000",
    curveProgress: 0.3,
    uniqueEarlyBuyers: 12,
    deployerRecord: { priorLaunches: 1, graduated: 0 },
    buyers: [],
    holders: holders(14, 3),
    ...overrides,
  };
  if (overrides.name === undefined) record.name = record.symbol;
  return record;
}

export function holders(top10Pct: number, deployerPct: number): HolderSnapshot {
  return {
    top: [{ wallet: `0x${"d".repeat(40)}` as Address, pct: top10Pct }],
    top10Pct,
    deployerPct,
    complete: true,
  };
}

export function buyer(address: string, lagSec: number, taxBps = 20): Buyer {
  return {
    wallet: address as Address,
    entryLagSec: lagSec,
    quoteInWei: "10000000000000000",
    taxPaidBps: taxBps,
  };
}

export function sell(
  address: string,
  atSec: number,
  quoteOutWei: string,
  overrides: { shareOfReserve?: number; isDeployer?: boolean } = {},
): Sell {
  return {
    wallet: address as Address,
    atSec,
    quoteOutWei,
    shareOfReserve: overrides.shareOfReserve ?? 0.01,
    isDeployer: overrides.isDeployer ?? false,
  };
}

/** One ether, as wei, for readable test amounts. */
export const ETH = 10n ** 18n;

export function wei(ether: number): string {
  return (BigInt(Math.round(ether * 1000)) * 10n ** 15n).toString();
}

export function resetCounter(): void {
  counter = 0;
}
