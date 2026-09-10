/**
 * `novamp swarm` - the moment a name turns into a fight, and which one of them
 * is real.
 *
 * The sequence, which is the same every time and is printed in this order so it
 * can be checked line by line:
 *
 *   1. a burst: N launches collapse into one cluster inside a short window,
 *      from wallets that are not each other
 *   2. a cause: a headline in the last hour carrying the word they are named
 *      after, published BEFORE the first launch
 *   3. a resolution: the existing clustering, verdict and scoring engine, run
 *      over the burst, saying which member is the original and which are copies
 *   4. a hand-off: the finding goes to your terminal, to Telegram when it is
 *      configured, and to your own executor when you passed --exec
 *
 * Steps 1 to 3 are the tool. Step 4 is a pipe. novamp signs nothing at any point
 * in this file or any file it imports, and the `no-signer` CI job proves it on
 * every commit. See docs/EXEC.md.
 *
 * STATUS: the readers under this command run against mainnet, but no burst has
 * been detected and resolved live yet. See docs/LIMITATIONS.md.
 */

import type { Assessment, Cluster } from "../types.js";
import { judgeCluster } from "../vamp/verdict.js";
import { findSwarms, swarmTerms, type Swarm, type SwarmOptions } from "../swarm/detect.js";
import { matchNews, primaryMatch, DEFAULT_NEWS, type NewsMatch } from "../swarm/news.js";
import { rankSwarm, topReasons, type RankOptions, type Ranking } from "../swarm/rank.js";
import { fetchChannel } from "../narrative/channel.js";
import { fetchFeedItems, type FeedItem } from "../narrative/feeds.js";
import { loadNewsFixture } from "../source/demo.js";
import { handOff, verifyExecutor, HandoffError, type HandoffPayload } from "../exec/handoff.js";
import { sendTelegram, telegramFromEnv, escapeHtml } from "../alerts/telegram.js";
import { makeContext } from "./context.js";
import { renderSourceLine } from "../ui/render.js";
import { renderTable } from "../ui/table.js";
import { bold, cyan, dim, green, grey, red, riskColor, verdictColor, yellow } from "../ui/color.js";
import { duration, iso, shortAddress } from "../util/fmt.js";
import { sleep } from "../chain/gate.js";
import { config } from "../util/env.js";
import { fail, info } from "../util/log.js";

export interface SwarmCommandOptions {
  demo?: boolean;
  since?: string;
  json?: boolean;

  minCluster?: number;
  window?: number;
  minDeployers?: number;

  news?: boolean;
  newsLookback?: number;

  minScore?: number;
  allowRed?: boolean;
  allowFarm?: boolean;

  watch?: boolean;
  every?: number;
  top?: number;

  exec?: string;
  execDryRun?: boolean;
  execTimeout?: number;
}

/** One finding, which is a swarm plus everything novamp worked out about it. */
interface Finding {
  swarm: Swarm;
  cluster: Cluster;
  matches: NewsMatch[];
  news: NewsMatch | null;
  ranking: Ranking;
}

