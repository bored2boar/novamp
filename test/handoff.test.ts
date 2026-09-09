import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdtempSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handOff, verifyExecutor, HandoffError, type HandoffPayload } from "../src/exec/handoff.js";

const dir = mkdtempSync(join(tmpdir(), "novamp-handoff-"));

function script(name: string, body: string, executable = true): string {
  const path = join(dir, name);
  writeFileSync(path, body, "utf8");
  if (executable) chmodSync(path, 0o755);
  return path;
}

const PAYLOAD: HandoffPayload = {
  schema: "novamp.swarm.v1",
  at: "2026-09-05T14:12:00.000Z",
  swarm: { key: "peanut", label: "PEANUT", members: 6, deployers: 6, startedAt: 1_788_617_520, perMinute: 0.9 },
  news: {
    headline: "Peanut the Squirrel seized by officials",
    source: "t.me/wire",
    publishedAt: 1_788_615_180,
    leadSec: 2340,
  },
  pick: {
    token: "0xa0c54ffbe2ea6f151468fd40d4281d807fc2f6b5",
    symbol: "PEANUT",
    name: "Peanut the Squirrel",
    verdict: "ORIGINAL",
    score: 96,
    risk: "GREEN",
    rank: 1,
    clusterSize: 6,
    reasons: ["+14 first launch under this name"],
  },
  avoid: [],
};

test("a missing executor is caught before any watching starts", () => {
  assert.throws(() => verifyExecutor(join(dir, "nope.sh")), HandoffError);
});

test("a file without the executable bit is refused, with the fix in the message", () => {
  const path = script("noexec.sh", "#!/bin/sh\nexit 0\n", false);
  assert.throws(
    () => verifyExecutor(path),
    (err: Error) => err instanceof HandoffError && /chmod \+x/.test(err.message),
  );
});

test("a directory is not an executor", () => {
  assert.throws(() => verifyExecutor(dir), HandoffError);
});

test("the payload arrives on stdin as JSON", async () => {
  const path = script("echo.sh", "#!/bin/sh\ncat\n");
  const result = await handOff(path, PAYLOAD);
  assert.equal(result.ok, true);
  assert.equal(result.code, 0);
  const parsed = JSON.parse(result.stdout) as HandoffPayload;
  assert.equal(parsed.schema, "novamp.swarm.v1");
  assert.equal(parsed.pick.token, PAYLOAD.pick.token);
  assert.equal(parsed.news?.leadSec, 2340);
});

test("nothing is passed in argv, where a hostile token name would go looking", async () => {
  const path = script("args.sh", '#!/bin/sh\ncat >/dev/null\necho "argc=$#"\n');
  const result = await handOff(path, PAYLOAD);
  assert.equal(result.stdout, "argc=0");
});

test("a token name full of shell metacharacters is just a string", async () => {
  const path = script("safe.sh", "#!/bin/sh\ncat\n");
  const hostile: HandoffPayload = {
    ...PAYLOAD,
    pick: { ...PAYLOAD.pick, symbol: '"; rm -rf $HOME; echo "', name: "$(whoami)`id`" },
  };
  const result = await handOff(path, hostile);
  assert.equal(result.ok, true);
  const parsed = JSON.parse(result.stdout) as HandoffPayload;
  assert.equal(parsed.pick.symbol, '"; rm -rf $HOME; echo "');
  assert.equal(parsed.pick.name, "$(whoami)`id`");
});

test("a non-zero exit is a result, not an exception", async () => {
  const path = script("fail.sh", '#!/bin/sh\ncat >/dev/null\necho "not today" >&2\nexit 3\n');
  const result = await handOff(path, PAYLOAD);
  assert.equal(result.ok, false);
  assert.equal(result.code, 3);
  assert.equal(result.stderr, "not today");
});

test("an executor that hangs is killed, and the watcher carries on", async () => {
  const path = script("hang.sh", "#!/bin/sh\ncat >/dev/null\nsleep 30\n");
  const result = await handOff(path, PAYLOAD, 300);
  assert.equal(result.ok, false);
  assert.equal(result.signal, "SIGKILL");
  assert.match(result.error ?? "", /SIGKILL/);
});

test("an executor that never reads stdin does not wedge novamp", async () => {
  const path = script("ignore.sh", '#!/bin/sh\necho "done"\nexit 0\n');
  const result = await handOff(path, PAYLOAD, 3000);
  assert.equal(result.ok, true);
  assert.equal(result.stdout, "done");
});

test("output is captured but capped, so a chatty executor cannot fill memory", async () => {
  const path = script("loud.sh", "#!/bin/sh\ncat >/dev/null\nyes abcdefghij | head -20000\n");
  const result = await handOff(path, PAYLOAD, 5000);
  assert.ok(result.stdout.length <= 4000, `captured ${result.stdout.length} bytes`);
});
