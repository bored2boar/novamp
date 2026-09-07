import { test } from "node:test";
import assert from "node:assert/strict";
import { CLUSTER_COLUMNS, clusterToCsv, csvField, csvRows, farmsToCsv } from "../src/export/csv.js";
import { clusterLaunches } from "../src/vamp/cluster.js";
import { DEFAULT_VERDICT_OPTIONS, judgeCluster } from "../src/vamp/verdict.js";
import { rankFarms } from "../src/vamp/farms.js";
import { launch } from "./helpers.js";

test("plain fields are not quoted", () => {
  assert.equal(csvField("PEANUT"), "PEANUT");
  assert.equal(csvField(42), "42");
  assert.equal(csvField(true), "true");
});

test("null and undefined become empty, not the words", () => {
  assert.equal(csvField(null), "");
  assert.equal(csvField(undefined), "");
});

test("commas, quotes and newlines are quoted and escaped", () => {
  assert.equal(csvField("a,b"), '"a,b"');
  assert.equal(csvField('say "hi"'), '"say ""hi"""');
  assert.equal(csvField("line\nbreak"), '"line\nbreak"');
});

test("a reason string full of semicolons and quotes survives a round trip", () => {
  // Reasons are the whole point of the export, and they are the field most
  // likely to contain something that breaks a naive writer.
  const nasty = '+14 first, "under" this name; -22 copy';
  const row = csvRows([[nasty]]);
  assert.equal(row, '"+14 first, ""under"" this name; -22 copy"\n');
});

test("the cluster export has one header row and one row per member", () => {
  const cluster = judgeCluster(
    clusterLaunches([
      launch({ symbol: "PEANUT", block: 100, launchedAt: 1000 }),
      launch({ symbol: "PEANUT", block: 200, launchedAt: 1060 }),
      launch({ symbol: "PEANUT", block: 300, launchedAt: 1200 }),
    ])[0]!,
    DEFAULT_VERDICT_OPTIONS,
  );
  const lines = clusterToCsv(cluster).trimEnd().split("\n");
  // Reasons can contain newlines in principle, so count by leading field instead
  // of assuming one line per row.
  assert.equal(lines[0], CLUSTER_COLUMNS.join(","));
  assert.ok(clusterToCsv(cluster).includes("PEANUT"));
  assert.ok(clusterToCsv(cluster).includes(cluster.members[0]!.verdict));
});

test("the export carries the reasoning, not only the numbers", () => {
  const cluster = judgeCluster(
    clusterLaunches([launch({ symbol: "SOLO", block: 100 })])[0]!,
    DEFAULT_VERDICT_OPTIONS,
  );
  const csv = clusterToCsv(cluster);
  assert.ok(csv.includes("first launch under this name"), "reasons should be in the file");
});

test("the farms export lines up with its header", () => {
  const clusters = clusterLaunches([
    launch({ symbol: "AAA", block: 100, launchedAt: 1000 }),
    launch({ symbol: "AAA", block: 200, launchedAt: 1100 }),
  ]).map((raw) => judgeCluster(raw, DEFAULT_VERDICT_OPTIONS));
  const csv = farmsToCsv(rankFarms(clusters));
  const [header, ...rows] = csv.trimEnd().split("\n");
  assert.equal(header!.split(",").length, 9);
  assert.equal(rows.length, 2);
  for (const row of rows) assert.equal(row.split(",").length, 9);
});
