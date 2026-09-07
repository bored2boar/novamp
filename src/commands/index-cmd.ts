/**
 * `novamp index` - how much history novamp actually has.
 *
 * This exists because `--since 30d` is a promise, and a tool that makes a
 * promise it cannot yet keep should be able to tell you so in one command
 * rather than by quietly returning three days of data.
 */

import { storeStats, STORE_DIR } from "../store/index.js";
import { describeWindow } from "../util/window.js";
import { renderPairs } from "../ui/table.js";
import { bold, dim, green, yellow } from "../ui/color.js";
import { iso } from "../util/fmt.js";

function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export async function indexStatus(opts: { json?: boolean }): Promise<number> {
  const stats = await storeStats();

  if (opts.json) {
    process.stdout.write(JSON.stringify({ dir: STORE_DIR(), ...stats }, null, 2) + "\n");
    return 0;
  }

  if (!stats.launches) {
    process.stdout.write(
      `\n${yellow("the local index is empty.")}\n` +
        dim(
          `  It fills in on its own: every live command appends what it read to\n` +
            `  ${STORE_DIR()}. Run \`novamp vamp <name>\` against the chain once and\n` +
            `  come back. Demo runs never write to it.\n\n`,
        ),
    );
    return 0;
  }

  const rows: [string, string][] = [
    ["directory", dim(STORE_DIR())],
    ["day files", String(stats.files)],
    ["launches", bold(String(stats.launches))],
    ["on disk", bytes(stats.bytes)],
    ["oldest launch", stats.coverage.oldest ? iso(stats.coverage.oldest) : dim("-")],
    ["newest launch", stats.coverage.newest ? iso(stats.coverage.newest) : dim("-")],
    ["window available", green(describeWindow(stats.coverage.spanSec))],
  ];
  if (stats.skippedLines) {
    rows.push(["unreadable lines", yellow(String(stats.skippedLines))]);
  }

  process.stdout.write(`\n${bold("local index")}\n\n${renderPairs(rows)}\n\n`);
  process.stdout.write(
    dim(
      "A `--since` wider than the window above is answered with what exists, and the\n" +
        "command says how far short it fell. Deleting .novamp/ is safe and costs only\n" +
        "the history.\n\n",
    ),
  );
  return 0;
}
