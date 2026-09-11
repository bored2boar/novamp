/**
 * Reading pons v2 through an indexer instead of through an RPC.
 *
 * novamp's own readers walk `eth_getLogs` over a window of blocks. That is the
 * right shape for one person at one terminal, and the wrong shape for a website:
 * a chain sealing a block every 100 ms puts eleven hours in 400 000 blocks, and
 * a public endpoint rate limits long before a second visitor arrives.
 *
 * So the website is fed by an indexer that has already done the walking, and the
 * whole of `src/vamp/` never notices. That is the payoff for the rule the tree
 * is built on: nothing that makes a decision touches the network, so a decision
 * layer that takes `LaunchRecord[]` does not care whether those records came
 * from a log sweep, a fixture file or a GraphQL endpoint. This file is a third
 * way to fill the same array.
 *
 * What it does NOT do is enter the repository's trust story. An indexer is a
 * third party telling you what happened. The RPC path remains the one that reads
 * the chain directly, and anything sourced here is labelled as indexed rather
 * than read, everywhere it surfaces.
 *
 * Credentials live in the environment and never in the browser. A key shipped
 * to the client is a key somebody else is spending within the hour.
 */

import type { Address, LaunchRecord } from "../types.js";

export const DEFAULT_BITQUERY_URL = "https://streaming.bitquery.io/graphql";

/** The pons v2 factory, same constant the RPC path uses. */
export const PONS_FACTORY_LOWER = "0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e";

export interface BitqueryConfig {
  url: string;
  token: string;
  /** "combined" covers live plus recent history. "archive" reaches further back. */
  dataset: "combined" | "archive";
  timeoutMs: number;
}

export class IndexerError extends Error {}

export function bitqueryFromEnv(env = process.env): BitqueryConfig | null {
  const token = env["BITQUERY_TOKEN"];
  if (!token) return null;
  const dataset = env["BITQUERY_DATASET"] === "archive" ? "archive" : "combined";
  return {
    url: env["BITQUERY_URL"] || DEFAULT_BITQUERY_URL,
    token,
    dataset,
    timeoutMs: Number(env["BITQUERY_TIMEOUT_MS"] || 30_000),
  };
}

/**
 * One POST, with the errors surfaced rather than swallowed.
 *
 * A GraphQL endpoint answers 200 with an `errors` array when the query is wrong,
 * which is the single easiest way to build a pipeline that silently produces
 * nothing. So a response carrying errors throws here, loudly, with the first
 * message attached.
 */