export async function swarm(opts: SwarmCommandOptions): Promise<number> {
  const defaults = config().swarm;
  const detect: SwarmOptions = {
    minMembers: opts.minCluster ?? defaults.minMembers,
    windowSec: opts.window ?? defaults.windowSec,
    minDeployers: opts.minDeployers ?? defaults.minDeployers,
  };
  const rank: RankOptions = {
    minScore: opts.minScore ?? defaults.minScore,
    refuseRisk: opts.allowRed ? "none" : "RED",
    refuseFarm: !opts.allowFarm,
  };
  const newsWanted = opts.news !== false;
  const lookbackSec = opts.newsLookback ?? defaults.newsLookbackSec;

  // The executor is checked now, before anything is detected. Discovering that
  // the path is wrong during the two minutes a burst is live is the worst
  // possible time to discover it.
  let executor: string | null = null;
  if (opts.exec) {
    try {
      executor = verifyExecutor(opts.exec);
    } catch (err) {
      if (err instanceof HandoffError) {
        fail(err.message);
        return 1;
      }
      throw err;
    }
  }

  const telegram = telegramFromEnv();

  if (!opts.json) {
    process.stdout.write(
      `\n${bold("swarm")} ${dim(
        `· ${detect.minMembers}+ launches in ${duration(detect.windowSec)} ` +
          `from ${detect.minDeployers}+ deployers · score bar ${rank.minScore} ` +
          `· news ${newsWanted ? "on" : "off"} · telegram ${telegram ? "on" : "off"} ` +
          `· exec ${executor ? (opts.execDryRun ? "dry-run" : "on") : "off"}`,
      )}\n`,
    );
  }

  const sent = new Set<string>();
  const every = Math.max(30, opts.every ?? 60);

  for (;;) {
    const ctx = await makeContext({ demo: opts.demo, since: opts.since });
    if (!opts.json) process.stdout.write(`${renderSourceLine(ctx.source.kind, ctx.source.describe)}\n`);

    let launches;
    try {
      launches = await ctx.launches();
    } catch (err) {
      process.stderr.write(`${red("!")} ${(err as Error).message}\n`);
      if (!opts.watch) return 1;
      await sleep(every * 1000);
      continue;
    }

    const swarms = findSwarms(launches, detect).slice(0, opts.top ?? 5);

    const headlines = !newsWanted || !swarms.length
      ? []
      : opts.demo
        ? await loadNewsFixture()
        : await readNews(ctx.cfg);
    if (newsWanted && !opts.json && !headlines.length && swarms.length) {
      process.stdout.write(
        `${yellow("!")} ${dim(
          "no headlines read. Set NEWS_CHANNELS or NARRATIVE_FEEDS in .env, or pass --no-news.",
        )}\n`,
      );
    }
    if (opts.demo && headlines.length && !opts.json) {
      process.stdout.write(
        `${yellow("!")} ${dim(`${headlines.length} SYNTHETIC headlines from fixtures/news.json. Nobody published these.`)}\n`,
      );
    }

    const findings: Finding[] = swarms.map((found) => {
      const cluster = judgeCluster(found.cluster, ctx.verdictOptions);
      // Judge with the whole cluster's context, then rank the contenders: the
      // burst plus anything that launched before it. A copy that lands after the
      // burst has ended is still counted against the first born's taint check,
      // but it is not competing for a pick that was already made.
      const field = new Set(found.contenders.map((m) => m.record.token.toLowerCase()));
      const inBurst: Cluster = {
        ...cluster,
        members: cluster.members.filter((m) => field.has(m.record.token.toLowerCase())),
      };
      const matches = headlines.length
        ? matchNews(headlines, swarmTerms(found), found.startedAt, {
            ...DEFAULT_NEWS,
            lookbackSec,
          })
        : [];
      return {
        swarm: found,
        cluster: inBurst,
        matches,
        news: primaryMatch(matches),
        ranking: rankSwarm(inBurst, rank),
      };
    });

    if (opts.json) {
      process.stdout.write(JSON.stringify(findings.map(asJson), null, 2) + "\n");
      if (!opts.watch) return 0;
    } else if (!findings.length) {
      process.stdout.write(
        `\n${dim(
          `no swarm in the window: nothing reached ${detect.minMembers} launches ` +
            `inside ${duration(detect.windowSec)}.`,
        )}\n\n`,
      );
    } else {
      for (const finding of findings) process.stdout.write(render(finding));
    }

    // --- act on what is new ---------------------------------------------------
    for (const finding of findings) {
      const id = `${finding.swarm.cluster.key}:${finding.swarm.startedAt}:${finding.ranking.winner?.record.token ?? "none"}`;
      if (sent.has(id)) continue;
      sent.add(id);
      if (!finding.ranking.winner) continue;

      if (telegram) {
        const result = await sendTelegram(telegram, telegramText(finding));
        if (!result.ok) process.stderr.write(`${yellow("!")} telegram: ${result.error}\n`);
      }

      if (executor) {
        const payload = buildPayload(finding);
        if (opts.execDryRun) {
          process.stdout.write(
            `\n${cyan("exec dry-run")} ${dim(executor)}\n` +
              dim(JSON.stringify(payload, null, 2)) +
              "\n",
          );
        } else {
          process.stdout.write(`\n${cyan("→ exec")} ${dim(executor)}\n`);
          const result = await handOff(executor, payload, opts.execTimeout ?? 20_000);
          process.stdout.write(renderHandoff(result));
        }
      }
    }

    if (!opts.watch) return 0;
    await sleep(every * 1000);
  }
}

// --- news --------------------------------------------------------------------

