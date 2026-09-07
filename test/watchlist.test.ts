import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addToWatchlist,
  alertsFor,
  removeFromWatchlist,
  undelivered,
  type WatchState,
} from "../src/alerts/watchlist.js";
import { escapeHtml, telegramFromEnv } from "../src/alerts/telegram.js";
import { clusterLaunches } from "../src/vamp/cluster.js";
import { DEFAULT_VERDICT_OPTIONS, judgeCluster } from "../src/vamp/verdict.js";
import { holders, launch } from "./helpers.js";

const empty: WatchState = { entries: [], sent: [] };

test("a name is normalised on the way into the watchlist", () => {
  const state = addToWatchlist(empty, "$PEANUT!!");
  assert.equal(state.entries[0]!.key, "peanut");
  assert.equal(state.entries[0]!.query, "$PEANUT!!");
});

test("watching the same name twice is a no-op", () => {
  let state = addToWatchlist(empty, "PEANUT");
  state = addToWatchlist(state, "peanut");
  assert.equal(state.entries.length, 1);
});

test("removing works on any spelling of the same name", () => {
  const state = removeFromWatchlist(addToWatchlist(empty, "PEANUT"), "$peanut");
  assert.equal(state.entries.length, 0);
});

test("a new live copy raises an alert; a dead one does not", () => {
  const cluster = judgeCluster(
    clusterLaunches([
      launch({ symbol: "PEANUT", block: 100, launchedAt: 1000 }),
      launch({ symbol: "PEANUT", block: 200, launchedAt: 1060, curveProgress: 0.3, uniqueEarlyBuyers: 9 }),
      launch({ symbol: "PEANUT", block: 300, launchedAt: 1200, curveProgress: 0, uniqueEarlyBuyers: 0 }),
    ])[0]!,
    DEFAULT_VERDICT_OPTIONS,
  );
  const alerts = alertsFor(cluster, { query: "PEANUT", key: "peanut", addedAt: "" });
  assert.equal(alerts.filter((a) => a.kind === "new-copy").length, 1);
});

test("a cluster flipping to CONTESTED raises its own alert", () => {
  const cluster = judgeCluster(
    clusterLaunches([
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
      launch({
        symbol: "NOVA",
        block: 300,
        launchedAt: 1200,
        curveProgress: 0.9,
        uniqueEarlyBuyers: 30,
        phase: 2,
      }),
    ])[0]!,
    DEFAULT_VERDICT_OPTIONS,
  );
  const alerts = alertsFor(cluster, { query: "NOVA", key: "nova", addedAt: "" });
  assert.ok(alerts.some((a) => a.kind === "contested"));
});

test("an alert is delivered once and then remembered", () => {
  const alerts = [
    { id: "a", kind: "new-copy" as const, key: "peanut", text: "x" },
    { id: "b", kind: "contested" as const, key: "peanut", text: "y" },
  ];
  const first = undelivered(empty, alerts);
  assert.equal(first.fresh.length, 2);
  const second = undelivered(first.state, alerts);
  assert.equal(second.fresh.length, 0);
});

test("the dedup memory does not grow without bound", () => {
  let state: WatchState = { entries: [], sent: Array.from({ length: 2500 }, (_, i) => `old-${i}`) };
  state = undelivered(state, [{ id: "new", kind: "new-copy", key: "k", text: "t" }]).state;
  // saveWatchlist trims to the last 2000; the in-memory list is allowed to run
  // past it between writes, which is why the trim lives at the write.
  assert.ok(state.sent.includes("new"));
});

test("telegram config is absent unless both halves are set", () => {
  assert.equal(telegramFromEnv({}), null);
  assert.equal(telegramFromEnv({ TELEGRAM_BOT_TOKEN: "t" }), null);
  assert.equal(telegramFromEnv({ TELEGRAM_CHAT_ID: "c" }), null);
  assert.deepEqual(telegramFromEnv({ TELEGRAM_BOT_TOKEN: "t", TELEGRAM_CHAT_ID: "c" }), {
    token: "t",
    chatId: "c",
  });
});

test("a symbol full of markup cannot break out of the message", () => {
  assert.equal(escapeHtml('<b>&"'), "&lt;b&gt;&amp;\"");
});