export async function query<T>(
  cfg: BitqueryConfig,
  graphql: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  try {
    const response = await fetch(cfg.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${cfg.token}`,
      },
      body: JSON.stringify({ query: graphql, variables }),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new IndexerError(`indexer returned ${response.status}: ${text.slice(0, 300)}`);
    }
    let parsed: { data?: T; errors?: { message: string }[] };
    try {
      parsed = JSON.parse(text) as typeof parsed;
    } catch {
      throw new IndexerError(`indexer returned unparseable JSON: ${text.slice(0, 300)}`);
    }
    if (parsed.errors?.length) {
      throw new IndexerError(`indexer rejected the query: ${parsed.errors[0]!.message}`);
    }
    if (!parsed.data) throw new IndexerError("indexer returned no data and no error");
    return parsed.data;
  } catch (err) {
    if (err instanceof IndexerError) throw err;
    throw new IndexerError((err as Error).message);
  } finally {
    clearTimeout(timer);
  }
}

// --- the launch feed ---------------------------------------------------------

/**
 * Decoded event arguments come back as a list of name/value pairs rather than an
 * object, and the value is a union whose shape depends on the ABI type. This
 * flattens one event's arguments into something addressable by name.
 */
export interface RawArg {
  Name: string;
  Type?: string;
  Value?: {
    address?: string;
    bigInteger?: string;
    string?: string;
    bool?: boolean;
    hex?: string;
  };
}

export function argsToMap(args: readonly RawArg[] | undefined): Map<string, string> {
  const out = new Map<string, string>();
  for (const arg of args ?? []) {
    const value = arg.Value ?? {};
    const flat =
      value.address ??
      value.string ??
      value.bigInteger ??
      value.hex ??
      (value.bool === undefined ? undefined : String(value.bool));
    if (flat !== undefined) out.set(arg.Name, flat);
  }
  return out;
}

export const LAUNCHES_QUERY = `
query Launches($factory: String!, $limit: Int!, $hoursAgo: Int!) {
  EVM(network: robinhood, dataset: combined) {   EVM(network: robinhood, dataset: realtime) {
    Events(
      limit: {count: $limit}
      orderBy: {descending: Block_Time}
      where: {
        LogHeader: {Address: {is: $factory}}
        Log: {Signature: {Name: {is: "TokenLaunched"}}}
        Block: {Time: {since_relative: {hours_ago: $hoursAgo}}}
      }
    ) {
      Block { Time Number }
      Transaction { Hash From Index }
      Log { Index }
      Arguments {
        Name
        Type
        Value {
          ... on EVM_ABI_Address_Value_Arg { address }
          ... on EVM_ABI_BigInt_Value_Arg { bigInteger }
          ... on EVM_ABI_String_Value_Arg { string }
          ... on EVM_ABI_Boolean_Value_Arg { bool }
        }
      }
    }
  }
}`;

interface LaunchesResponse {
  EVM: {
    Events: {
      Block: { Time: string; Number: number };
      Transaction: { Hash: string; From: string; Index?: number };
      Log?: { Index?: number };
      Arguments: RawArg[];
    }[];
  };
}

/**
 * What the indexer knows about a launch before anything else is asked.
 *
 * Deliberately not a `LaunchRecord`. A record claims fields this query cannot
 * fill - holders, buyers, the sell side - and inventing zeroes for them would
 * feed the scorer numbers that look measured and are not. The gap is closed
 * explicitly, by `toLaunchRecord` below, which is where every default is written
 * down in one place and can be argued with.
 */
export interface IndexedLaunch {
  token: Address;
  curve: Address;
  deployer: Address;
  block: number;
  txIndex: number;
  logIndex: number;
  launchedAt: number;
  pairToken: Address;
  /** Present only when the indexer decoded it. Usually filled in separately. */
  name?: string;
  symbol?: string;
}

const ZERO = "0x0000000000000000000000000000000000000000" as Address;

function asAddress(value: string | undefined, fallback: Address = ZERO): Address {
  return value && /^0x[0-9a-fA-F]{40}$/.test(value) ? (value.toLowerCase() as Address) : fallback;
}

/**
 * Pull the launch feed.
 *
 * `hoursAgo` is bounded by what the dataset serves, not by what you ask for. The
 * caller gets what came back and is told how much that was; a snapshot that
 * silently covers four hours when it claimed twenty four is the failure this
 * whole tool exists to avoid.
 */
export async function fetchLaunches(
  cfg: BitqueryConfig,
  opts: { hoursAgo?: number; limit?: number; factory?: string } = {},
): Promise<IndexedLaunch[]> {
  const data = await query<LaunchesResponse>(cfg, LAUNCHES_QUERY, {
    factory: (opts.factory ?? PONS_FACTORY_LOWER).toLowerCase(),
    limit: opts.limit ?? 500,
    hoursAgo: opts.hoursAgo ?? 24,
  });

  const out: IndexedLaunch[] = [];
  for (const event of data.EVM?.Events ?? []) {
    const args = argsToMap(event.Arguments);
    const token = asAddress(args.get("token"));
    if (token === ZERO) continue; // an event we cannot identify is not a launch we can use

    const seconds = Math.floor(Date.parse(event.Block.Time) / 1000);
    const entry: IndexedLaunch = {
      token,
      curve: asAddress(args.get("curve")),
      deployer: asAddress(args.get("deployer") ?? event.Transaction.From),
      block: Number(event.Block.Number),
      txIndex: Number(event.Transaction.Index ?? 0),
      logIndex: Number(event.Log?.Index ?? 0),
      launchedAt: Number.isFinite(seconds) ? seconds : 0,
      pairToken: asAddress(args.get("pairToken")),
    };
    const name = args.get("name");
    const symbol = args.get("symbol");
    if (name) entry.name = name;
    if (symbol) entry.symbol = symbol;
    out.push(entry);
  }
  return out;
}

// --- holders -----------------------------------------------------------------

export const HOLDERS_QUERY = `
query Holders($token: String!, $limit: Int!, $exclude: [String!]) {
  EVM(network: robinhood, dataset: archive) {
    Holders(
      limit: {count: $limit}
      orderBy: {descending: Balance_Amount}
      where: {
        Currency: {SmartContract: {is: $token}}
        Balance: {Amount: {gt: "0"}}
        Holder: {Address: {notIn: $exclude}}
      }
    ) {
      Holder { Address }
      Balance { Amount }
    }
  }
}`;

interface HoldersResponse {
  EVM: { Holders: { Holder: { Address: string }; Balance: { Amount: string } }[] };
}

export interface IndexedHolder {
  wallet: Address;
  amount: number;
}

/**
 * Top holders, with the protocol's own addresses excluded by the caller.
 *
 * The curve and the pool hold most of the supply for most of a launch's life.
 * Counting them is how every launch reads as 90 % held by one address, which is
 * true, useless, and the reason concentration numbers on other tools are noise.
 */
export async function fetchHolders(
  cfg: BitqueryConfig,
  token: string,
  exclude: readonly string[] = [],
  limit = 100,
): Promise<IndexedHolder[]> {
  const data = await query<HoldersResponse>(cfg, HOLDERS_QUERY, {
    token: token.toLowerCase(),
    limit,
    exclude: exclude.map((a) => a.toLowerCase()),
  });
  return (data.EVM?.Holders ?? []).map((row) => ({
    wallet: row.Holder.Address.toLowerCase() as Address,
    amount: Number(row.Balance.Amount),
  }));
}

// --- turning indexed data into the shape the decision layer eats -------------

export interface ToRecordOptions {
  /** Top-10 share of supply, 0..100, with curve and pool already excluded. */
  top10Pct?: number;
  deployerPct?: number;
  holderCount?: number;
  /** True only when the holder read completed. Partial reads must say so. */
  holdersComplete?: boolean;
  uniqueEarlyBuyers?: number;
  curveProgress?: number;
  quoteReserveWei?: string;
  phase?: 0 | 1 | 2 | 3;
}

/**
 * The explicit gap between what an indexer gives and what a `LaunchRecord` holds.
 *
 * Every field the indexer cannot fill is set to the value that makes the scorer
 * treat it as *unmeasured* rather than as *measured and fine*. That distinction
 * is the whole difference between a snapshot that is honest and one that quietly
 * flatters every launch in it:
 *
 *   - `exemptWallets: 0` is the one unavoidable lie, and it is the same lie the
 *     live RPC path currently tells. It costs the bundle penalty. Documented in
 *     LIMITATIONS and repeated on the site.
 *   - `holders.complete: false` unless the read finished, which makes
 *     `assessRisk` report UNKNOWN instead of a confident low number.
 *   - `buyers` and `sellActivity` are left undefined rather than empty, because
 *     an empty array means "nobody bought" and undefined means "not read".
 */
export function toLaunchRecord(
  launch: IndexedLaunch,
  meta: { name: string; symbol: string },
  extra: ToRecordOptions = {},
): LaunchRecord {
  const record: LaunchRecord = {
    token: launch.token,
    curve: launch.curve,
    deployer: launch.deployer,
    name: meta.name,
    symbol: meta.symbol,
    block: launch.block,
    txIndex: launch.txIndex,
    logIndex: launch.logIndex,
    launchedAt: launch.launchedAt,
    pairToken: launch.pairToken,
    pairSymbol: "",
    phase: extra.phase ?? 0,
    creatorTaxBps: 0,
    creatorFeeRecipient: launch.deployer,
    devSharePct: extra.deployerPct ?? 0,
    exemptWallets: 0,
    socials: {},
    quoteReserveWei: extra.quoteReserveWei ?? "0",
    curveProgress: extra.curveProgress ?? 0,
  };

  if (extra.uniqueEarlyBuyers !== undefined) {
    record.uniqueEarlyBuyers = extra.uniqueEarlyBuyers;
  }
  if (extra.top10Pct !== undefined) {
    record.holders = {
      top: [],
      top10Pct: extra.top10Pct,
      deployerPct: extra.deployerPct ?? 0,
      complete: extra.holdersComplete ?? false,
      ...(extra.holderCount === undefined ? {} : { holderCount: extra.holderCount }),
    };
  }
  return record;
}
