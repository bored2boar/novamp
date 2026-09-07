/**
 * The local board.
 *
 * A terminal is the wrong shape for fourteen near-identical tickers stacked on
 * top of each other: the whole point is comparing rows at a glance, and a
 * proportional font with real column rules does that better than any amount of
 * ANSI. So the same engine gets a page.
 *
 * Local only, and that is not a limitation to be lifted later:
 *
 *   - binds 127.0.0.1, never 0.0.0.0
 *   - serves one HTML file and one JSON endpoint, both read only
 *   - no session, no account, nothing stored server side
 *
 * If this ever becomes a hosted dashboard, the repository stops being the whole
 * tool, and that is the line in the README.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Cluster } from "../types.js";

export interface BoardData {
  source: { kind: "live" | "demo"; describe: string };
  window: string;
  generatedAt: string;
  clusters: Cluster[];
  stats: {
    launches: number;
    names: number;
    copies: number;
    vampRatio: number;
    medianVampLagSec: number | null;
  };
}

export type BoardLoader = () => Promise<BoardData>;

function pageFile(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const candidate of [
    resolve(here, "index.html"),
    resolve(here, "../../src/board/index.html"),
    resolve(process.cwd(), "src/board/index.html"),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error("board page not found; run from the repository root");
}

export interface BoardServer {
  port: number;
  url: string;
  close(): Promise<void>;
}

export async function startBoard(load: BoardLoader, port: number): Promise<BoardServer> {
  const html = await readFile(pageFile(), "utf8");

  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");

    if (url.pathname === "/api/board") {
      try {
        const data = await load();
        const body = JSON.stringify(data, (_key, value) =>
          typeof value === "bigint" ? value.toString() : value,
        );
        res.writeHead(200, {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
        });
        res.end(body);
      } catch (err) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: (err as Error).message }));
      }
      return;
    }

    if (url.pathname === "/" || url.pathname === "/index.html") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }

    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  };

  const server = createServer((req, res) => {
    void handler(req, res);
  });

  await new Promise<void>((ok, fail) => {
    server.once("error", fail);
    // 127.0.0.1 explicitly. Binding 0.0.0.0 would put a read of somebody's
    // wallet activity on their coffee shop's wifi.
    server.listen(port, "127.0.0.1", ok);
  });

  const actual = (server.address() as { port: number }).port;
  return {
    port: actual,
    url: `http://127.0.0.1:${actual}`,
    close: () => new Promise<void>((ok) => server.close(() => ok())),
  };
}
