/**
 * Build the JSON the website reads.
 *
 *   BITQUERY_TOKEN=... BLOCKSCOUT_API_KEY=... npx tsx scripts/build-snapshot.ts
 *
 * The website is static. It has no server, no database and no API key, because
 * every one of those is a thing that can leak, cost money, or fall over at the
 * moment somebody links to it. Instead this job runs on a schedule somewhere
 * with a real network connection - a GitHub Action does fine - pulls the launch
 * feed from an indexer, runs the exact same clustering, verdict and scoring code
 * the CLI runs, and writes one JSON file. The site fetches that file.
 *
 * The decision layer is untouched and unaware. `clusterLaunches` and
 * `judgeCluster` take `LaunchRecord[]` and do not know or care that these
 * records came from GraphQL rather than from `eth_getLogs`. That is the point of
 * the rule the tree is built on, and this file is the second thing to benefit
 * from it after `--demo`.
 *
 * What this job will NOT do is pretend to more than it read. Every snapshot
 * carries the window it covers, the time it was taken, how many launches went
 * in, and which fields were unavailable. The site prints that. A search box over
 * silently stale data is exactly the kind of tool novamp's README complains
 * about, and shipping one would be funny in the wrong way.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  bitqueryFromEnv,
  fetchHolders,
  fetchLaunches,
  toLaunchRecord,
  query,
  IndexerError,
  type BitqueryConfig,
  type IndexedLaunch,
} from "../src/indexer/bitquery.js";
import { clusterLaunches } from "../src/vamp/cluster.js";
import { judgeCluster, DEFAULT_VERDICT_OPTIONS } from "../src/vamp/verdict.js";
import { looseKey } from "../src/vamp/normalize.js";
import type { Address, LaunchRecord } from "../src/types.js";

const HOURS = Number(process.env["SNAPSHOT_HOURS"] || 24);
const LIMIT = Number(process.env["SNAPSHOT_LIMIT"] || 500);
/** Clusters with fewer members than this are not a fight and not worth shipping. */
const MIN_MEMBERS = Number(process.env["SNAPSHOT_MIN_MEMBERS"] || 2);
/** How many clusters to enrich with holder data, busiest first. */
const DEEPEN_TOP = Number(process.env["SNAPSHOT_DEEPEN_TOP"] || 25);
const OUT = resolve(process.cwd(), process.env["SNAPSHOT_OUT"] || "site/data");

/** Bitquery carries the token name and symbol in its Currency metadata. */
const CURRENCY_QUERY = `
query Meta($token: String!) {
  EVM(network: robinhood, dataset: realtime) {
    Transfers(
      limit: {count: 1}
      where: {Transfer: {Currency: {SmartContract: {is: $token}}}}
    ) {
      Transfer { Currency { Name Symbol Decimals } }
    }
  }
}`;

interface CurrencyMeta {
  name: string;
  symbol: string;
  decimals: number;
  holders?: number;
}

const metaSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const META_GAP_MS = Number(process.env["SNAPSHOT_META_GAP_MS"] || 300);

/**
 * Name and symbol per token, from Bitquery's Currency metadata.
 *
 * The TokenLaunched event carries only addresses. The chain's own explorer is
 * behind a bot wall, so the two strings this whole tool is about come from the
 * same indexer that gave us the launches. One request per token, paced, so a
 * rate limited free key is not hammered. A token that cannot be named is left
 * out of the map and lands in its own cluster - visible, not invented.
 */
