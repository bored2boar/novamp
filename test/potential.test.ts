import { test } from "node:test";
import assert from "node:assert/strict";
import { potentialOf } from "../src/vamp/potential.js";
import { detectConvergence } from "../src/smart/convergence.js";
import { buyer, launch } from "./helpers.js";
import type { Address } from "../src/types.js";
import type { SmartWallet } from "../src/smart/registry.js";

const none = detectConvergence([]);

function base(overrides: Parameters<typeof potentialOf>[0] extends infer T ? Partial<T> : never = {}) {
  return potentialOf({
    record: launch(),
    rank: 1,
    clusterSize: 1,
    lagSec: 0,
    convergence: none,
    firstBornTainted: false,
    top10Pct: 14,
    ...overrides,
  });
}

test("every point in the total is explained by a reason", () => {
  const result = base();
  const summed = result.reasons.reduce((total, reason) => total + reason.points, 35);
  assert.equal(result.score, Math.max(0, Math.min(100, summed)));
});

test("the score never leaves 0..100", () => {
  const awful = base({
    record: launch({
      devSharePct: 60,
      exemptWallets: 12,
      socials: {},
      curveProgress: 0,
      uniqueEarlyBuyers: 0,
      deployerRecord: { priorLaunches: 200, graduated: 0 },
    }),
    rank: 9,
    lagSec: 4000,
    top10Pct: 80,
  });
  assert.equal(awful.score, 0);
  assert.ok(awful.reasons.length > 4);
});

test("being first is worth more than being second", () => {
  const first = base({ rank: 1, lagSec: 0 });
  const second = base({ rank: 2, lagSec: 60 });
  assert.ok(first.score > second.score);
});

test("a copy far behind loses more than a copy right behind", () => {
  const close = base({ rank: 2, lagSec: 30 });
  const late = base({ rank: 2, lagSec: 900 });
  assert.ok(late.score < close.score);
});

test("converging proven wallets are the biggest single positive", () => {
  const smart: SmartWallet = {
    address: "0x1111111111111111111111111111111111111111" as Address,
    entries: 30,
    graduated: 6,
    hitRate: 0.2,
    medianLagSec: 12,
    topEntryShare: 0.3,
  };
  const converged = detectConvergence([
    { wallet: smart, buyer: buyer("0x1111111111111111111111111111111111111111", 5) },
    { wallet: smart, buyer: buyer("0x2222222222222222222222222222222222222222", 20) },
    { wallet: smart, buyer: buyer("0x3333333333333333333333333333333333333333", 35) },
  ]);
  const withSmart = base({ convergence: converged });
  const withoutSmart = base();
  assert.ok(withSmart.score - withoutSmart.score >= 15);
});

test("a launch where only bots bought is penalised for it", () => {
  const bots = launch({
    buyers: Array.from({ length: 6 }, (_, i) => buyer(`0x${String(i).repeat(40)}`, i, 9900)),
  });
  const humans = launch({
    buyers: Array.from({ length: 6 }, (_, i) => buyer(`0x${String(i).repeat(40)}`, i, 20)),
  });
  assert.ok(base({ record: bots }).score < base({ record: humans }).score);
});

test("unread inputs cost nothing rather than being scored as zero", () => {
  const unread = base({
    record: launch({ uniqueEarlyBuyers: undefined, buyers: undefined }),
    top10Pct: null,
  });
  assert.ok(unread.reasons.some((r) => r.text.includes("unread")));
  assert.ok(unread.reasons.filter((r) => r.text.includes("unread")).every((r) => r.points === 0));
});

test("a second-place launch behind a tainted first born is not punished for being second", () => {
  const punished = base({ rank: 2, lagSec: 60, firstBornTainted: false });
  const spared = base({ rank: 2, lagSec: 60, firstBornTainted: true });
  assert.ok(spared.score > punished.score);
});
