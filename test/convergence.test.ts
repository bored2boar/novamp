import { test } from "node:test";
import assert from "node:assert/strict";
import { detectConvergence } from "../src/smart/convergence.js";
import { matchBuyers, qualifies, indexOf, type Registry, type SmartWallet } from "../src/smart/registry.js";
import type { Address } from "../src/types.js";
import { buyer } from "./helpers.js";

function wallet(address: string, overrides: Partial<SmartWallet> = {}): SmartWallet {
  return {
    address: address as Address,
    entries: 30,
    closed: 20,
    profitable: 9,
    realizedMultiple: 1.7,
    open: 10,
    medianLagSec: 12,
    topEntryShare: 0.3,
    ...overrides,
  };
}

const A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const C = "0xcccccccccccccccccccccccccccccccccccccccc";
const D = "0xdddddddddddddddddddddddddddddddddddddddd";

const matched = (pairs: [string, number][]) =>
  pairs.map(([address, lag]) => ({ wallet: wallet(address), buyer: buyer(address, lag) }));

test("three wallets inside the window converge", () => {
  const result = detectConvergence(matched([[A, 5], [B, 30], [C, 70]]));
  assert.equal(result.converged, true);
  assert.equal(result.count, 3);
  assert.equal(result.spreadSec, 65);
});

test("three wallets spread over an hour do not", () => {
  const result = detectConvergence(matched([[A, 5], [B, 1800], [C, 3600]]));
  assert.equal(result.converged, false);
  assert.equal(result.count, 3);
});

test("two wallets never converge, however close", () => {
  const result = detectConvergence(matched([[A, 5], [B, 6]]));
  assert.equal(result.converged, false);
});

test("the tightest window wins, not the first one found", () => {
  // Three in eleven seconds, plus a straggler an hour later.
  const result = detectConvergence(matched([[A, 100], [B, 105], [C, 111], [D, 3700]]));
  assert.equal(result.converged, true);
  assert.equal(result.spreadSec, 11);
  assert.equal(result.firstLagSec, 100);
});

test("no matches is a clean zero, not a crash", () => {
  const result = detectConvergence([]);
  assert.equal(result.count, 0);
  assert.equal(result.converged, false);
  assert.equal(result.firstLagSec, null);
});

test("a lottery ticket wallet does not qualify for the registry", () => {
  assert.equal(qualifies(wallet(A)), true);
  assert.equal(qualifies(wallet(A, { topEntryShare: 0.9 })), false);
  assert.equal(qualifies(wallet(A, { entries: 3 })), false);
  assert.equal(qualifies(wallet(A, { profitable: 1 })), false);
  assert.equal(qualifies(wallet(A, { realizedMultiple: 0.9 })), false);
  assert.equal(qualifies(wallet(A, { closed: 2 })), false);
});

test("the index only contains wallets that qualify", () => {
  const registry: Registry = {
    source: "test",
    builtAt: "2026-01-01T00:00:00Z",
    windowBlocks: 1,
    wallets: [wallet(A), wallet(B, { topEntryShare: 0.95 })],
  };
  const index = indexOf(registry);
  assert.equal(index.size, 1);
  assert.ok(index.has(A));
});

test("matching is case insensitive on the address", () => {
  const index = indexOf({
    source: "test",
    builtAt: "2026-01-01T00:00:00Z",
    windowBlocks: 1,
    wallets: [wallet(A.toUpperCase().replace("0X", "0x"))],
  });
  const hits = matchBuyers([buyer(A, 10)], index);
  assert.equal(hits.length, 1);
});
