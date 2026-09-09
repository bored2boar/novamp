/**
 * The line novamp does not cross, and the door it leaves in it.
 *
 * novamp decides. It does not execute, it holds no key, and it has no code that
 * could sign anything - CI fails the build if a signing primitive appears
 * anywhere in `src/`. That is not a limitation that got left in, it is the
 * property the whole tool is built to have, because a resolver you can trust to
 * tell you which token is real and a program with your private key in it are two
 * things that should not live in one process.
 *
 * But a decision nobody can act on is a decision nobody uses. So novamp hands
 * off: when the swarm ranking clears its bar, it runs a program you wrote, and
 * gives it the finding on stdin as JSON. What that program does is yours. It is
 * your file, on your disk, holding your key, outside this repository and outside
 * this repository's guarantees.
 *
 * The boundary is what makes both halves honest. novamp can be read, audited and
 * cloned by somebody who will never trust it with money. Your executor can be
 * ten lines long, because everything hard already happened before it ran.
 *
 * How the hand-off is built, and why each part is the way it is:
 *
 *   - the payload goes on **stdin**, never in argv. Token names are attacker
 *     controlled: a launch can be called whatever its deployer likes, and argv
 *     is exactly where a hostile string goes looking for a shell
 *   - **no shell**. `spawn` with `shell: false`, so there is no interpreter
 *     between novamp and the file you named. `; rm -rf ~` in a token name is a
 *     token name
 *   - the executable must **already exist and be executable**. novamp will not
 *     create it, chmod it, or fall back to a shell when it is not
 *   - one process per finding, with a **timeout** and a kill after it
 *   - novamp reads the exit code and prints it. It does not retry. A retry loop
 *     around something that spends money is how one bad minute becomes four
 *
 * If you have not written an executor, do not pass `--exec`. Every other part of
 * `novamp swarm` works without it, which is the arrangement to prefer: read the
 * alert, decide yourself, and keep the machine out of the part where the money
 * moves. See docs/EXEC.md before you wire anything up.
 */

import { spawn } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Exactly what an executor receives, and the only thing it receives.
 *
 * Versioned, because this is a contract with a program novamp cannot see. A
 * change to the shape bumps `schema`, so an old executor can refuse a payload it
 * does not understand rather than misreading a field.
 */
export interface HandoffPayload {
  schema: "novamp.swarm.v1";
  /** ISO 8601, when novamp made the call. */
  at: string;
  swarm: {
    key: string;
    label: string;
    members: number;
    deployers: number;
    startedAt: number;
    perMinute: number;
  };
  news: {
    headline: string;
    source: string;
    publishedAt: number;
    /** Seconds from the headline to the first launch. */
    leadSec: number;
  } | null;
  pick: {
    token: string;
    symbol: string;
    name: string;
    verdict: string;
    score: number;
    risk: string;
    rank: number;
    clusterSize: number;
    reasons: string[];
  };
  avoid: { token: string; symbol: string; verdict: string; score: number }[];
}

export interface HandoffResult {
  ok: boolean;
  /** Exit code, or null when the process was killed. */
  code: number | null;
  signal: NodeJS.Signals | null;
  /** Whatever the executor printed, trimmed and capped. */
  stdout: string;
  stderr: string;
  error?: string;
  ms: number;
}

export class HandoffError extends Error {}

/**
 * Check the executor before a swarm is ever detected.
 *
 * Called at startup rather than at fire time on purpose. Finding out that the
 * path is wrong at three in the morning, in the two minutes that a burst is
 * live, is the worst possible moment to find out.
 */
export function verifyExecutor(path: string): string {
  const full = resolve(path);
  let stat;
  try {
    stat = statSync(full);
  } catch {
    throw new HandoffError(`executor not found: ${full}`);
  }
  if (!stat.isFile()) {
    throw new HandoffError(`executor is not a file: ${full}`);
  }
  try {
    accessSync(full, constants.X_OK);
  } catch {
    throw new HandoffError(
      `executor is not executable: ${full}\n  fix it with: chmod +x ${full}`,
    );
  }
  return full;
}

const MAX_CAPTURE = 4000;

/**
 * Run the executor once, with the payload on stdin.
 *
 * Never throws for anything the executor did. A non-zero exit, a crash and a
 * timeout are all results, reported and returned, because the watcher that
 * called this has a burst to keep reading and a bad executor is not a reason to
 * stop watching the chain.
 */
export async function handOff(
  executable: string,
  payload: HandoffPayload,
  timeoutMs = 20_000,
): Promise<HandoffResult> {
  const started = Date.now();

  return new Promise<HandoffResult>((resolvePromise) => {
    let child;
    try {
      child = spawn(executable, [], {
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
        // The executor inherits the environment it was started in and nothing
        // is added to it here. novamp has no secret to pass down and does not
        // invent an interface for one.
        env: process.env,
      });
    } catch (err) {
      resolvePromise({
        ok: false,
        code: null,
        signal: null,
        stdout: "",
        stderr: "",
        error: (err as Error).message,
        ms: Date.now() - started,
      });
      return;
    }

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, timeoutMs);

    const finish = (result: Omit<HandoffResult, "ms">) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise({ ...result, ms: Date.now() - started });
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      if (stdout.length < MAX_CAPTURE) stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length < MAX_CAPTURE) stderr += chunk.toString();
    });

    child.on("error", (err) => {
      finish({ ok: false, code: null, signal: null, stdout, stderr, error: err.message });
    });

    child.on("close", (code, signal) => {
      finish({
        ok: code === 0,
        code,
        signal,
        stdout: stdout.slice(0, MAX_CAPTURE).trim(),
        stderr: stderr.slice(0, MAX_CAPTURE).trim(),
        ...(signal ? { error: `killed with ${signal}` } : {}),
      });
    });

    child.stdin?.on("error", () => {
      /* An executor that closes stdin without reading is its own business. */
    });
    child.stdin?.end(JSON.stringify(payload, null, 2) + "\n");
  });
}
