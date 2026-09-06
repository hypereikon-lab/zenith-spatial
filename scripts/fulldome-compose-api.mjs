import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { createServer as createViteServer } from "vite";

import { FulldomeHeadlessRenderer } from "./lib/fulldome-headless-renderer.mjs";

const DEFAULT_PORT = 4181;
const MAX_REQUEST_BYTES = 1_048_576;

export async function startFulldomeComposeApi({ port = 0 } = {}) {
  const vite = await createViteServer({
    appType: "mpa",
    server: { middlewareMode: true },
  });
  let renderer = null;
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url || "/", "http://127.0.0.1");
      if (request.method === "GET" && url.pathname === "/api/fulldome/health") {
        return json(response, 200, { ok: true, renderer: renderer ? "warm" : "cold" });
      }
      if (request.method === "POST" && url.pathname === "/api/fulldome/compose") {
        const body = JSON.parse(await readBody(request));
        if (!renderer) {
          const address = server.address();
          if (!address || typeof address === "string") throw new Error("Local API address is unavailable.");
          renderer = new FulldomeHeadlessRenderer({
            pageUrl: `http://localhost:${address.port}/fulldome-compose.html`,
          });
        }
        return json(response, 200, await renderer.render(body));
      }
      vite.middlewares(request, response, (error) => {
        if (error) json(response, 500, { error: error instanceof Error ? error.message : String(error) });
        else if (!response.writableEnded) json(response, 404, { error: "Not found" });
      });
    } catch (error) {
      json(response, 400, { error: error instanceof Error ? error.message : String(error) });
    }
  });

  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolvePromise());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Local API did not expose a TCP port.");

  return {
    url: `http://127.0.0.1:${address.port}`,
    async close() {
      await renderer?.close();
      await vite.close();
      await new Promise((resolvePromise, reject) =>
        server.close((error) => (error ? reject(error) : resolvePromise())),
      );
    },
  };
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_REQUEST_BYTES) throw new RangeError("Request body exceeds 1 MiB.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function json(response, status, value) {
  if (response.writableEnded) return;
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  response.end(body);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  const requestedPort = Number(process.env.ZENITH_FULLDOME_API_PORT || DEFAULT_PORT);
  const api = await startFulldomeComposeApi({ port: requestedPort });
  console.log(`Zenith fulldome API listening at ${api.url}/api/fulldome/compose`);
  const shutdown = async () => {
    await api.close();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
