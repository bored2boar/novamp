/**
 * The live source: Robinhood Chain, read only.
 *
 * Two stage read, on purpose. Stage one pulls the launch index over the window
 * and enriches it just enough to cluster on a name, because that is cheap.
 * Stage two, in `deepen()`, spends the expensive calls (holders, buyers,
 * funding) on the handful of launches that ended up in the cluster the user
 * actually asked about.
 *
 * Doing it the other way round is how you turn a two second answer into a rate
 * limited four minute one.
 */

import type { PublicClient } from "viem";
import type { LaunchRecord } from "../types.js";
import type { LaunchSource } from "./index.js";
import { RpcGate } from "../chain/gate.js";
import { enrichLaunch, makeClient, readLaunchEvents } from "../read/launches.js";
import { readEarlyBuyers } from "../read/buyers.js";
import { readHolders } from "../read/holders.js";
import { traceFunding } from "../read/funding.js";
import { config } from "../util/env.js";
import { info } from "../util/log.js";

export interface LiveSource extends LaunchSource {
  client: PublicClient;
  gate: RpcGate;
  /** Spend the expensive calls on a short list of launches. */
  deepen(records: LaunchRecord[], opts?: { funding?: boolean }): Promise<LaunchRecord[]>;
  /** Drop the index cache so the next `recent()` re-reads the window. */
  invalidate(): void;
}

export function liveSource(): LiveSource {
  const cfg = config();
  const client = makeClient(cfg.rpcUrl);
  const gate = new RpcGate(cfg.gate);
  let cache: LaunchRecord[] | null = null;

  return {
    kind: "live",
    describe: `${cfg.rpcUrl} · last ${cfg.indexLookbackBlocks.toLocaleString()} blocks`,
    client,
    gate,

    async recent() {
      if (cache) return cache;
      const events = await readLaunchEvents(client, {
        lookbackBlocks: cfg.indexLookbackBlocks,
        chunkBlocks: cfg.logChunkBlocks,
        gate,
      });
      info(`${events.length} launches in the window, reading names`);

      const records: LaunchRecord[] = [];
      // Sequential on purpose: the gate would serialise these anyway and a flat
      // loop keeps the failure message attached to the launch that caused it.
      for (const event of events) {
        const record = await enrichLaunch(client, gate, event);
        if (record) records.push(record);
      }

      // Deployer history is derived from the index we already hold, not re-read.
      const byDeployer = new Map<string, LaunchRecord[]>();
      for (const record of records) {
        const key = record.deployer.toLowerCase();
        byDeployer.set(key, [...(byDeployer.get(key) ?? []), record]);
      }
      for (const record of records) {
        const siblings = byDeployer.get(record.deployer.toLowerCase()) ?? [];
        record.deployerRecord = {
          priorLaunches: siblings.length,
          graduated: siblings.filter((s) => s.phase === 2).length,
        };
      }

      cache = records;
      return records;
    },

    invalidate() {
      cache = null;
    },

    async byToken(token: string) {
      const all = await this.recent();
      const wanted = token.toLowerCase();
      return all.find((r) => r.token.toLowerCase() === wanted) ?? null;
    },

    async deepen(records: LaunchRecord[], opts = {}) {
      for (const record of records) {
        const [holders, buyers] = await Promise.all([
          readHolders(client, gate, record).catch(() => undefined),
          readEarlyBuyers(client, gate, record).catch(() => undefined),
        ]);
        if (holders) record.holders = holders;
        if (buyers) {
          record.buyers = buyers.buyers;
          record.uniqueEarlyBuyers = buyers.unique;
        }
        if (opts.funding && record.deployerRecord) {
          const trace = await traceFunding(client, gate, record.deployer, record.block);
          if (trace.funder) record.deployerRecord.fundedBy = trace.funder;
        }
      }
      return records;
    },
  };
}