async function fetchCurrencyMetaBatch(
  cfg: BitqueryConfig,
  tokens: readonly string[],
  onProgress?: (done: number, total: number) => void,
): Promise<Map<string, CurrencyMeta>> {
  const out = new Map<string, CurrencyMeta>();
  let done = 0;
  for (const token of tokens) {
    const key = token.toLowerCase();
    if (!out.has(key)) {
      try {
        const raw = await query<{
          EVM?: {
            Transfers?: {
              Transfer?: { Currency?: { Name?: string; Symbol?: string; Decimals?: number } };
            }[];
          };
        }>(cfg, CURRENCY_QUERY, { token: key });
        const cur = raw.EVM?.Transfers?.[0]?.Transfer?.Currency;
        if (cur && (cur.Name || cur.Symbol)) {
          out.set(key, {
            name: cur.Name ?? "",
            symbol: cur.Symbol ?? "",
            decimals: Number(cur.Decimals ?? 18) || 18,
          });
        }
      } catch {
        // leave it unnamed; the loop below counts it as unreadable
      }
    }
    done++;
    if (onProgress && done % 25 === 0) onProgress(done, tokens.length);
    if (done < tokens.length) await metaSleep(META_GAP_MS);
  }
  onProgress?.(done, tokens.length);
  return out;
}

function log(line: string): void {
  process.stderr.write(`${line}\n`);
}

/** Protocol addresses that hold supply and are not holders in any useful sense. */
function protocolAddresses(launch: IndexedLaunch): string[] {
  return [
    launch.curve,
    "0x0000000000000000000000000000000000000000",
    "0x000000000000000000000000000000000000dead",
  ];
}

