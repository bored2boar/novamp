/**
 * `novamp watchlist` - names you want to hear about, and the loop that watches
 * them.
 *
 * `add`, `remove` and `list` edit a plain JSON file. `run` polls the chain and
 * sends what changed, to the terminal always and to Telegram when it is
 * configured.
 *
 * There is no hosted component here. When your laptop is shut, nothing is
 * watching, and that is the honest trade for a tool that holds nothing of yours.
 */

import { findCluster } from "../vamp/cluster.js";
import { judgeCluster } from "../vamp/verdict.js";
import {
  addToWatchlist,
  alertsFor,
  loadWatchlist,
  removeFromWatchlist,
  saveWatchlist,
  undelivered,
  type Alert,
} from "../alerts/watchlist.js";
import { sendTelegram, telegramFromEnv } from "../alerts/telegram.js";
import { makeContext } from "./context.js";
import { renderSourceLine } from "../ui/render.js";
import { renderTable } from "../ui/table.js";
import { bold, cyan, dim, green, grey, red, verdictColor, yellow } from "../ui/color.js";
import { sleep } from "../chain/gate.js";
import { config } from "../util/env.js";
import { fail, info } from "../util/log.js";

export async function watchlistAdd(query: string, note?: string): Promise<number> {
  const before = await loadWatchlist();
  const after = addToWatchlist(before, query, note);
  if (after.entries.length === before.entries.length) {
    process.stdout.write(`\n${yellow("already watching")} ${bold(query)}\n\n`);
    return 0;
  }
  await saveWatchlist(after);
  process.stdout.write(`\n${green("✓")} watching ${bold(query)} (${after.entries.length} total)\n\n`);
  return 0;
}

export async function watchlistRemove(query: string): Promise<number> {
  const before = await loadWatchlist();
  const after = removeFromWatchlist(before, query);
  await saveWatchlist(after);
  const dropped = before.entries.length - after.entries.length;
  process.stdout.write(
    dropped
      ? `\n${green("✓")} stopped watching ${bold(query)}\n\n`
      : `\n${yellow("not on the watchlist:")} ${query}\n\n`,
  );
  return 0;
}

export async function watchlistList(): Promise<number> {
  const state = await loadWatchlist();
  if (!state.entries.length) {
    process.stdout.write(
      `\n${yellow("watchlist is empty.")} ${dim("novamp watchlist add PEANUT")}\n\n`,
    );
    return 0;
  }
  process.stdout.write(`\n${bold("watching")} ${dim(`· ${state.entries.length} name(s)`)}\n\n`);
  process.stdout.write(
    renderTable(
      [
        { header: "query", width: 20 },
        { header: "key", width: 20 },
        { header: "added", width: 22 },
        { header: "note", width: 30 },
      ],
      state.entries.map((entry) => [
        entry.query,
        dim(entry.key),
        dim(entry.addedAt.slice(0, 19).replace("T", " ")),
        entry.note ?? grey("-"),
      ]),
    ) + "\n\n",
  );
  const telegram = telegramFromEnv();
  process.stdout.write(
    telegram
      ? dim("Telegram is configured. `novamp watchlist run` will post there.\n\n")
      : dim("Telegram is not configured: set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env.\n\n"),
  );
  return 0;
}

export interface WatchlistRunOptions {
  demo?: boolean;
  since?: string;
  /** Seconds between polls. */
  every?: number;
  /** Check once and exit, for a cron line. */
  once?: boolean;
}

export async function watchlistRun(opts: WatchlistRunOptions): Promise<number> {
  let state = await loadWatchlist();
  if (!state.entries.length) {
    fail("watchlist is empty. Add a name with `novamp watchlist add <name>`.");
    return 1;
  }
  const telegram = telegramFromEnv();
  const every = Math.max(30, opts.every ?? Math.max(30, config().pollMs / 1000));

  process.stdout.write(
    `\n${bold("watchlist")} ${dim(
      `· ${state.entries.length} name(s) · every ${every}s · telegram ${telegram ? "on" : "off"}`,
    )}\n`,
  );

  for (;;) {
    const ctx = await makeContext({ demo: opts.demo, since: opts.since });
    if (!opts.once) process.stdout.write(`${renderSourceLine(ctx.source.kind, ctx.source.describe)}\n`);

    let launches: Awaited<ReturnType<typeof ctx.launches>> = [];
    try {
      launches = await ctx.launches();
    } catch (err) {
      process.stderr.write(`${red("!")} ${(err as Error).message}\n`);
      if (opts.once) return 1;
      await sleep(every * 1000);
      continue;
    }

    const collected: Alert[] = [];
    for (const entry of state.entries) {
      const raw = findCluster(launches, entry.query);
      if (!raw || raw.members.length < 2) continue;
      const cluster = judgeCluster(raw, ctx.verdictOptions);
      collected.push(...alertsFor(cluster, entry));
    }

    const { fresh, state: next } = undelivered(state, collected);
    state = next;
    if (fresh.length) await saveWatchlist(state);

    for (const alert of fresh) {
      const plain = alert.text.replace(/<[^>]+>/g, "");
      const mark = alert.kind === "contested" ? cyan("CONTESTED") : verdictColor("VAMP")("NEW COPY");
      process.stdout.write(`\n${mark} ${plain.split("\n").join("\n  ")}\n`);
      if (telegram) {
        const result = await sendTelegram(telegram, alert.text);
        if (!result.ok) process.stderr.write(`${yellow("!")} telegram: ${result.error}\n`);
      }
    }

    if (!fresh.length && !opts.once) info(`nothing new across ${state.entries.length} name(s)`);
    if (opts.once) {
      process.stdout.write(
        fresh.length ? `\n${green("✓")} ${fresh.length} alert(s)\n\n` : `\n${dim("nothing new")}\n\n`,
      );
      return 0;
    }
    await sleep(every * 1000);
  }
}
