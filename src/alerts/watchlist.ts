/**
 * Names you are watching, and what counts as news about them.
 *
 * The watchlist is a plain JSON file under `.novamp/`. Two events fire:
 *
 *   - a new copy landed under a name you are watching
 *   - a cluster you are watching flipped to CONTESTED, meaning the first born
 *     stopped looking like the original and the money moved somewhere else
 *
 * Both are things you would want to know inside a minute and would otherwise
 * find out from a chart an hour later.
 *
 * Deduplication is by (name, token, event), remembered on disk, because an alert
 * that fires every poll is an alert you turn off by tomorrow.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Cluster } from "../types.js";
import { looseKey } from "../vamp/normalize.js";
import { STORE_DIR } from "../store/index.js";

const FILE = () => join(STORE_DIR(), "watchlist.json");

export interface WatchEntry {
  /** What the user typed. */
  query: string;
  /** The normalised key it resolves to. */
  key: string;
  addedAt: string;
  note?: string;
}

export interface WatchState {
  entries: WatchEntry[];
  /** Event ids already sent, so a poll loop does not repeat itself. */
  sent: string[];
}

const EMPTY: WatchState = { entries: [], sent: [] };

export async function loadWatchlist(): Promise<WatchState> {
  const path = FILE();
  if (!existsSync(path)) return { ...EMPTY };
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as WatchState;
    return { entries: parsed.entries ?? [], sent: parsed.sent ?? [] };
  } catch {
    return { ...EMPTY };
  }
}

export async function saveWatchlist(state: WatchState): Promise<void> {
  await mkdir(STORE_DIR(), { recursive: true });
  // The sent list is capped: it is a dedup memory, not an audit log, and an
  // unbounded array in a file that is rewritten every poll is a slow leak.
  const trimmed: WatchState = { entries: state.entries, sent: state.sent.slice(-2000) };
  await writeFile(FILE(), JSON.stringify(trimmed, null, 2) + "\n", "utf8");
}

export function addToWatchlist(state: WatchState, query: string, note?: string): WatchState {
  const key = looseKey(query);
  if (!key) return state;
  if (state.entries.some((entry) => entry.key === key)) return state;
  return {
    ...state,
    entries: [
      ...state.entries,
      { query, key, addedAt: new Date().toISOString(), ...(note ? { note } : {}) },
    ],
  };
}

export function removeFromWatchlist(state: WatchState, query: string): WatchState {
  const key = looseKey(query);
  return { ...state, entries: state.entries.filter((entry) => entry.key !== key) };
}

export type AlertKind = "new-copy" | "contested";

export interface Alert {
  id: string;
  kind: AlertKind;
  key: string;
  text: string;
}

/**
 * What is worth waking somebody up for, given a watched cluster.
 *
 * Note that a launch which is simply late and quiet produces nothing. The bar is
 * "this changes what you would do", and a seventh dead copy of a name does not.
 */
export function alertsFor(cluster: Cluster, watched: WatchEntry): Alert[] {
  const out: Alert[] = [];

  for (const member of cluster.members) {
    if (member.rank === 1) continue;
    if (member.verdict === "DEAD") continue;
    out.push({
      id: `new-copy:${member.record.token.toLowerCase()}`,
      kind: "new-copy",
      key: watched.key,
      text:
        `<b>${escapeName(member.record.symbol)}</b> is copying <b>${escapeName(cluster.label)}</b>\n` +
        `#${member.rank} of ${cluster.members.length}, ${Math.round(member.lagSec)}s behind the first\n` +
        `score ${member.potential} · risk ${member.risk}\n` +
        `<code>${member.record.token}</code>`,
    });
  }

  const contested = cluster.members.find((member) => member.verdict === "CONTESTED");
  if (contested) {
    out.push({
      id: `contested:${cluster.key}:${contested.record.token.toLowerCase()}`,
      kind: "contested",
      key: watched.key,
      text:
        `<b>${escapeName(cluster.label)}</b> is CONTESTED\n` +
        `the first launch looks like the operator's own bait; the flow is on ` +
        `<b>${escapeName(contested.record.symbol)}</b> (rank ${contested.rank})\n` +
        `<code>${contested.record.token}</code>`,
    });
  }

  return out;
}

function escapeName(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Filter out anything already sent, and return the updated memory. */
export function undelivered(
  state: WatchState,
  alerts: readonly Alert[],
): { fresh: Alert[]; state: WatchState } {
  const seen = new Set(state.sent);
  const fresh = alerts.filter((alert) => !seen.has(alert.id));
  return {
    fresh,
    state: { ...state, sent: [...state.sent, ...fresh.map((alert) => alert.id)] },
  };
}