/**
 * Every headline novamp can see, from both kinds of source.
 *
 * Channels first because they are faster, feeds second because they are
 * attributable. Both are optional and a failure in either is silent by design:
 * a dead feed should cost you the headline, not the swarm detection that works
 * perfectly well without it.
 */
async function readNews(cfg: { newsChannels: string[]; narrativeFeeds: string[] }): Promise<FeedItem[]> {
  const items: FeedItem[] = [];
  for (const channel of cfg.newsChannels) {
    info(`reading t.me/${channel.replace(/^@/, "")}`);
    items.push(...(await fetchChannel(channel)));
  }
  for (const url of cfg.narrativeFeeds) {
    info(`reading ${url}`);
    items.push(...(await fetchFeedItems(url)));
  }
  return items;
}

// --- rendering ---------------------------------------------------------------

function render(finding: Finding): string {
  const { swarm: found, cluster, news, ranking } = finding;
  const out: string[] = [];

  out.push(
    `\n${bold(cluster.label)} ${verdictColor(cluster.verdict)(cluster.verdict)} ` +
      dim(
        `· ${found.burst.length} launches in ${duration(found.endedAt - found.startedAt)} ` +
          `· ${found.deployers} deployers · ${found.perMinute.toFixed(1)}/min`,
      ),
  );
  out.push(
    dim(
      `  burst started ${iso(found.startedAt)}` +
        (found.priorMembers
          ? ` · ${found.priorMembers} launch(es) under this name before it`
          : ` · the name did not exist before this`),
    ),
  );

  if (news) {
    const lead = news.lagging
      ? `${red("published")} ${duration(-news.leadSec)} ${red("AFTER")} the first launch`
      : `${duration(news.leadSec)} before the first launch`;
    out.push(
      `\n  ${cyan("news")}  ${bold(trim(news.item.title, 92))}\n` +
        dim(
          `        ${news.item.source} · ${lead} · matched "${news.word}" ` +
            `→ ${news.term}${news.kind === "near" ? " (near match)" : ""}`,
        ),
    );
    if (finding.matches.length > 1) {
      out.push(dim(`        ${finding.matches.length - 1} more headline(s) carry this word`));
    }
  } else {
    out.push(
      `\n  ${grey("news")}  ${dim("no headline in the window carries this name. This may be a farm, or a meme novamp cannot see the source of.")}`,
    );
  }

  out.push("");
  out.push(
    renderTable(
      [
        { header: "#", width: 3, align: "right" },
        { header: "symbol", width: 14 },
        { header: "verdict", width: 10 },
        { header: "score", width: 5, align: "right" },
        { header: "risk", width: 7 },
        { header: "lag", width: 7, align: "right" },
        { header: "token", width: 14 },
      ],
      cluster.members.map((member) => [
        String(member.rank),
        member === ranking.winner ? bold(member.record.symbol) : member.record.symbol,
        verdictColor(member.verdict)(member.verdict),
        String(member.potential),
        riskColor(member.risk)(member.risk),
        member.lagSec ? `+${duration(member.lagSec)}` : dim("-"),
        grey(shortAddress(member.record.token)),
      ]),
    ),
  );

  if (ranking.winner) {
    out.push(`\n  ${green("PICK")}  ${bold(ranking.winner.record.symbol)} ${dim(ranking.winner.record.token)}`);
    for (const reason of topReasons(ranking.winner)) out.push(dim(`        ${reason}`));
  } else {
    out.push(`\n  ${yellow("NO PICK")}`);
    for (const refusal of ranking.refusals) out.push(dim(`        ${refusal}`));
    if (ranking.best) {
      out.push(
        dim(`        closest was ${ranking.best.record.symbol} at ${ranking.best.potential}`),
      );
    }
  }

  for (const note of cluster.notes) out.push(dim(`  ! ${note}`));

  out.push(
    dim(
      `\n  the score orders this cluster. It does not predict a price, and a burst\n` +
        `  with a headline behind it is a coincidence in time, not a cause.\n`,
    ),
  );
  return out.join("\n") + "\n";
}

function renderHandoff(result: Awaited<ReturnType<typeof handOff>>): string {
  const head = result.ok
    ? `  ${green("✓")} executor exited 0 ${dim(`in ${result.ms}ms`)}`
    : `  ${red("✗")} executor ${result.error ?? `exited ${result.code}`} ${dim(`in ${result.ms}ms`)}`;
  const body: string[] = [];
  if (result.stdout) body.push(...result.stdout.split("\n").map((line) => dim(`    ${line}`)));
  if (result.stderr) body.push(...result.stderr.split("\n").map((line) => red(`    ${line}`)));
  return [head, ...body, ""].join("\n");
}

