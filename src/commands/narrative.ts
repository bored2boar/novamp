/**
 * `novamp narrative` - which words are in the air, and what launched under them.
 *
 * Reads the RSS feeds in NARRATIVE_FEEDS, pulls the nouns out of the headlines,
 * and checks each one against the launch index. A word with six launches behind
 * it is a fight worth resolving; a word with none is just news.
 *
 * This command never says buy. It says "here is where the clone war is".
 */

import { fetchFeed } from "../narrative/feeds.js";
import { extractKeywords } from "../narrative/keywords.js";
import { findCluster } from "../vamp/cluster.js";
import { judgeCluster } from "../vamp/verdict.js";
import { makeContext } from "./context.js";
import { renderTable } from "../ui/table.js";
import { bold, dim, verdictColor, yellow } from "../ui/color.js";
import { duration } from "../util/fmt.js";
import { info } from "../util/log.js";

export async function narrative(opts: {
  demo?: boolean;
  limit?: number;
  json?: boolean;
  since?: string;
}): Promise<number> {
  const ctx = await makeContext({ demo: opts.demo, since: opts.since });
  const feeds = ctx.cfg.narrativeFeeds;
  const watchlist = ctx.cfg.narrativeWatchlist;

  if (!feeds.length && !watchlist.length) {
    process.stdout.write(
      `\n${yellow("no feeds configured.")}\n` +
        dim(
          "  set NARRATIVE_FEEDS in .env to a comma separated list of free RSS urls,\n" +
            "  and/or NARRATIVE_WATCHLIST to words you want checked regardless.\n\n",
        ),
    );
    return 1;
  }

  const titles: string[] = [];
  for (const url of feeds) {
    info(`reading ${url}`);
    const items = await fetchFeed(url);
    titles.push(...items.map((i) => i.title));
  }

  const keywords = extractKeywords(titles, opts.limit ?? 20);
  const words = [...watchlist.map((w) => ({ word: w, count: 0, examples: [] })), ...keywords];
  if (!words.length) {
    process.stdout.write(`\n${yellow("nothing readable in those feeds")}\n\n`);
    return 1;
  }

  const launches = await ctx.launches();
  const rows: string[][] = [];
  const payload: unknown[] = [];

  for (const keyword of words) {
    const raw = findCluster(launches, keyword.word);
    if (!raw) {
      rows.push([keyword.word, String(keyword.count || "-"), dim("0"), dim("-"), dim("nothing launched")]);
      continue;
    }
    const cluster = judgeCluster(raw, ctx.verdictOptions);
    const leader = [...cluster.members].sort((a, b) => b.potential - a.potential)[0]!;
    rows.push([
      keyword.word,
      String(keyword.count || "-"),
      String(cluster.members.length),
      cluster.vampLagSec === null ? dim("-") : duration(cluster.vampLagSec),
      `${verdictColor(cluster.verdict)(cluster.verdict)} ${dim("→")} ${bold(leader.record.symbol)} ${dim(`(${leader.potential})`)}`,
    ]);
    payload.push({
      keyword: keyword.word,
      mentions: keyword.count,
      launches: cluster.members.length,
      vampLagSec: cluster.vampLagSec,
      verdict: cluster.verdict,
      leader: { symbol: leader.record.symbol, token: leader.record.token, score: leader.potential },
    });
  }

  if (opts.json) {
    process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
    return 0;
  }

  process.stdout.write(`\n${bold("narrative desk")} ${dim(`· ${titles.length} headlines · ${feeds.length} feed(s)`)}\n\n`);
  process.stdout.write(
    renderTable(
      [
        { header: "word", width: 18 },
        { header: "mentions", width: 9, align: "right" },
        { header: "launches", width: 9, align: "right" },
        { header: "first copy", width: 11, align: "right" },
        { header: "what novamp says", width: 44 },
      ],
      rows,
    ) + "\n\n",
  );
  process.stdout.write(
    dim("this is a map of where the clone fights are. It is not a buy signal, and the\n" +
      "news is public before you read it here. Run `novamp vamp <word> --all` to dig in.\n\n"),
  );
  return 0;
}
