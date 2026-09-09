/**
 * The fixture source.
 *
 * `--demo` exists so a fresh clone prints a real table on the first command,
 * with no RPC, no key and no waiting. Everything above this file is the same
 * code the live source drives, so what you see in demo is what the tool does.
 *
 * The shipped fixtures are SYNTHETIC. They are shaped like real pons v2
 * launches and they are not recordings of real ones, and the banner says so
 * every time you run in this mode. To replace them with real captures from the
 * chain, see `scripts/capture-fixtures.ts` and docs/FIXTURES.md.
 */

import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { LaunchRecord } from "../types.js";
import type { LaunchSource } from "./index.js";

export interface FixtureFile {
  /** "synthetic" or "capture". Printed in the banner; do not lie in this field. */
  origin: "synthetic" | "capture";
  note: string;
  capturedAt?: string;
  launches: LaunchRecord[];
}

function fixturesDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const candidate of [
    resolve(here, "../../fixtures"),
    resolve(here, "../../../fixtures"),
    resolve(process.cwd(), "fixtures"),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return resolve(process.cwd(), "fixtures");
}

export async function loadFixtures(dir = join(fixturesDir(), "clusters")): Promise<{
  launches: LaunchRecord[];
  origins: Set<string>;
  files: string[];
}> {
  const launches: LaunchRecord[] = [];
  const origins = new Set<string>();
  const files: string[] = [];
  let names: string[] = [];
  try {
    names = (await readdir(dir)).filter((n) => n.endsWith(".json"));
  } catch {
    return { launches, origins, files };
  }
  for (const name of names.sort()) {
    const parsed = JSON.parse(await readFile(join(dir, name), "utf8")) as FixtureFile;
    if (!Array.isArray(parsed.launches)) continue;
    origins.add(parsed.origin ?? "unknown");
    files.push(name);
    launches.push(...parsed.launches);
  }
  return { launches, origins, files };
}

export interface NewsFixtureFile {
  origin: "synthetic" | "capture";
  note: string;
  items: { title: string; source: string; publishedAt: number }[];
}

/**
 * Headlines for `novamp swarm --demo`.
 *
 * The fixture launches are stamped at a fixed point in 2026, so the news that
 * goes with them has to be stamped relative to the same point rather than to
 * whenever you happen to run the demo. The matcher only ever compares a headline
 * to the burst it is being tested against, never to the wall clock, which is why
 * this works and why the same code path runs live without a special case.
 *
 * Synthetic, like everything else under fixtures/. Nobody said any of this.
 */
export async function loadNewsFixture(
  path = join(fixturesDir(), "news.json"),
): Promise<NewsFixtureFile["items"]> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as NewsFixtureFile;
    return Array.isArray(parsed.items) ? parsed.items : [];
  } catch {
    return [];
  }
}

export async function demoSource(): Promise<LaunchSource> {
  const { launches, origins, files } = await loadFixtures();
  const origin = origins.has("capture")
    ? origins.size > 1
      ? "mixed capture and synthetic"
      : "captured from Robinhood Chain"
    : "SYNTHETIC, not chain data";
  return {
    kind: "demo",
    describe: `${launches.length} launches from ${files.length} fixture file(s) · ${origin}`,
    async recent() {
      return launches;
    },
    async byToken(token: string) {
      const wanted = token.toLowerCase();
      return launches.find((l) => l.token.toLowerCase() === wanted) ?? null;
    },
  };
}
