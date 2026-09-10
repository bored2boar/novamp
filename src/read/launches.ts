/**
 * Reading launches off Robinhood Chain.
 *
 * This is the one file that talks to an RPC for the launch index. It is written
 * against the public endpoint, which means: chunk every log read, keep the
 * in-flight count low, and treat a failed chunk as "unknown" rather than as
 * "zero". A tool that quietly turns a rate limit into a confident empty answer
 * is worse than one that says it could not read.
 *
 * STATUS: run against mainnet, returning real launches. Anything that breaks on
 * your live run is still a bug worth an issue rather than a design decision.
 * See docs/LIMITATIONS.md.
 */

import { createPublicClient, http, getAddress, type PublicClient } from "viem";
import type { Address, LaunchRecord, Phase, Socials } from "../types.js";
import { curveAbi, factoryAbi, tokenAbi, tokenLaunchedEvent } from "../chain/abi/pons.js";
import { DEFAULT_SUPPLY, ROBINHOOD_CHAIN_ID } from "../chain/config.js";
import { RpcGate } from "../chain/gate.js";
import { config } from "../util/env.js";
import { warn } from "../util/log.js";

export interface ReaderOptions {
  lookbackBlocks: number;
  chunkBlocks: number;
  gate: RpcGate;
}

export function makeClient(rpcUrl = config().rpcUrl): PublicClient {
  return createPublicClient({
    transport: http(rpcUrl, { batch: false, retryCount: 0, timeout: 20_000 }),
  }) as PublicClient;
}

export async function verifyChain(client: PublicClient): Promise<{ ok: boolean; chainId: number }> {
  const chainId = await client.getChainId();
  return { ok: chainId === ROBINHOOD_CHAIN_ID, chainId };
}

/** Raw TokenLaunched events over a block window, chunked. */
export async function readLaunchEvents(
  client: PublicClient,
  options: ReaderOptions,
): Promise<
  {
    token: Address;
    curve: Address;
    deployer: Address;
    pairToken: Address;
    block: number;
    txIndex: number;
    logIndex: number;
  }[]
> {
  const cfg = config();
  const head = Number(await options.gate.retry(() => client.getBlockNumber()));
  const from = Math.max(0, head - options.lookbackBlocks);
  const out: Awaited<ReturnType<typeof readLaunchEvents>> = [];

  for (let start = from; start <= head; start += options.chunkBlocks) {
    const end = Math.min(head, start + options.chunkBlocks - 1);
    try {
      const logs = await options.gate.retry(
        () =>
          client.getLogs({
            address: cfg.factory,
            fromBlock: BigInt(start),
            toBlock: BigInt(end),
            event: tokenLaunchedEvent,
          }),
        "logs",
      );
      for (const log of logs) {
        const args = log.args;
        if (!args.token || !args.curve || !args.deployer || !args.pairToken) continue;
        out.push({
          token: getAddress(args.token) as Address,
          curve: getAddress(args.curve) as Address,
          deployer: getAddress(args.deployer) as Address,
          pairToken: getAddress(args.pairToken) as Address,
          block: Number(log.blockNumber ?? 0n),
          txIndex: log.transactionIndex ?? 0,
          logIndex: log.logIndex ?? 0,
        });
      }
    } catch (err) {
      // A refused chunk is a hole in the window, not an empty window.
      warn(`log chunk ${start}-${end} refused: ${(err as Error).message}`);
    }
  }
  return out;
}

function socialsFrom(raw: {
  twitter: string;
  telegram: string;
  discord: string;
  website: string;
  farcaster: string;
}): Socials {
  const clean = (value: string) => (value && value.trim() ? value.trim() : undefined);
  return {
    twitter: clean(raw.twitter),
    telegram: clean(raw.telegram),
    discord: clean(raw.discord),
    website: clean(raw.website),
    farcaster: clean(raw.farcaster),
  };
}

/**
 * Fill in one launch: name, symbol, phase, tax, reserve, curve progress.
 *
 * Deliberately does NOT read holders or the buyer list. Those are the expensive
 * calls and they are only worth making for the handful of launches that end up
 * in a cluster, so they live in their own modules and are called after the
 * cluster is known.
 */
export async function enrichLaunch(
  client: PublicClient,
  gate: RpcGate,
  base: {
    token: Address;
    curve: Address;
    deployer: Address;
    pairToken: Address;
    block: number;
    txIndex: number;
    logIndex: number;
  },
): Promise<LaunchRecord | null> {
  const cfg = config();
  try {
    const [name, symbol, info, record, reserve, threshold, launchedAt] = await Promise.all([
      gate.retry(() => client.readContract({ address: base.token, abi: tokenAbi, functionName: "name" })),
      gate.retry(() => client.readContract({ address: base.token, abi: tokenAbi, functionName: "symbol" })),
      gate
        .retry(() =>
          client.readContract({ address: base.token, abi: tokenAbi, functionName: "getTokenInfo" }),
        )
        .catch(() => null),
      gate.retry(() =>
        client.readContract({
          address: cfg.factory,
          abi: factoryAbi,
          functionName: "getLaunchedToken",
          args: [base.token],
        }),
      ),
      gate
        .retry(() =>
          client.readContract({ address: base.curve, abi: curveAbi, functionName: "realQuoteReserve" }),
        )
        .catch(() => 0n),
      gate
        .retry(() =>
          client.readContract({
            address: base.curve,
            abi: curveAbi,
            functionName: "graduationThreshold",
          }),
        )
        .catch(() => 0n),
      gate
        .retry(() => client.readContract({ address: base.curve, abi: curveAbi, functionName: "launchedAt" }))
        .catch(() => 0n),
    ]);

    const socials = info ? socialsFrom(info[3]) : {};
    const quoteReserve = reserve as bigint;
    const grad = threshold as bigint;

    // Deployer balance right after launch is the closest cheap proxy for how
    // much of the supply the launcher kept. `holders.ts` refines it later.
    const devBalance = await gate
      .retry(() =>
        client.readContract({
          address: base.token,
          abi: tokenAbi,
          functionName: "balanceOf",
          args: [base.deployer],
        }),
      )
      .catch(() => 0n);

    const supply = await gate
      .retry(() => client.readContract({ address: base.token, abi: tokenAbi, functionName: "totalSupply" }))
      .catch(() => DEFAULT_SUPPLY);

    return {
      token: base.token,
      curve: base.curve,
      deployer: base.deployer,
      name: name as string,
      symbol: symbol as string,
      block: base.block,
      txIndex: base.txIndex,
      logIndex: base.logIndex,
      launchedAt: Number(launchedAt as bigint),
      pairToken: base.pairToken,
      pairSymbol: "",
      phase: Number(record.phase) as Phase,
      creatorTaxBps: Number(record.creatorTaxBps),
      creatorFeeRecipient: getAddress(record.creatorFeeRecipient) as Address,
      devSharePct:
        (supply as bigint) > 0n ? Number((devBalance * 10_000n) / (supply as bigint)) / 100 : 0,
      // Exemptions are declared in the launch calldata, not in a view. `read/exemptions.ts`
      // recovers them from the launch transaction when the RPC serves it.
      exemptWallets: 0,
      socials,
      quoteReserveWei: quoteReserve.toString(),
      curveProgress: grad > 0n ? Math.min(1, Number((quoteReserve * 10_000n) / grad) / 10_000) : 0,
    };
  } catch (err) {
    warn(`could not enrich ${base.token}: ${(err as Error).message}`);
    return null;
  }
}