async function main(): Promise<void> {
  const bitquery = bitqueryFromEnv();
  if (!bitquery) {
    log("BITQUERY_TOKEN is not set. Nothing to read.");
    process.exit(1);
  }

  log(`reading launches, last ${HOURS}h, limit ${LIMIT}`);
  let indexed: IndexedLaunch[];
  try {
    indexed = await fetchLaunches(bitquery, { hoursAgo: HOURS, limit: LIMIT });
  } catch (err) {
    if (err instanceof IndexerError) {
      log(`indexer failed: ${err.message}`);
      process.exit(2);
    }
    throw err;
  }
  log(`${indexed.length} launches`);
  if (!indexed.length) {
    log("nothing came back. Not writing an empty snapshot over a good one.");
    process.exit(3);
  }

  // Names and symbols are not in the event, so they come from the explorer.
  const needMeta = indexed.filter((l) => !l.symbol).map((l) => l.token);
  log(`reading metadata for ${needMeta.length} token(s)`);
  const meta = await fetchCurrencyMetaBatch(bitquery, needMeta, (done, total) =>
    log(`  ${done}/${total}`),
  );

  const records: LaunchRecord[] = [];
  let unreadable = 0;
  for (const launch of indexed) {
    const found = meta.get(launch.token.toLowerCase());
    const symbol = launch.symbol ?? found?.symbol ?? "";
    const name = launch.name ?? found?.name ?? symbol;
    if (!symbol && !name) {
      unreadable++;
      continue;
    }
    const opts = found?.holders === undefined ? {} : { holderCount: found.holders };
    records.push(toLaunchRecord(launch, { name, symbol }, opts));
  }
  log(`${records.length} usable, ${unreadable} with no readable name`);

  // Cluster first, then spend the expensive holder reads only on the clusters
  // that turned out to be fights. Deepening everything would be most of the
  // request budget spent on launches nobody copied.
  const clusters = clusterLaunches(records)
    .filter((c) => c.members.length >= MIN_MEMBERS)
    .sort((a, b) => b.members.length - a.members.length);
  log(`${clusters.length} cluster(s) with ${MIN_MEMBERS}+ members`);

  const byToken = new Map(records.map((r) => [r.token.toLowerCase(), r]));
  const deepen = clusters.slice(0, DEEPEN_TOP);
  let read = 0;
  for (const cluster of deepen) {
    for (const member of cluster.members) {
      const record = byToken.get(member.record.token.toLowerCase());
      if (!record) continue;
      try {
        const holders = await fetchHolders(
          bitquery,
          record.token,
          protocolAddresses({ curve: record.curve } as IndexedLaunch),
          100,
        );
        if (!holders.length) continue;
        const total = holders.reduce((sum, h) => sum + h.amount, 0);
        if (total <= 0) continue;
        const top10 = holders.slice(0, 10).reduce((sum, h) => sum + h.amount, 0);
        const dep = holders.find(
          (h) => h.wallet.toLowerCase() === record.deployer.toLowerCase(),
        );
        record.holders = {
          top: holders.slice(0, 10).map((h) => ({
            wallet: h.wallet as Address,
            pct: (h.amount / total) * 100,
          })),
          top10Pct: (top10 / total) * 100,
          deployerPct: dep ? (dep.amount / total) * 100 : 0,
          holderCount: holders.length,
          // The read covered the top 100 by balance, not every wallet. That is
          // enough for concentration and is not a complete holder set, so it is
          // not labelled as one.
          complete: holders.length < 100,
        };
        record.devSharePct = record.holders.deployerPct;
        read++;
      } catch (err) {
        log(`  holders failed for ${record.symbol}: ${(err as Error).message}`);
      }
    }
  }
  log(`holder data for ${read} launch(es)`);

  // Judge everything, including the clusters that were not deepened. A verdict
  // built on thinner data is still a verdict; the site says which is which.
  const judged = clusters.map((raw) => {
    const cluster = judgeCluster(raw, DEFAULT_VERDICT_OPTIONS);
    const deepened = deepen.includes(raw);
    return {
      key: cluster.key,
      label: cluster.label,
      verdict: cluster.verdict,
      vampLagSec: cluster.vampLagSec,
      notes: cluster.notes,
      depth: deepened ? ("full" as const) : ("shallow" as const),
      members: cluster.members.map((m) => ({
        token: m.record.token,
        symbol: m.record.symbol,
        name: m.record.name,
        rank: m.rank,
        lagSec: m.lagSec,
        verdict: m.verdict,
        score: m.potential,
        risk: m.risk,
        launchedAt: m.record.launchedAt,
        deployer: m.record.deployer,
        top10Pct: m.record.holders?.top10Pct ?? null,
        holdersComplete: m.record.holders?.complete ?? false,
        reasons: m.reasons.map((r) => ({ points: r.points, text: r.text })),
        flags: m.flags.map((f) => ({ level: f.level, code: f.code, text: f.text })),
      })),
    };
  });

  // A flat search index, so the page can resolve a query without downloading
  // every cluster. Both keys a copy can borrow are indexed, same as the CLI.
  const search: Record<string, string> = {};
  for (const cluster of judged) {
    for (const member of cluster.members) {
      for (const term of [member.symbol, member.name]) {
        const key = looseKey(term);
        if (key.length >= 3 && !search[key]) search[key] = cluster.key;
      }
    }
  }

  const times = records.map((r) => r.launchedAt).filter(Boolean);
  const snapshot = {
    schema: "novamp.snapshot.v1",
    takenAt: new Date().toISOString(),
    source: "indexed, not read directly from the chain",
    window: {
      requestedHours: HOURS,
      oldestLaunch: times.length ? Math.min(...times) : null,
      newestLaunch: times.length ? Math.max(...times) : null,
      launches: records.length,
      unreadable,
    },
    // Said out loud, in the file, so the page cannot show these numbers without
    // also being able to show what is missing from them.
    gaps: [
      "exemptWallets reads 0 on every launch here, so bundle penalties are not applied and scores are optimistic",
      "no buyer or sell-side data, so the flow and dump rules contribute nothing",
      "holder data covers the top 100 wallets by balance on the busiest clusters only",
      "clusters marked shallow were judged without holder data at all",
    ],
    clusters: judged,
    search,
  };

  await mkdir(OUT, { recursive: true });
  await writeFile(resolve(OUT, "snapshot.json"), JSON.stringify(snapshot) + "\n", "utf8");
  await writeFile(
    resolve(OUT, "meta.json"),
    JSON.stringify(
      { takenAt: snapshot.takenAt, window: snapshot.window, clusters: judged.length },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  log(`wrote ${OUT}/snapshot.json - ${judged.length} clusters, ${records.length} launches`);
}

main().catch((err) => {
  process.stderr.write(`${(err as Error).stack ?? String(err)}\n`);
  process.exit(1);
});
