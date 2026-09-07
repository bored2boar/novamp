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
