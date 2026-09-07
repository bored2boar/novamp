/**
 * Grouping launches that are fighting over the same thing.
 *
 * A pons v2 launch carries two strings a copy can borrow: the symbol and the
 * name. Both matter, and they fail in different directions.
 *
 *   - Same symbol, different name.  The common case, and the boring one:
 *     nothing stops anyone reusing a ticker, so most vamps just reuse it.
 *   - Same name, different symbol.  "Peanut the Squirrel" as PEANUT, PNUT and
 *     SQUIRREL. A symbol-only matcher misses the whole fight, and this is the
 *     shape a copy takes once the obvious ticker is already taken.
 *   - Nearly the same symbol.  PEANUTCOIN, PEANUT2, PEANUTS, $PEANUT with a
 *     trailing space, and at the far end a lookalike character. Individually
 *     rare; together they are most of what an exact match drops on the floor.
 *
 * So a launch is indexed under both of its keys, and anything sharing a key
 * ends up in one cluster. Union-find rather than a single bucket map, because
 * membership is transitive: A shares a symbol with B, B shares a name with C,
 * and all three are one fight.
 */

import type { LaunchRecord } from "../types.js";
import { keysFor, looseKey, nearEnough, type NameKeys } from "./normalize.js";

/** How a member reached the cluster. Printed in the table so a join is never silent. */
export type JoinKind =
  /** Byte-identical symbol to the first born. */
  | "exact"
  /** Same symbol once lookalike characters and case are folded. */
  | "tight"
  /** Different symbol, same token name. */
  | "name"
  /** Same idea after leetspeak, repeats and filler, or within an edit or two. */
  | "loose";

export interface ClusterMember {
  record: LaunchRecord;
  /** Keys derived from the symbol. */
  keys: NameKeys;
  /** Keys derived from the token name. */
  nameKeys: NameKeys;
  joinedBy: JoinKind;
}

export interface RawCluster {
  key: string;
  label: string;
  members: ClusterMember[];
}

/** Birth order. Block first, then position in the block. Timestamps tie too often. */
export function birthOrder(a: LaunchRecord, b: LaunchRecord): number {
  if (a.block !== b.block) return a.block - b.block;
  if (a.txIndex !== b.txIndex) return a.txIndex - b.txIndex;
  return a.logIndex - b.logIndex;
}

/** Symbols shorter than this are too generic to join on. */
const MIN_SYMBOL_KEY = 3;
/**
 * Names get a higher bar than symbols. A symbol is chosen to be distinctive; a
 * name is prose, and joining every launch called "Coin" into one cluster helps
 * nobody.
 */
const MIN_NAME_KEY = 4;

interface Indexed {
  record: LaunchRecord;
  keys: NameKeys;
  nameKeys: NameKeys;
  /** The loose keys this launch is findable under. */
  symbolKey: string | null;
  nameKey: string | null;
}

function indexOne(record: LaunchRecord): Indexed {
  const keys = keysFor(record.symbol);
  const nameKeys = keysFor(record.name);
  return {
    record,
    keys,
    nameKeys,
    symbolKey: keys.loose.length >= MIN_SYMBOL_KEY ? keys.loose : null,
    // A name that folds to the same key as its own symbol adds nothing.
    nameKey:
      nameKeys.loose.length >= MIN_NAME_KEY && nameKeys.loose !== keys.loose ? nameKeys.loose : null,
  };
}

/** Disjoint set over launch indexes. Small, and the whole reason joins are transitive. */
class Union {
  private parent: number[];
  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, i) => i);
  }
  find(i: number): number {
    while (this.parent[i] !== i) {
      this.parent[i] = this.parent[this.parent[i]!]!;
      i = this.parent[i]!;
    }
    return i;
  }
  join(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[rb] = ra;
  }
}

/**
 * Group a flat launch list into clusters.
 *
 * Three passes. Exact key buckets, then a fuzzy merge of keys that are within an
 * edit or two, then the union-find collapse into groups.
 */
