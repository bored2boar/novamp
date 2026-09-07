/**
 * The local index: what novamp remembers between runs.
 *
 * This is what makes `--since 30d` an honest offer instead of a marketing line.
 * No public RPC will sweep a month of a 100 ms chain, so novamp does not ask one
 * to. Every run appends what it read to a file; the window is built from the
 * accumulation. Day one gives you eleven hours. A month of running gives you a
 * month.
 *
 * Deliberately not a database:
 *
 *   - one JSONL file per UTC day under `.novamp/launches/`, append only
 *   - a launch is written once, keyed by token address
 *   - a corrupt line is skipped and counted, never fatal
 *   - deleting the directory is a supported operation with no consequences
 *
 * Plain files outlive the tool that wrote them, and there is nothing here to
 * migrate, lock, or explain to somebody who just cloned the repository.
 */

import { appendFile, mkdir, readdir, readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { LaunchRecord } from "../types.js";
import type { Coverage } from "../util/window.js";
import { warn } from "../util/log.js";

export const STORE_DIR = () => resolve(process.cwd(), ".novamp");
const LAUNCH_DIR = () => join(STORE_DIR(), "launches");

function dayKey(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

export interface StoreStats {
  files: number;
  launches: number;
  skippedLines: number;
  coverage: Coverage;
  bytes: number;
}

/**
 * Append launches, skipping the ones already on disk.
 *
 * Deduplication is by token address across the whole index, which means one read
 * of every day file per append. That is fine at this size and it keeps the file
 * format append-only, which is the property worth protecting: a crash mid-write
 * costs you one truncated line, not the index.
 */
export async function appendLaunches(records: readonly LaunchRecord[]): Promise<number> {
  if (!records.length) return 0;
  await mkdir(LAUNCH_DIR(), { recursive: true });

  const known = new Set((await loadLaunches(null)).map((r) => r.token.toLowerCase()));
  const byDay = new Map<string, string[]>();
  let written = 0;

  for (const record of records) {
    const key = record.token.toLowerCase();
    if (known.has(key)) continue;
    known.add(key);
    const day = dayKey(record.launchedAt || Date.now() / 1000);
    const lines = byDay.get(day) ?? [];
    lines.push(JSON.stringify(record));
    byDay.set(day, lines);
    written++;
  }

  for (const [day, lines] of byDay) {
    await appendFile(join(LAUNCH_DIR(), `${day}.jsonl`), lines.join("\n") + "\n", "utf8");
  }
  return written;
}

/**
 * Read the index back, optionally bounded to the last `windowSec` seconds.
 *
 * A line that does not parse is skipped with a warning rather than throwing. An
 * index is a convenience; one bad line should never stop a command that would
 * otherwise work.
 */
export async function loadLaunches(windowSec: number | null): Promise<LaunchRecord[]> {
  const dir = LAUNCH_DIR();
  if (!existsSync(dir)) return [];
  const cutoff = windowSec === null ? 0 : Math.floor(Date.now() / 1000) - windowSec;

  const out: LaunchRecord[] = [];
  let skipped = 0;
  for (const name of (await readdir(dir)).filter((n) => n.endsWith(".jsonl")).sort()) {
    const text = await readFile(join(dir, name), "utf8");
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        const record = JSON.parse(line) as LaunchRecord;
        if (record.launchedAt >= cutoff) out.push(record);
      } catch {
        skipped++;
      }
    }
  }
  if (skipped) warn(`${skipped} unreadable line(s) in the local index were skipped`);
  return out;
}

export async function storeStats(): Promise<StoreStats> {
  const dir = LAUNCH_DIR();
  const empty: StoreStats = {
    files: 0,
    launches: 0,
    skippedLines: 0,
    coverage: { oldest: null, newest: null, spanSec: 0 },
    bytes: 0,
  };
  if (!existsSync(dir)) return empty;

  const names = (await readdir(dir)).filter((n) => n.endsWith(".jsonl"));
  let launches = 0;
  let skipped = 0;
  let bytes = 0;
  let oldest: number | null = null;
  let newest: number | null = null;

  for (const name of names) {
    const path = join(dir, name);
    bytes += (await stat(path)).size;
    for (const line of (await readFile(path, "utf8")).split("\n")) {
      if (!line.trim()) continue;
      try {
        const record = JSON.parse(line) as LaunchRecord;
        launches++;
        if (oldest === null || record.launchedAt < oldest) oldest = record.launchedAt;
        if (newest === null || record.launchedAt > newest) newest = record.launchedAt;
      } catch {
        skipped++;
      }
    }
  }

  return {
    files: names.length,
    launches,
    skippedLines: skipped,
    bytes,
    coverage: {
      oldest,
      newest,
      spanSec: oldest !== null && newest !== null ? newest - oldest : 0,
    },
  };
}

/**
 * Merge what the source just read with what the index remembers.
 *
 * Fresh records win on conflict: the index is a memory of what a launch looked
 * like at the time, and a live read is what it looks like now.
 */
export function mergeByToken(
  fresh: readonly LaunchRecord[],
  remembered: readonly LaunchRecord[],
): LaunchRecord[] {
  const map = new Map<string, LaunchRecord>();
  for (const record of remembered) map.set(record.token.toLowerCase(), record);
  for (const record of fresh) map.set(record.token.toLowerCase(), record);
  return [...map.values()];
}
