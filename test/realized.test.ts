import { test } from "node:test";
import assert from "node:assert/strict";
import { buildWallets, DEFAULT_BUILD_OPTIONS, positionsByWallet } from "../src/smart/realized.js";
import { qualifies, type SmartWallet } from "../src/smart/registry.js";
import { summarizeSells } from "../src/vamp/flow.js";
import type { Address, LaunchRecord } from "../src/types.js";
import { buyer, launch, sell, wei } from "./helpers.js";

const A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

/** A launch where `wallet` bought `inEth` and got `outEth` back. */
function trade(wallet: string, inEth: number, outEth: number | null, lagSec = 10): LaunchRecord {
  const record = launch({
    buyers: [{ ...buyer(wallet, lagSec), quoteInWei: wei(inEth) }],
  });
  record.sellActivity = summarizeSells(
    outEth === null ? [] : [sell(wallet, 300, wei(outEth))],
    wei(inEth),
  );
  return record;
}

test("a buy and a later sale on the same token become one position", () => {
  const positions = positionsByWallet([trade(A, 1, 2)]);
  const mine = positions.get(A)!;
  assert.equal(mine.length, 1);
  assert.equal(mine[0]!.quoteInWei, BigInt(wei(1)));
  assert.equal(mine[0]!.quoteOutWei, BigInt(wei(2)));
});

test("a sale by somebody who never bought early is not counted against anyone", () => {
  const record = launch({ buyers: [{ ...buyer(A, 10), quoteInWei: wei(1) }] });
  record.sellActivity = summarizeSells([sell(B, 100, wei(9))], wei(1));
  const positions = positionsByWallet([record]);
  assert.equal(positions.has(B), false);
  assert.equal(positions.get(A)![0]!.quoteOutWei, 0n);
});

test("a late buy is not an early entry", () => {
  const record = launch({ buyers: [{ ...buyer(A, 4000), quoteInWei: wei(1) }] });
  assert.equal(positionsByWallet([record]).size, 0);
});

test("a position with no sale is open, not a loss", () => {
  const wallets = buildWallets(
    [trade(A, 1, null), trade(A, 1, null), trade(A, 1, 3), trade(A, 1, 2)],
    { ...DEFAULT_BUILD_OPTIONS, minEntries: 4 },
  );
  const mine = wallets.find((w) => w.address.toLowerCase() === A)!;
  assert.equal(mine.entries, 4);
  assert.equal(mine.closed, 2);
  assert.equal(mine.open, 2);
  assert.equal(mine.profitable, 2);
});

test("realizedMultiple is quote out over quote in, closed positions only", () => {
  const wallets = buildWallets([trade(A, 1, 3), trade(A, 1, 1), trade(A, 2, 2), trade(A, 1, null)], {
    ...DEFAULT_BUILD_OPTIONS,
    minEntries: 4,
  });
  const mine = wallets.find((w) => w.address.toLowerCase() === A)!;
  // in 4, out 6, across the three closed positions. The open one is ignored.
  assert.equal(mine.realizedMultiple, 1.5);
});

test("a wallet that never got its money back scores under 1", () => {
  const wallets = buildWallets([trade(A, 1, 0.2), trade(A, 1, 0.1), trade(A, 1, 0.4), trade(A, 1, 0.3)], {
    ...DEFAULT_BUILD_OPTIONS,
    minEntries: 4,
  });
  const mine = wallets.find((w) => w.address.toLowerCase() === A)!;
  assert.ok(mine.realizedMultiple < 1);
  assert.equal(mine.profitable, 0);
});

test("topEntryShare exposes one lucky ticket carrying the record", () => {
  const lottery = buildWallets(
    [trade(A, 1, 100), trade(A, 1, 1.01), trade(A, 1, 1.01), trade(A, 1, 1.01)],
    { ...DEFAULT_BUILD_OPTIONS, minEntries: 4 },
  ).find((w) => w.address.toLowerCase() === A)!;
  assert.ok(lottery.topEntryShare > 0.9, `expected concentration, got ${lottery.topEntryShare}`);

  const steady = buildWallets(
    [trade(A, 1, 2), trade(A, 1, 2), trade(A, 1, 2), trade(A, 1, 2)],
    { ...DEFAULT_BUILD_OPTIONS, minEntries: 4 },
  ).find((w) => w.address.toLowerCase() === A)!;
  assert.ok(steady.topEntryShare < 0.3);
});

test("losing positions do not dilute the concentration of the wins", () => {
  const wallets = buildWallets(
    [trade(A, 1, 10), trade(A, 1, 0.1), trade(A, 1, 0.1), trade(A, 1, 0.1)],
    { ...DEFAULT_BUILD_OPTIONS, minEntries: 4 },
  );
  const mine = wallets.find((w) => w.address.toLowerCase() === A)!;
  assert.equal(mine.topEntryShare, 1);
});

test("wallets under the entry floor are not written at all", () => {
  assert.equal(buildWallets([trade(A, 1, 2)], { ...DEFAULT_BUILD_OPTIONS, minEntries: 4 }).length, 0);
});

function wallet(overrides: Partial<SmartWallet> = {}): SmartWallet {
  return {
    address: A as Address,
    entries: 12,
    closed: 8,
    profitable: 5,
    realizedMultiple: 1.6,
    open: 4,
    medianLagSec: 14,
    topEntryShare: 0.3,
    ...overrides,
  };
}

test("the registry bar needs outcomes, not just entries", () => {
  assert.equal(qualifies(wallet()), true);
  // Forty entries and nothing sold tells you nothing about whether it is good.
  assert.equal(qualifies(wallet({ entries: 40, closed: 2, profitable: 2 })), false);
  assert.equal(qualifies(wallet({ entries: 4 })), false);
});

test("break even does not qualify", () => {
  assert.equal(qualifies(wallet({ realizedMultiple: 1.05 })), false);
  assert.equal(qualifies(wallet({ realizedMultiple: 1.16 })), true);
});

test("a lottery ticket does not qualify however good the multiple", () => {
  assert.equal(qualifies(wallet({ realizedMultiple: 12, topEntryShare: 0.95 })), false);
});

test("too few profitable positions does not qualify", () => {
  assert.equal(qualifies(wallet({ profitable: 2 })), false);
});
