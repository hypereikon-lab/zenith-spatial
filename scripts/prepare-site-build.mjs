import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const workerSource = resolve("dist/zenith_spatial/index.js");
const serverDirectory = resolve("dist/server");
const serverEntry = resolve(serverDirectory, "index.js");
const clientEntry = resolve("dist/client/index.html");

if (!existsSync(workerSource) || !existsSync(clientEntry)) {
  throw new Error("The Cloudflare Vite build did not produce the expected Worker and SPA entries.");
}

rmSync(serverDirectory, { recursive: true, force: true });
mkdirSync(serverDirectory, { recursive: true });
copyFileSync(workerSource, serverEntry);
