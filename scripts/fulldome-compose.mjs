import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { normalizeFulldomeComposeJob } from "./lib/fulldome-headless-renderer.mjs";
import { startFulldomeComposeApi } from "./fulldome-compose-api.mjs";

const args = parseArgs(process.argv.slice(2));
const rawJob = JSON.parse(readFileSync(args.jobPath, "utf8"));
const job = normalizeFulldomeComposeJob(rawJob);
const output = requiredOutput(rawJob.output);

if (args.dryRun) {
  console.log(
    JSON.stringify(
      {
        mode: "dry-run",
        sources: job.sources,
        zenithSourceIndex: job.zenithSourceIndex,
        orientation: job.orientation,
        output,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

const api = await startFulldomeComposeApi();
try {
  const response = await fetch(`${api.url}/api/fulldome/compose`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(job),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `Fulldome API failed with HTTP ${response.status}.`);
  writeFileSync(output, Buffer.from(result.pngBase64, "base64"));
  const manifestPath = `${output}.manifest.json`;
  writeFileSync(manifestPath, `${JSON.stringify(result.manifest, null, 2)}\n`);
  console.log(
    JSON.stringify(
      {
        mode: "completed",
        output,
        manifest: manifestPath,
        raster: result.manifest.raster,
        sourceCount: result.manifest.sources.length,
        directReferenceCount: result.manifest.sources.reduce(
          (count, source) => count + source.directReferences.length,
          0,
        ),
      },
      null,
      2,
    ),
  );
} finally {
  await api.close();
}

function parseArgs(argv) {
  const jobIndex = argv.indexOf("--job");
  if (jobIndex < 0 || !argv[jobIndex + 1]) {
    throw new Error("Usage: node scripts/fulldome-compose.mjs --job /absolute/job.json [--dry-run]");
  }
  return { jobPath: resolve(argv[jobIndex + 1]), dryRun: argv.includes("--dry-run") };
}

function requiredOutput(value) {
  if (typeof value !== "string" || value.length === 0) throw new TypeError("output must be an absolute PNG path.");
  const output = resolve(value);
  if (!existsSync(dirname(output))) throw new Error(`Output directory does not exist: ${dirname(output)}`);
  return output;
}
