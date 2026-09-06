import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { finalizeRunwayImageReceipt, prepareRunwayImageRequest } from "./lib/runway-image-receipt.mjs";

const args = parseArgs(process.argv.slice(2));
const raw = JSON.parse(readFileSync(args.jobPath, "utf8"));

if (args.stage === "prepare") {
  const output = outputPath(raw.requestReceipt, "requestReceipt");
  const request = prepareRunwayImageRequest(raw);
  writeFileSync(output, `${JSON.stringify(request, null, 2)}\n`);
  console.log(JSON.stringify({ stage: "prepared", output, requestDigest: request.requestDigest }, null, 2));
} else {
  const requestPath = outputPath(raw.requestReceipt, "requestReceipt");
  if (!existsSync(requestPath)) throw new Error(`Prepared request receipt does not exist: ${requestPath}`);
  const prepared = JSON.parse(readFileSync(requestPath, "utf8"));
  const output = outputPath(raw.generationReceipt, "generationReceipt");
  const receipt = finalizeRunwayImageReceipt(raw, prepared);
  writeFileSync(output, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(
    JSON.stringify(
      {
        stage: "finalized",
        output,
        taskCount: receipt.providerTaskIds.length,
        imageCount: receipt.outputs.length,
        creditsUsed: receipt.creditsUsed ?? null,
      },
      null,
      2,
    ),
  );
}

function parseArgs(argv) {
  const jobIndex = argv.indexOf("--job");
  const stageIndex = argv.indexOf("--stage");
  const stage = argv[stageIndex + 1];
  if (jobIndex < 0 || !argv[jobIndex + 1] || (stage !== "prepare" && stage !== "finalize")) {
    throw new Error("Usage: node scripts/runway-image-receipt.mjs --job /absolute/job.json --stage prepare|finalize");
  }
  return { jobPath: resolve(argv[jobIndex + 1]), stage };
}

function outputPath(value, label) {
  if (typeof value !== "string" || value.length === 0) throw new TypeError(`${label} must be an absolute JSON path.`);
  const output = resolve(value);
  if (!existsSync(dirname(output))) throw new Error(`Output directory does not exist: ${dirname(output)}`);
  return output;
}