export function clusterLaunches(records: readonly LaunchRecord[]): RawCluster[] {
  const indexed = records.map(indexOne);
  const union = new Union(indexed.length);

  // Pass one: every launch joins every other launch it shares a key with.
  const byKey = new Map<string, number[]>();
  indexed.forEach((entry, i) => {
    for (const key of [entry.symbolKey, entry.nameKey]) {
      if (!key) continue;
      const bucket = byKey.get(key);
      if (bucket) bucket.push(i);
      else byKey.set(key, [i]);
    }
  });
  for (const bucket of byKey.values()) {
    for (let i = 1; i < bucket.length; i++) union.join(bucket[0]!, bucket[i]!);
  }

  // Pass two: keys that are one or two edits apart are the same fight.
  const keys = [...byKey.keys()];
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      if (!nearEnough(keys[i]!, keys[j]!)) continue;
      union.join(byKey.get(keys[i]!)![0]!, byKey.get(keys[j]!)![0]!);
    }
  }

  // Pass three: collapse.
  const groups = new Map<number, Indexed[]>();
  indexed.forEach((entry, i) => {
    if (!entry.symbolKey && !entry.nameKey) return; // nothing readable to cluster on
    const root = union.find(i);
    const group = groups.get(root);
    if (group) group.push(entry);
    else groups.set(root, [entry]);
  });

  const out: RawCluster[] = [];
  for (const group of groups.values()) {
    group.sort((a, b) => birthOrder(a.record, b.record));
    const first = group[0]!;
    const members: ClusterMember[] = group.map((entry) => ({
      record: entry.record,
      keys: entry.keys,
      nameKeys: entry.nameKeys,
      joinedBy: joinKind(entry, first),
    }));
    out.push({
      key: first.symbolKey ?? first.nameKey ?? "",
      label: first.record.symbol,
      members,
    });
  }

  out.sort((a, b) => birthOrder(a.members[0]!.record, b.members[0]!.record));
  return out;
}

/**
 * Why this member is in this cluster, from the reader's point of view.
 *
 * Ordered from "you would have seen this yourself" to "you would not have":
 * an identical symbol needs no explanation, a folded one needs the characters
 * naming, and a name match needs saying out loud because the symbols differ.
 */
function joinKind(entry: Indexed, first: Indexed): JoinKind {
  if (entry === first) return "exact";
  if (entry.record.symbol === first.record.symbol) return "exact";
  if (entry.keys.tight && entry.keys.tight === first.keys.tight) return "tight";
  if (entry.keys.loose && entry.keys.loose === first.keys.loose) return "loose";
  if (entry.nameKey && (entry.nameKey === first.nameKey || entry.nameKey === first.symbolKey)) {
    return "name";
  }
  if (entry.symbolKey && entry.symbolKey === first.nameKey) return "name";
  return "loose";
}

/**
 * Find the one cluster a query belongs to.
 *
 * The query is whatever the user typed: a ticker, a token name, a narrative
 * word. It is normalised exactly like a launch string, so `$PEANUT`, `peanut`
 * and `Peanut the Squirrel!` all reach the same fight.
 */
export function findCluster(records: readonly LaunchRecord[], query: string): RawCluster | null {
  const wanted = looseKey(query);
  if (!wanted) return null;
  const all = clusterLaunches(records);

  const matches = (member: ClusterMember) =>
    member.keys.loose === wanted || member.nameKeys.loose === wanted;

  const exact = all.filter((cluster) => cluster.members.some(matches));
  if (exact.length) {
    exact.sort((a, b) => b.members.length - a.members.length);
    return exact[0]!;
  }

  const near = all.filter((cluster) =>
    cluster.members.some(
      (member) =>
        nearEnough(member.keys.loose, wanted) ||
        (member.nameKeys.loose.length >= MIN_NAME_KEY && nearEnough(member.nameKeys.loose, wanted)),
    ),
  );
  if (!near.length) return null;
  // Prefer the busiest near match: a query for a hot narrative wants the fight,
  // not the one quiet launch that happens to be a letter closer.
  near.sort((a, b) => b.members.length - a.members.length);
  return near[0]!;
}

/** Clusters worth showing: anything with a copy in it. */
export function contestedOnly(clusters: readonly RawCluster[]): RawCluster[] {
  return clusters.filter((c) => c.members.length > 1);
}
