/**
 * Configuration, resolved once.
 *
 * There is no private key setting here and no code that would read one. If you
 * find a fork of novamp that asks for a key, that is not novamp.
 *
 * The CI job `no-signer` greps this whole tree for signing primitives and the
 * key environment names, which is also why this comment spells none of them out.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Address } from "../types.js";
import { DEFAULT_PONS_V2_FACTORY, DEFAULT_RPC_URL } from "../chain/config.js";

function loadDotEnv(): void {
  const path = resolve(process.cwd(), ".env");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function str(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw === undefined || raw === "" ? fallback : raw;
}

function list(name: string): string[] {
  return str(name, "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface Config {
  rpcUrl: string;
  rpcWsUrl: string;
  pollMs: number;
  factory: Address;

  indexLookbackBlocks: number;
  logChunkBlocks: number;
  clusterMaxMembers: number;

  gate: { inFlight: number; spacingMs: number; logSpacingMs: number };

  risk: {
    amberPct: number;
    redPct: number;
    taintDevSharePct: number;
    taintExemptWallets: number;
  };
  serialLaunches: number;
  convergence: { windowSec: number; minWallets: number };

  narrativeFeeds: string[];
  narrativeWatchlist: string[];

  color: boolean;
}

let cached: Config | null = null;

export function config(): Config {
  if (cached) return cached;
  loadDotEnv();
  cached = {
    rpcUrl: str("RPC_URL", DEFAULT_RPC_URL),
    rpcWsUrl: str("RPC_WS_URL", ""),
    pollMs: num("POLL_MS", 1500),
    factory: str("PONS_V2_FACTORY", DEFAULT_PONS_V2_FACTORY) as Address,

    indexLookbackBlocks: num("INDEX_LOOKBACK_BLOCKS", 400_000),
    logChunkBlocks: num("LOG_CHUNK_BLOCKS", 20_000),
    clusterMaxMembers: num("CLUSTER_MAX_MEMBERS", 64),

    gate: {
      inFlight: num("RPC_IN_FLIGHT", 3),
      spacingMs: num("RPC_SPACING_MS", 60),
      logSpacingMs: num("RPC_LOGS_SPACING_MS", 400),
    },

    risk: {
      amberPct: num("RISK_HOLDER_AMBER_PCT", 20),
      redPct: num("RISK_HOLDER_RED_PCT", 30),
      taintDevSharePct: num("TAINT_DEV_SHARE_PCT", 10),
      taintExemptWallets: num("TAINT_EXEMPT_WALLETS", 4),
    },
    serialLaunches: num("TAINT_SERIAL_LAUNCHES", 5),
    convergence: {
      windowSec: num("CONVERGENCE_WINDOW_SEC", 90),
      minWallets: num("CONVERGENCE_MIN_WALLETS", 3),
    },

    narrativeFeeds: list("NARRATIVE_FEEDS"),
    narrativeWatchlist: list("NARRATIVE_WATCHLIST"),

    color: !process.env["NO_COLOR"] && process.stdout.isTTY !== false,
  };
  return cached;
}

/** Test hook. Nothing in `src/` calls this. */
export function resetConfig(): void {
  cached = null;
}
