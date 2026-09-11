/**
 * Token names and symbols, from the chain's own explorer.
 *
 * The `TokenLaunched` event carries addresses. It does not carry the two strings
 * this whole tool is about, because the name and the symbol live in the launch
 * transaction's calldata and in the token contract itself. On the RPC path
 * novamp reads them off the contract. On the indexed path it asks Blockscout,
 * which is the official explorer for chain 4663 and answers that question in one
 * request.
 *
 * Free tier at the time of writing: 5 requests per second, 100 000 credits a
 * day, key from dev.blockscout.com. Both limits are respected here rather than
 * discovered in production - `fetchTokenMeta` paces itself and gives up politely
 * rather than hammering a 429 until the key is throttled.
 *
 * A token whose metadata cannot be read is returned with empty strings, not
 * dropped and not guessed. The clustering layer already refuses to join on a key
 * shorter than three characters, so an unreadable launch lands in its own
 * cluster and is visible rather than invented.
 */

import type { Address } from "../types.js";

export const DEFAULT_BLOCKSCOUT_URL = "https://robinhoodchain.blockscout.com";

export interface BlockscoutConfig {
  url: string;
  /** Optional on some deployments, required on the hosted free tier. */
  apiKey: string;
  /** Requests per second to stay under. The documented free tier is 5. */
  ratePerSec: number;
  timeoutMs: number;
}

export function blockscoutFromEnv(env = process.env): BlockscoutConfig {
  return {
    url: env["BLOCKSCOUT_URL"] || DEFAULT_BLOCKSCOUT_URL,
    apiKey: env["BLOCKSCOUT_API_KEY"] || "",
    ratePerSec: Number(env["BLOCKSCOUT_RATE_PER_SEC"] || 4),
    timeoutMs: Number(env["BLOCKSCOUT_TIMEOUT_MS"] || 15_000),
  };
}

export interface TokenMeta {
  token: Address;
  name: string;
  symbol: string;
  decimals: number;
  /** Holder count as the explorer counts it, when it gives one. */
  holders?: number;
  totalSupply?: string;
  /** False when the lookup failed. The caller decides what to do about it. */
  ok: boolean;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getJson(
  cfg: BlockscoutConfig,
  path: string,
): Promise<Record<string, unknown> | null> {
  const url = new URL(path, cfg.url);
  if (cfg.apiKey) url.searchParams.set("apikey", cfg.apiKey);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    if (!response.ok) return null;
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** One token's metadata. */
export async function fetchTokenMeta(
  cfg: BlockscoutConfig,
  token: string,
): Promise<TokenMeta> {
  const address = token.toLowerCase() as Address;
  const body = await getJson(cfg, `/api/v2/tokens/${address}`);
  if (!body) return { token: address, name: "", symbol: "", decimals: 18, ok: false };

  const holders = Number(body["holders"] ?? body["holders_count"]);
  const meta: TokenMeta = {
    token: address,
    name: str(body["name"]),
    symbol: str(body["symbol"]),
    decimals: Number(body["decimals"] ?? 18) || 18,
    ok: true,
  };
  if (Number.isFinite(holders) && holders > 0) meta.holders = holders;
  const supply = str(body["total_supply"]);
  if (supply) meta.totalSupply = supply;
  return meta;
}

/**
 * Metadata for a list of tokens, paced to the rate limit.
 *
 * Sequential with a delay rather than a burst of parallel requests. A snapshot
 * job has all the time in the world and a rate limited key has none, so the
 * trade is obvious in one direction: 500 launches at 4 per second is a little
 * over two minutes, which is nothing for a job that runs every fifteen.
 *
 * `onProgress` exists so a CI log shows movement instead of looking hung.
 */
export async function fetchTokenMetaBatch(
  cfg: BlockscoutConfig,
  tokens: readonly string[],
  onProgress?: (done: number, total: number) => void,
): Promise<Map<string, TokenMeta>> {
  const out = new Map<string, TokenMeta>();
  const gap = Math.ceil(1000 / Math.max(1, cfg.ratePerSec));
  let done = 0;
  for (const token of tokens) {
    const key = token.toLowerCase();
    if (out.has(key)) continue;
    out.set(key, await fetchTokenMeta(cfg, key));
    done++;
    if (onProgress && done % 25 === 0) onProgress(done, tokens.length);
    if (done < tokens.length) await sleep(gap);
  }
  onProgress?.(done, tokens.length);
  return out;
}
