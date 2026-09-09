#!/usr/bin/env node
/**
 * novamp - a read-only clone resolver for pons v2 launches on Robinhood Chain.
 *
 * There is no key, no signer and no transaction path anywhere below this file,
 * and CI fails the build if one appears.
 */

import { Command, Option } from "commander";
import { doctor } from "./commands/doctor.js";
import { vamp } from "./commands/vamp.js";
import { scan } from "./commands/scan.js";
import { stats } from "./commands/stats.js";
import { watch } from "./commands/watch.js";
import { wallet } from "./commands/wallet.js";
import { farms } from "./commands/farms.js";
import { board } from "./commands/board.js";
import { narrative } from "./commands/narrative.js";
import { swarm } from "./commands/swarm.js";
import { indexStatus } from "./commands/index-cmd.js";
import { smartBuild, smartList } from "./commands/smart.js";
import {
  watchlistAdd,
  watchlistList,
  watchlistRemove,
  watchlistRun,
} from "./commands/watchlist.js";
import { setQuiet, fail } from "./util/log.js";
import { WindowParseError } from "./util/window.js";
import { bold, dim } from "./ui/color.js";

const program = new Command();

/** Shared across every command that reads a window, so the help stays one story. */
const sinceOption = () =>
  new Option(
    "--since <window>",
    "how far back to look: 6h, 24h, 7d, 30d, 2w, or all. Bounded by the local index",
  );

const demoOption = () =>
  new Option("--demo", "read the bundled fixtures instead of the chain");

program
  .name("novamp")
  .description(
    "Find every token vamping a name, work out which one is the original, and flag the ones to leave alone.",
  )
  .version("0.4.0")
  .option("-q, --quiet", "suppress progress lines on stderr")
  .hook("preAction", (thisCommand) => {
    if (thisCommand.opts()["quiet"]) setQuiet(true);
  });

program
  .command("doctor")
  .description("check the config, the fixtures, the local index and (with --probe) the chain")
  .option("--probe", "touch the network: chain id, head block, pons parameters")
  .action(async (opts) => {
    process.exitCode = await doctor(opts);
  });

program
  .command("vamp")
  .argument("<name>", "a ticker, a token name or a narrative word")
  .description("resolve a clone fight: who was first, who has the flow, who to leave alone")
  .addOption(demoOption())
  .addOption(sinceOption())
  .option("--all", "full breakdown of every member, not just the headline")
  .option("--shallow", "skip holders, buyers and funding: much faster, less certain")
  .option("--csv <path>", "write the cluster to a CSV, reasons and flags included")
  .option("--json", "machine readable output")
  .action(async (name: string, opts) => {
    process.exitCode = await vamp(name, opts);
  });

program
  .command("wallet")
  .argument("<address>", "the wallet to check")
  .description("how many of your own positions turned out to be copies")
  .addOption(demoOption())
  .addOption(sinceOption())
  .option("--json", "machine readable output")
  .action(async (address: string, opts) => {
    process.exitCode = await wallet(address, opts);
  });

program
  .command("scan")
  .argument("<token>", "token address")
  .description("everything about one launch, including the cluster it is in")
  .addOption(demoOption())
  .addOption(sinceOption())
  .option("--json", "machine readable output")
  .action(async (token: string, opts) => {
    process.exitCode = await scan(token, opts);
  });

program
  .command("board")
  .description("the same engine behind a page on 127.0.0.1, local only")
  .addOption(demoOption())
  .addOption(sinceOption())
  .option("--port <n>", "port to bind on 127.0.0.1", (v) => Number(v))
  .action(async (opts) => {
    process.exitCode = await board(opts);
  });

program
  .command("watch")
  .description("live feed, loud only when a launch is copying something that already exists")
  .addOption(demoOption())
  .action(async (opts) => {
    process.exitCode = await watch(opts);
  });

program
  .command("farms")
  .description("who is producing the copies: deployers ranked by how many they shipped")
  .addOption(demoOption())
  .addOption(sinceOption())
  .option("--top <n>", "how many operators to list", (v) => Number(v), 15)
  .option("--min-copies <n>", "only operators with at least this many copies", (v) => Number(v), 1)
  .option("--csv <path>", "write the full ranking to a CSV")
  .option("--json", "machine readable output")
  .action(async (opts) => {
    process.exitCode = await farms(opts);
  });

program
  .command("stats")
  .description("vamp ratio and vamp lag for the window: the shape of the chain, not one token")
  .addOption(demoOption())
  .addOption(sinceOption())
  .option("--top <n>", "how many busy names to list", (v) => Number(v), 10)
  .option("--json", "machine readable output")
  .action(async (opts) => {
    process.exitCode = await stats(opts);
  });

program
  .command("narrative")
  .description("which words are in the air, and what launched under them")
  .addOption(demoOption())
  .addOption(sinceOption())
  .option("--limit <n>", "how many keywords to keep", (v) => Number(v), 20)
  .option("--json", "machine readable output")
  .action(async (opts) => {
    process.exitCode = await narrative(opts);
  });

