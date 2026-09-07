/** What every command needs before it can answer anything. */

import { resolve } from "node:path";
import type { LaunchRecord } from "../types.js";
import type { LaunchSource } from "../source/index.js";
import { demoSource } from "../source/demo.js";
import { liveSource, type LiveSource } from "../source/live.js";
import { indexOf, loadRegistry, type Registry } from "../smart/registry.js";
import { appendLaunches, loadLaunches, mergeByToken, storeStats } from "../store/index.js";
import { config, type Config } from "../util/env.js";
import { coversWindow, describeWindow, parseWindow } from "../util/window.js";
import { info, warn } from "../util/log.js";
import type { VerdictOptions } from "../vamp/verdict.js";

export interface CommandContext {
  cfg: Config;
  source: LaunchSource;
  live: LiveSource | null;
  registry: Registry;
  verdictOptions: VerdictOptions;
  /** The requested window in seconds, or null for everything indexed. */
  windowSec: number | null;
  /**
   * Every launch this command should consider: what the source just read, merged
   * with what the local index remembers, bounded by the window.
   */
  launches(): Promise<LaunchRecord[]>;
}

export const REGISTRY_PATH = () => resolve(process.cwd(), "fixtures/smart-wallets.json");

export interface ContextOptions {
  demo?: boolean;
  /** "24h", "7d", "30d", "all". Defaults to whatever the source window is. */
  since?: string;
  /** Skip writing what was read into the local index. */
  noIndex?: boolean;
}

export async function makeContext(opts: ContextOptions): Promise<CommandContext> {
  const cfg = config();
  const source = opts.demo ? await demoSource() : liveSource();
  const registry = await loadRegistry(REGISTRY_PATH());
  const windowSec = opts.since ? parseWindow(opts.since) : null;

  let cached: LaunchRecord[] | null = null;

  return {
    cfg,
    source,
    live: opts.demo ? null : (source as LiveSource),
    registry,
    windowSec,
    verdictOptions: {
      risk: cfg.risk,
      convergence: cfg.convergence,
      smartIndex: indexOf(registry),
      serialLaunches: cfg.serialLaunches,
    },

    async launches() {
      if (cached) return cached;
      const fresh = await source.recent();

      // Demo mode never touches the index: replaying fixtures into a real local
      // history would poison every window that came after it.
      if (opts.demo) {
        cached = fresh;
        return cached;
      }

      if (!opts.noIndex) {
        const added = await appendLaunches(fresh);
        if (added) info(`${added} new launch(es) added to the local index`);
      }

      const remembered = await loadLaunches(windowSec);
      cached = mergeByToken(fresh, remembered);

      if (windowSec !== null) {
        const stats = await storeStats();
        const { covered, shortBySec } = coversWindow(stats.coverage, windowSec);
        if (!covered) {
          warn(
            `the local index only goes back ${describeWindow(stats.coverage.spanSec)}, ` +
              `${describeWindow(shortBySec)} short of the ${describeWindow(windowSec)} you asked for. ` +
              `Keep running novamp and the window fills in.`,
          );
        }
        const cutoff = Math.floor(Date.now() / 1000) - windowSec;
        cached = cached.filter((record) => record.launchedAt >= cutoff);
      }

      return cached;
    },
  };
}
