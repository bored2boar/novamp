import { test } from "node:test";
import assert from "node:assert/strict";
import { clusterLaunches } from "../src/vamp/cluster.js";
import { DEFAULT_VERDICT_OPTIONS, judgeCluster } from "../src/vamp/verdict.js";
import { rankFarms, worstOffenders } from "../src/vamp/farms.js";
import type { Address } from "../src/types.js";
import { launch } from "./helpers.js";

const OPERATOR = "0xdddddddddddddddddddddddddddddddddddddddd" as Address;
const A = "0x1111111111111111111111111111111111111111" as Address;
const B = "0x2222222222222222222222222222222222222222" as Address;

function judged(records: Parameters<typeof clusterLaunches>[0]) {
  return clusterLaunches(records).map((raw) => judgeCluster(raw, DEFAULT_VERDICT_OPTIONS));
}

test("copies are counted against the deployer that shipped them", () => {
  const clusters = judged([
    launch({ symbol: "PEANUT", block: 100, launchedAt: 1000, deployer: A }),
    launch({ symbol: "PEANUT", block: 200, launchedAt: 1060, deployer: B }),
    launch({ symbol: "KETTLE", block: 300, launchedAt: 2000, deployer: B }),
    launch({ symbol: "KETTLE", block: 400, launchedAt: 2060, deployer: B }),
  ]);
  const farms = rankFarms(clusters);
  const b = farms.find((f) => f.deployer === B.toLowerCase())!;
  assert.equal(b.copies, 2);
  assert.equal(b.originals, 1);
  assert.equal(b.namesTouched, 2);
});

test("the ranking puts the busiest copier first", () => {
  const clusters = judged([
    launch({ symbol: "AAA", block: 100, launchedAt: 1000, deployer: A }),
    launch({ symbol: "AAA", block: 110, launchedAt: 1010, deployer: B }),
    launch({ symbol: "BBB", block: 200, launchedAt: 2000, deployer: A }),
    launch({ symbol: "BBB", block: 210, launchedAt: 2010, deployer: B }),
    launch({ symbol: "CCC", block: 300, launchedAt: 3000, deployer: A }),
    launch({ symbol: "CCC", block: 310, launchedAt: 3010, deployer: B }),
  ]);
  const farms = rankFarms(clusters);
  assert.equal(farms[0]!.deployer, B.toLowerCase());
  assert.equal(farms[0]!.copies, 3);
});

test("wallets sharing a funder are reported as one operation", () => {
  const clusters = judged([
    launch({ symbol: "AAA", block: 100, launchedAt: 1000, deployer: A }),
    launch({
      symbol: "AAA",
      block: 110,
      launchedAt: 1010,
      deployer: B,
      deployerRecord: { priorLaunches: 2, graduated: 0, fundedBy: OPERATOR },
    }),
    launch({
      symbol: "BBB",
      block: 200,
      launchedAt: 2000,
      deployer: "0x3333333333333333333333333333333333333333" as Address,
      deployerRecord: { priorLaunches: 2, graduated: 0, fundedBy: OPERATOR },
    }),
  ]);
  const farms = rankFarms(clusters);
  const funded = farms.filter((f) => f.fundedBy);
  assert.equal(funded.length, 2);
  for (const farm of funded) assert.equal(farm.siblings, 1);
});

test("median lag is over this deployer's copies only", () => {
  const clusters = judged([
    launch({ symbol: "AAA", block: 100, launchedAt: 1000, deployer: A }),
    launch({ symbol: "AAA", block: 200, launchedAt: 1100, deployer: B }),
    launch({ symbol: "BBB", block: 300, launchedAt: 2000, deployer: A }),
    launch({ symbol: "BBB", block: 400, launchedAt: 2300, deployer: B }),
  ]);
  const b = rankFarms(clusters).find((f) => f.deployer === B.toLowerCase())!;
  assert.equal(b.medianLagSec, 200);
});

test("worstOffenders is copies with nothing to show for them", () => {
  const clusters = judged([
    launch({ symbol: "AAA", block: 100, launchedAt: 1000, deployer: A }),
    launch({ symbol: "AAA", block: 110, launchedAt: 1010, deployer: B }),
    launch({ symbol: "BBB", block: 200, launchedAt: 2000, deployer: A }),
    launch({ symbol: "BBB", block: 210, launchedAt: 2010, deployer: B, phase: 2 }),
  ]);
  // B shipped two copies but one of them graduated, so it is not an offender.
  assert.equal(worstOffenders(rankFarms(clusters), 2).length, 0);
});

test("a deployer with no copies still appears, with zero", () => {
  const clusters = judged([launch({ symbol: "SOLO", deployer: A })]);
  const farms = rankFarms(clusters);
  assert.equal(farms.length, 1);
  assert.equal(farms[0]!.copies, 0);
  assert.equal(farms[0]!.originals, 1);
});