program
  .command("swarm")
  .description(
    "catch a name the moment it turns into a fight: a burst of launches, the headline behind it, and which one is real",
  )
  .addOption(demoOption())
  .addOption(sinceOption())
  .option("--watch", "keep watching instead of answering once")
  .option("--every <seconds>", "seconds between polls when watching, minimum 30", (v) => Number(v))
  .option("--min-cluster <n>", "launches under one name before it counts as a swarm", (v) => Number(v))
  .option("--window <seconds>", "how tight the burst has to be", (v) => Number(v))
  .option("--min-deployers <n>", "distinct deployers required: one hand is a farm, not news", (v) => Number(v))
  .option("--no-news", "skip the headline check and report bursts on their own")
  .option("--news-lookback <seconds>", "how far back a headline still counts", (v) => Number(v))
  .option("--min-score <n>", "below this, novamp names no winner at all", (v) => Number(v))
  .option("--allow-red", "do not refuse a pick carrying RED risk")
  .option("--allow-farm", "do not refuse a pick from a cluster with a shared funder")
  .option("--top <n>", "how many swarms to report per pass", (v) => Number(v))
  .option(
    "--exec <path>",
    "hand the finding to your own program on stdin as JSON. novamp still signs nothing: see docs/EXEC.md",
  )
  .option("--exec-dry-run", "print the payload that would be sent instead of running anything")
  .option("--exec-timeout <ms>", "how long your program gets before it is killed", (v) => Number(v))
  .option("--json", "machine readable output")
  .action(async (opts) => {
    process.exitCode = await swarm(opts);
  });

program
  .command("index")
  .description("what the local index remembers, and how far back it goes")
  .option("--json", "machine readable output")
  .action(async (opts) => {
    process.exitCode = await indexStatus(opts);
  });

// --- watchlist ---------------------------------------------------------------

const watchlist = program
  .command("watchlist")
  .description("names to be told about when somebody copies them");

watchlist
  .command("list", { isDefault: true })
  .description("what you are watching")
  .action(async () => {
    process.exitCode = await watchlistList();
  });

watchlist
  .command("add")
  .argument("<name>", "a ticker or token name")
  .option("--note <text>", "why you are watching it")
  .description("start watching a name")
  .action(async (name: string, opts) => {
    process.exitCode = await watchlistAdd(name, opts.note);
  });

watchlist
  .command("remove")
  .argument("<name>", "a ticker or token name")
  .description("stop watching a name")
  .action(async (name: string) => {
    process.exitCode = await watchlistRemove(name);
  });

watchlist
  .command("run")
  .description("poll for copies of watched names and alert on what changed")
  .addOption(demoOption())
  .addOption(sinceOption())
  .option("--every <seconds>", "seconds between polls, minimum 30", (v) => Number(v))
  .option("--once", "check once and exit, for a cron line")
  .action(async (opts) => {
    process.exitCode = await watchlistRun(opts);
  });

// --- smart wallets -----------------------------------------------------------

const smart = program.command("smart").description("the proven-wallet registry");

smart
  .command("list", { isDefault: true })
  .description("show the registry and which wallets clear the bar")
  .option("--all", "include wallets that do not qualify")
  .action(async (opts) => {
    process.exitCode = await smartList(opts);
  });

smart
  .command("build")
  .description("rebuild the registry from the window (slow, needs a good RPC)")
  .addOption(demoOption())
  .addOption(sinceOption())
  .option("--min-entries <n>", "minimum early entries to be considered", (v) => Number(v), 4)
  .action(async (opts) => {
    process.exitCode = await smartBuild(opts);
  });

program.addHelpText(
  "after",
  `
${bold("start here")}
  novamp doctor                    ${dim("config, fixtures and index, no network")}
  novamp vamp NOVA --demo          ${dim("a real clone fight, from the bundled fixtures")}
  novamp vamp PEANUT --demo --all  ${dim("every member, in full")}
  novamp board --demo              ${dim("the same thing as a page on 127.0.0.1")}

${bold("against the chain")}
  novamp doctor --probe            ${dim("is this really Robinhood Chain")}
  novamp vamp PEANUT               ${dim("same command, live")}
  novamp swarm --watch             ${dim("catch the next name that bursts, and the headline behind it")}
  novamp wallet 0xYOURS --since 7d ${dim("how many of your positions are copies")}
  novamp farms --since 24h         ${dim("who shipped the most copies today")}
  novamp watchlist add PEANUT      ${dim("then `novamp watchlist run`")}

${bold("about --since")}
  No public RPC will sweep a month of a 100 ms chain, so novamp does not ask one to.
  Every run appends what it read to a local index under .novamp/, and the window is
  built from that. Day one gives you hours; a month of running gives you a month.
  ${dim("`novamp index` shows how far back yours actually goes.")}

${dim("novamp never signs anything. There is no key setting and no write path.")}
`,
);

program.parseAsync(process.argv).catch((err: unknown) => {
  if (err instanceof WindowParseError) {
    fail(err.message);
  } else {
    fail((err as Error).message ?? String(err));
  }
  process.exitCode = 1;
});
