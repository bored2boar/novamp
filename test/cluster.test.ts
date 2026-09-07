import { test } from "node:test";
import assert from "node:assert/strict";
import { birthOrder, clusterLaunches, contestedOnly, findCluster } from "../src/vamp/cluster.js";
import { launch } from "./helpers.js";

test("launches with lookalike symbols land in one cluster", () => {
  const records = [
    launch({ symbol: "PEANUT", block: 100 }),
    launch({ symbol: "PEANUТ", block: 101 }), // cyrillic Te
    launch({ symbol: "PEAN0T", block: 102 }),
    launch({ symbol: "KETTLE", block: 103 }),
  ];
  const clusters = clusterLaunches(records);
  const peanut = clusters.find((c) => c.key === "peanut");
  assert.ok(peanut, "expected a peanut cluster");
  assert.equal(peanut.members.length, 3);
  assert.equal(clusters.length, 2);
});

test("birth order uses the block first, then position inside it", () => {
  const a = launch({ block: 100, txIndex: 9, logIndex: 0 });
  const b = launch({ block: 100, txIndex: 2, logIndex: 5 });
  const c = launch({ block: 99, txIndex: 99, logIndex: 99 });
  const sorted = [a, b, c].sort(birthOrder);
  assert.deepEqual(
    sorted.map((r) => r.block + ":" + r.txIndex),
    ["99:99", "100:2", "100:9"],
  );
});

test("the first born of a cluster is the first by birth order, not by array order", () => {
  const records = [
    launch({ symbol: "NOVA", block: 500 }),
    launch({ symbol: "NOVA", block: 200 }),
    launch({ symbol: "N0VA", block: 300 }),
  ];
  const cluster = clusterLaunches(records)[0]!;
  assert.equal(cluster.members[0]!.record.block, 200);
});

test("a query finds its cluster however the user typed it", () => {
  const records = [launch({ symbol: "PEANUT" }), launch({ symbol: "PEANUTCOIN" })];
  for (const query of ["PEANUT", "peanut", "$PEANUT", "Peanut!!"]) {
    const found = findCluster(records, query);
    assert.ok(found, `expected a cluster for ${query}`);
    assert.equal(found.members.length, 2);
  }
});

test("a query with nothing behind it returns null rather than a wrong cluster", () => {
  const records = [launch({ symbol: "PEANUT" })];
  assert.equal(findCluster(records, "kettle"), null);
});

test("join method is recorded so the table can explain itself", () => {
  const records = [
    launch({ symbol: "PEANUT", name: "Peanut the Squirrel", block: 100 }),
    launch({ symbol: "PEANUТ", name: "Peanut the Squirrel", block: 101 }),
    launch({ symbol: "PEANUTCOIN", name: "Peanut Coin", block: 102 }),
  ];
  const cluster = clusterLaunches(records)[0]!;
  assert.equal(cluster.members[0]!.joinedBy, "exact");
  assert.equal(cluster.members[1]!.joinedBy, "tight");
  assert.equal(cluster.members[2]!.joinedBy, "loose");
});

test("a different ticker under the same token name is still the same fight", () => {
  const records = [
    launch({ symbol: "PEANUT", name: "Peanut the Squirrel", block: 100 }),
    launch({ symbol: "PNUT", name: "Peanut the Squirrel", block: 140 }),
    launch({ symbol: "SQUIRREL", name: "Peanut the Squirrel", block: 180 }),
    launch({ symbol: "KETTLE", name: "Kettle", block: 200 }),
  ];
  const clusters = clusterLaunches(records);
  const fight = clusters.find((c) => c.members.length > 1)!;
  assert.equal(fight.members.length, 3);
  assert.equal(fight.members[1]!.joinedBy, "name");
  assert.equal(clusters.length, 2);
});

test("membership is transitive across the two fields", () => {
  // A shares a symbol with B; B shares a name with C. One fight, not two.
  const records = [
    launch({ symbol: "PEANUT", name: "Peanut", block: 100 }),
    launch({ symbol: "PEANUT", name: "Roadkill Squirrel", block: 110 }),
    launch({ symbol: "RKS", name: "Roadkill Squirrel", block: 120 }),
  ];
  const clusters = clusterLaunches(records);
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0]!.members.length, 3);
});

test("generic names do not drag unrelated launches together", () => {
  // Three characters is under the bar for a name join, so `Dog` and `Dog` do
  // not merge two different tickers on the strength of a word that short.
  const records = [
    launch({ symbol: "ALPHA", name: "Dog", block: 100 }),
    launch({ symbol: "BRAVO", name: "Dog", block: 110 }),
  ];
  assert.equal(clusterLaunches(records).length, 2);
});

test("a query matches on the token name, not only the ticker", () => {
  const records = [
    launch({ symbol: "PEANUT", name: "Peanut the Squirrel", block: 100 }),
    launch({ symbol: "PNUT", name: "Peanut the Squirrel", block: 140 }),
  ];
  const found = findCluster(records, "peanut the squirrel");
  assert.ok(found);
  assert.equal(found.members.length, 2);
});

test("launches with no readable name are dropped, not crashed on", () => {
  const records = [launch({ symbol: "🚀", name: "🚀" }), launch({ symbol: "PEANUT" })];
  const clusters = clusterLaunches(records);
  assert.equal(clusters.length, 1);
});

test("contestedOnly keeps the fights and drops the solos", () => {
  const records = [
    launch({ symbol: "PEANUT", block: 100 }),
    launch({ symbol: "PEANUT", block: 101 }),
    launch({ symbol: "KETTLE", block: 102 }),
  ];
  const fights = contestedOnly(clusterLaunches(records));
  assert.equal(fights.length, 1);
  assert.equal(fights[0]!.key, "peanut");
});
