import { test } from "node:test";
import assert from "node:assert/strict";
import { clusterLaunches } from "../src/vamp/cluster.js";
import { DEFAULT_VERDICT_OPTIONS, judgeCluster, taintOf } from "../src/vamp/verdict.js";
import type { SmartWallet } from "../src/smart/registry.js";
import type { Address } from "../src/types.js";
import { buyer, holders, launch } from "./helpers.js";

const SMART_A = "0x1111111111111111111111111111111111111111";
const SMART_B = "0x2222222222222222222222222222222222222222";
const SMART_C = "0x3333333333333333333333333333333333333333";

function smartIndex(): Map<string, SmartWallet> {
  const map = new Map<string, SmartWallet>();
  for (const address of [SMART_A, SMART_B, SMART_C]) {
    map.set(address, {
      address: address as Address,
      entries: 30,
      graduated: 6,
      hitRate: 0.2,
      medianLagSec: 12,
      topEntryShare: 0.3,
    });
  }
  return map;
}

const options = { ...DEFAULT_VERDICT_OPTIONS, smartIndex: smartIndex() };

test("a clean first born is the ORIGINAL and the copies are VAMPs", () => {
  const records = [
    launch({ symbol: "PEANUT", block: 100, launchedAt: 1000 }),
    launch({ symbol: "PEANUТ", block: 140, launchedAt: 1040, devSharePct: 2, curveProgress: 0.2 }),
  ];
  const cluster = judgeCluster(clusterLaunches(records)[0]!, options);
  assert.equal(cluster.members[0]!.verdict, "ORIGINAL");
  assert.equal(cluster.members[1]!.verdict, "VAMP");
  assert.equal(cluster.verdict, "CLEAN");
});

test("two grounds make a first born TAINTED, one does not", () => {
  const one = launch({ devSharePct: 14 });
  assert.equal(taintOf(one, [one], options).tainted, false);

  const two = launch({ devSharePct: 14, exemptWallets: 6 });
  assert.equal(taintOf(two, [two], options).tainted, true);
});

test("a shared funder inside the cluster counts as a ground on its own", () => {
  const funder = "0x9999999999999999999999999999999999999999" as Address;
  const first = launch({
    symbol: "NOVA",
    devSharePct: 14,
    deployerRecord: { priorLaunches: 2, graduated: 0, fundedBy: funder },
  });
  const copy = launch({
    symbol: "NOVA",
    deployerRecord: { priorLaunches: 2, graduated: 0, fundedBy: funder },
  });
  const result = taintOf(first, [first, copy], options);
  assert.equal(result.tainted, true);
  assert.ok(result.grounds.some((g) => g.includes("funded from the same wallet")));
});

test("when the first born is bait, the launch with the flow becomes CONTESTED", () => {
  const records = [
    launch({
      symbol: "NOVA",
      block: 100,
      launchedAt: 1000,
      devSharePct: 15,
      exemptWallets: 8,
      curveProgress: 0.05,
      uniqueEarlyBuyers: 2,
      holders: holders(48, 15),
    }),
    launch({ symbol: "N0VA", block: 120, launchedAt: 1020, curveProgress: 0.01, uniqueEarlyBuyers: 0 }),
    launch({
      symbol: "NOVA",
      block: 200,
      launchedAt: 1100,
      curveProgress: 0.9,
      uniqueEarlyBuyers: 30,
      buyers: [buyer(SMART_A, 10), buyer(SMART_B, 25), buyer(SMART_C, 40)],
    }),
  ];
  const cluster = judgeCluster(clusterLaunches(records)[0]!, options);
  assert.equal(cluster.members[0]!.verdict, "TAINTED");
  assert.equal(cluster.members[2]!.verdict, "CONTESTED");
  assert.ok(cluster.notes.some((n) => n.includes("flow is on")));
});

test("a cluster where two members share a funder is a FARM", () => {
  const funder = "0x8888888888888888888888888888888888888888" as Address;
  const records = [
    launch({ symbol: "NOVA", block: 100, deployerRecord: { priorLaunches: 1, graduated: 0, fundedBy: funder } }),
    launch({ symbol: "N0VA", block: 110, deployerRecord: { priorLaunches: 1, graduated: 0, fundedBy: funder } }),
  ];
  const cluster = judgeCluster(clusterLaunches(records)[0]!, options);
  assert.equal(cluster.verdict, "FARM");
});

test("a single launch under a name is SOLO, never a vamp", () => {
  const cluster = judgeCluster(clusterLaunches([launch({ symbol: "KETTLE" })])[0]!, options);
  assert.equal(cluster.verdict, "SOLO");
  assert.equal(cluster.members.length, 1);
  assert.equal(cluster.vampLagSec, null);
});

test("a launch nobody traded is DEAD rather than merely low scoring", () => {
  const records = [
    launch({ symbol: "PEANUT", block: 100, launchedAt: 1000 }),
    launch({
      symbol: "PEANUT",
      block: 150,
      launchedAt: 1050,
      curveProgress: 0,
      uniqueEarlyBuyers: 0,
    }),
  ];
  const cluster = judgeCluster(clusterLaunches(records)[0]!, options);
  assert.equal(cluster.members[1]!.verdict, "DEAD");
});

test("vamp lag is measured against the first born, not the previous copy", () => {
  const records = [
    launch({ symbol: "PEANUT", block: 100, launchedAt: 1000 }),
    launch({ symbol: "PEANUT", block: 200, launchedAt: 1060 }),
    launch({ symbol: "PEANUT", block: 300, launchedAt: 1200 }),
  ];
  const cluster = judgeCluster(clusterLaunches(records)[0]!, options);
  assert.equal(cluster.vampLagSec, 60);
  assert.equal(cluster.members[2]!.lagSec, 200);
});
