import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_FLOW_OPTIONS,
  DEFAULT_SELL_OPTIONS,
  etherOf,
  medianWei,
  ratio,
  summarizeFlow,
  summarizeSells,
} from "../src/vamp/flow.js";
import { buyer, sell, wei } from "./helpers.js";

const A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const C = "0xcccccccccccccccccccccccccccccccccccccccc";
const D = "0xdddddddddddddddddddddddddddddddddddddddd";

test("ratio keeps four decimals and never divides by zero", () => {
  assert.equal(ratio(1n, 4n), 0.25);
  assert.equal(ratio(1n, 3n), 0.3333);
  assert.equal(ratio(5n, 0n), 0);
});

test("ratio survives amounts that would overflow a plain number", () => {
  const huge = 10n ** 30n;
  assert.equal(ratio(huge / 2n, huge), 0.5);
});

test("median is a ticket somebody actually paid, not an average", () => {
  assert.equal(medianWei([1n, 2n, 3n]), 2n);
  // Even count takes the lower middle: the mean of two wei values is not a
  // ticket anybody paid, and this number exists to describe a real one.
  assert.equal(medianWei([1n, 2n, 3n, 100n]), 2n);
  assert.equal(medianWei([]), 0n);
});

test("flow measures money, not wallets", () => {
  const small = summarizeFlow(Array.from({ length: 25 }, (_, i) => buyer(A, i, 20)).map((b, i) => ({
    ...b,
    wallet: `0x${String(i).padStart(40, "0")}` as `0x${string}`,
    quoteInWei: wei(0.005),
  })));
  const big = summarizeFlow(Array.from({ length: 25 }, (_, i) => buyer(A, i, 20)).map((b, i) => ({
    ...b,
    wallet: `0x${String(i).padStart(40, "0")}` as `0x${string}`,
    quoteInWei: wei(0.5),
  })));
  assert.equal(small.uniqueBuyers, big.uniqueBuyers);
  assert.ok(etherOf(big.quoteInWei) > etherOf(small.quoteInWei) * 50);
});

test("top3Share catches one person wearing three wallets", () => {
  const flow = summarizeFlow([
    { ...buyer(A, 5), quoteInWei: wei(1) },
    { ...buyer(B, 6), quoteInWei: wei(1) },
    { ...buyer(C, 7), quoteInWei: wei(1) },
    { ...buyer(D, 8), quoteInWei: wei(0.1) },
  ]);
  assert.ok(flow.top3Share > 0.9, `expected a concentrated flow, got ${flow.top3Share}`);
});

test("a spread out flow scores a low top3Share", () => {
  const buyers = Array.from({ length: 20 }, (_, i) => ({
    ...buyer(`0x${String(i).padStart(40, "0")}`, i),
    quoteInWei: wei(0.1),
  }));
  assert.ok(summarizeFlow(buyers).top3Share < 0.2);
});

test("buys outside the early window are not early flow", () => {
  const flow = summarizeFlow(
    [
      { ...buyer(A, 10), quoteInWei: wei(1) },
      { ...buyer(B, 3600), quoteInWei: wei(50) },
    ],
    DEFAULT_FLOW_OPTIONS,
  );
  assert.equal(flow.uniqueBuyers, 1);
  assert.equal(etherOf(flow.quoteInWei), 1);
});

test("racedShare counts the wallets that paid the opening tax", () => {
  const flow = summarizeFlow([
    buyer(A, 1, 9900),
    buyer(B, 2, 9900),
    buyer(C, 3, 20),
    buyer(D, 4, 20),
  ]);
  assert.equal(flow.racedShare, 0.5);
});

test("no buyer list is unread, not empty", () => {
  const flow = summarizeFlow(undefined);
  assert.equal(flow.complete, false);
  assert.equal(flow.uniqueBuyers, 0);
});

test("sells are ordered and the first big one is found by share, not size", () => {
  const activity = summarizeSells(
    [
      sell(A, 300, wei(5), { shareOfReserve: 0.02 }),
      sell(B, 40, wei(0.2), { shareOfReserve: 0.31 }),
    ],
    wei(10),
  );
  // The 0.2 ETH sale is the significant one: it took a third of the reserve.
  assert.equal(activity.firstBigSellSec, 40);
  assert.equal(activity.largestShare, 0.31);
  assert.equal(activity.sells[0]!.atSec, 40);
});

test("a small early sale is not a big sell", () => {
  const activity = summarizeSells([sell(A, 20, wei(0.01), { shareOfReserve: 0.01 })], wei(10));
  assert.equal(activity.firstBigSellSec, null);
});

test("the deployer selling is reported with its timing", () => {
  const activity = summarizeSells(
    [sell(A, 90, wei(1), { isDeployer: true, shareOfReserve: 0.4 })],
    wei(3),
  );
  assert.equal(activity.deployerSold, true);
  assert.equal(activity.deployerSoldAtSec, 90);
});

test("sellBuyRatio compares what left against what went in", () => {
  const activity = summarizeSells([sell(A, 50, wei(4))], wei(8));
  assert.equal(activity.sellBuyRatio, 0.5);
});

test("no sell list is unread, not calm", () => {
  const activity = summarizeSells(undefined, wei(1));
  assert.equal(activity.complete, false);
  assert.equal(activity.deployerSold, false);
  assert.equal(activity.firstBigSellSec, null);
});

test("an empty sell list is calm, and says so", () => {
  const activity = summarizeSells([], wei(1), DEFAULT_SELL_OPTIONS);
  assert.equal(activity.complete, true);
  assert.equal(activity.sells.length, 0);
  assert.equal(activity.sellBuyRatio, 0);
});

test("etherOf keeps the small end of the range", () => {
  assert.equal(etherOf(wei(0.005)), 0.005);
  assert.equal(etherOf(wei(1234)), 1234);
});
