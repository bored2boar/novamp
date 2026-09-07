import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendLaunches, loadLaunches, mergeByToken, storeStats } from "../src/store/index.js";
import { launch } from "./helpers.js";

/** The store is relative to cwd, so each test gets its own directory. */
async function inTemp(fn: () => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "novamp-store-"));
  const before = process.cwd();
  process.chdir(dir);
  try {
    await fn();
  } finally {
    process.chdir(before);
    await rm(dir, { recursive: true, force: true });
  }
}

const now = () => Math.floor(Date.now() / 1000);

test("an empty store reads as empty rather than throwing", async () => {
  await inTemp(async () => {
    assert.deepEqual(await loadLaunches(null), []);
    const stats = await storeStats();
    assert.equal(stats.launches, 0);
    assert.equal(stats.coverage.spanSec, 0);
  });
});

test("what goes in comes back out", async () => {
  await inTemp(async () => {
    const records = [
      launch({ symbol: "AAA", launchedAt: now() - 100 }),
      launch({ symbol: "BBB", launchedAt: now() - 200 }),
    ];
    assert.equal(await appendLaunches(records), 2);
    const back = await loadLaunches(null);
    assert.equal(back.length, 2);
    assert.deepEqual(new Set(back.map((r) => r.symbol)), new Set(["AAA", "BBB"]));
  });
});

test("a launch is written once, however many times it is appended", async () => {
  await inTemp(async () => {
    const record = launch({ symbol: "AAA", launchedAt: now() - 10 });
    assert.equal(await appendLaunches([record]), 1);
    assert.equal(await appendLaunches([record]), 0);
    assert.equal(await appendLaunches([record, launch({ symbol: "BBB" })]), 1);
    assert.equal((await loadLaunches(null)).length, 2);
  });
});

test("the window filters on launch time", async () => {
  await inTemp(async () => {
    await appendLaunches([
      launch({ symbol: "OLD", launchedAt: now() - 10 * 86_400 }),
      launch({ symbol: "NEW", launchedAt: now() - 60 }),
    ]);
    const recent = await loadLaunches(3600);
    assert.equal(recent.length, 1);
    assert.equal(recent[0]!.symbol, "NEW");
    assert.equal((await loadLaunches(null)).length, 2);
  });
});

test("stats report the span the index actually covers", async () => {
  await inTemp(async () => {
    const t = now();
    await appendLaunches([
      launch({ symbol: "A", launchedAt: t - 4 * 86_400 }),
      launch({ symbol: "B", launchedAt: t }),
    ]);
    const stats = await storeStats();
    assert.equal(stats.launches, 2);
    assert.equal(stats.coverage.spanSec, 4 * 86_400);
    assert.ok(stats.files >= 1);
    assert.ok(stats.bytes > 0);
  });
});

test("a corrupt line is skipped, never fatal", async () => {
  await inTemp(async () => {
    await appendLaunches([launch({ symbol: "GOOD", launchedAt: now() })]);
    await mkdir(join(process.cwd(), ".novamp", "launches"), { recursive: true });
    await writeFile(
      join(process.cwd(), ".novamp", "launches", "1999-01-01.jsonl"),
      '{"broken": true\nnot json at all\n',
      "utf8",
    );
    const back = await loadLaunches(null);
    assert.equal(back.length, 1);
    const stats = await storeStats();
    assert.equal(stats.skippedLines, 2);
  });
});

test("a fresh read wins over what the index remembers", () => {
  const remembered = launch({ symbol: "AAA", curveProgress: 0.1 });
  const fresh = { ...remembered, curveProgress: 0.9 };
  const merged = mergeByToken([fresh], [remembered]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0]!.curveProgress, 0.9);
});

test("merging keeps launches that only the index has", () => {
  const remembered = launch({ symbol: "OLD" });
  const fresh = launch({ symbol: "NEW" });
  assert.equal(mergeByToken([fresh], [remembered]).length, 2);
});