function trim(text: string, width: number): string {
  return text.length <= width ? text : text.slice(0, width - 1) + "…";
}

// --- outputs -----------------------------------------------------------------

function telegramText(finding: Finding): string {
  const { swarm: found, cluster, news, ranking } = finding;
  const winner = ranking.winner!;
  const lines: string[] = [];

  lines.push(
    `<b>SWARM</b> ${escapeHtml(cluster.label)} · ${found.burst.length} launches in ` +
      `${duration(found.endedAt - found.startedAt)} from ${found.deployers} deployers`,
  );
  if (news) {
    lines.push(
      `\n<i>${escapeHtml(trim(news.item.title, 140))}</i>\n` +
        `${escapeHtml(news.item.source)} · ${duration(Math.abs(news.leadSec))} ` +
        (news.lagging ? "after the first launch" : "before the first launch"),
    );
  } else {
    lines.push(`\nno headline behind this one`);
  }

  lines.push(
    `\n<b>${escapeHtml(winner.record.symbol)}</b> · ${winner.verdict} · score ${winner.potential} · risk ${winner.risk}`,
  );
  for (const reason of topReasons(winner, 3)) lines.push(escapeHtml(reason));
  lines.push(`<code>${winner.record.token}</code>`);

  const avoid = ranking.avoid.filter((member) => member.verdict === "VAMP").slice(0, 3);
  if (avoid.length) {
    lines.push(`\n<b>not these</b>`);
    for (const member of avoid) {
      lines.push(`${escapeHtml(member.record.symbol)} · ${member.verdict} · <code>${member.record.token}</code>`);
    }
  }

  lines.push(`\n<i>novamp orders a cluster. It does not predict a price.</i>`);
  return lines.join("\n");
}

function buildPayload(finding: Finding): HandoffPayload {
  const { swarm: found, cluster, news, ranking } = finding;
  const winner = ranking.winner!;
  return {
    schema: "novamp.swarm.v1",
    at: new Date().toISOString(),
    swarm: {
      key: found.cluster.key,
      label: cluster.label,
      members: found.burst.length,
      deployers: found.deployers,
      startedAt: found.startedAt,
      perMinute: Number(found.perMinute.toFixed(2)),
    },
    news: news
      ? {
          headline: news.item.title,
          source: news.item.source,
          publishedAt: news.item.publishedAt!,
          leadSec: news.leadSec,
        }
      : null,
    pick: {
      token: winner.record.token,
      symbol: winner.record.symbol,
      name: winner.record.name,
      verdict: winner.verdict,
      score: winner.potential,
      risk: winner.risk,
      rank: winner.rank,
      clusterSize: cluster.members.length,
      reasons: topReasons(winner, 6),
    },
    avoid: ranking.avoid.map((member) => ({
      token: member.record.token,
      symbol: member.record.symbol,
      verdict: member.verdict,
      score: member.potential,
    })),
  };
}

function asJson(finding: Finding) {
  const summarise = (member: Assessment) => ({
    token: member.record.token,
    symbol: member.record.symbol,
    name: member.record.name,
    rank: member.rank,
    verdict: member.verdict,
    score: member.potential,
    risk: member.risk,
    lagSec: member.lagSec,
  });
  return {
    key: finding.swarm.cluster.key,
    label: finding.cluster.label,
    clusterVerdict: finding.cluster.verdict,
    burst: {
      members: finding.swarm.burst.length,
      deployers: finding.swarm.deployers,
      startedAt: finding.swarm.startedAt,
      endedAt: finding.swarm.endedAt,
      perMinute: Number(finding.swarm.perMinute.toFixed(2)),
      priorMembers: finding.swarm.priorMembers,
    },
    news: finding.news
      ? {
          headline: finding.news.item.title,
          source: finding.news.item.source,
          publishedAt: finding.news.item.publishedAt,
          leadSec: finding.news.leadSec,
          lagging: finding.news.lagging,
          matchedOn: finding.news.word,
          kind: finding.news.kind,
        }
      : null,
    pick: finding.ranking.winner ? summarise(finding.ranking.winner) : null,
    refusals: finding.ranking.refusals,
    members: finding.cluster.members.map(summarise),
  };
}
