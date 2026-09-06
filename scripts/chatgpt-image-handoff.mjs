import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { finalizeChatGptImageHandoff, prepareChatGptImageHandoff } from "./lib/chatgpt-image-handoff.mjs";

const args = parseArgs(process.argv.slice(2));
const raw = JSON.parse(readFileSync(args.jobPath, "utf8"));

if (args.stage === "prepare") {
  const output = outputPath(raw.requestReceipt, "requestReceipt");
  const request = prepareChatGptImageHandoff(raw);
  writeFileSync(output, `${JSON.stringify(request, null, 2)}\n`);
  console.log(
    JSON.stringify(
      {
        stage: "prepared",
        output,
        requestDigest: request.requestDigest,
        promptSha256: request.promptSha256,
        attachmentOrder: request.attachments.map(({ imageIndex, filename, role }) => ({ imageIndex, filename, role })),
      },
      null,
      2,
    ),
  );
} else {
  const requestPath = outputPath(raw.requestReceipt, "requestReceipt");
  if (!existsSync(requestPath)) throw new Error(`Prepared handoff receipt does not exist: ${requestPath}`);
  const prepared = JSON.parse(readFileSync(requestPath, "utf8"));
  const output = outputPath(raw.generationReceipt, "generationReceipt");
  const receipt = finalizeChatGptImageHandoff(raw, prepared);
  writeFileSync(output, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(
    JSON.stringify(
      {
        stage: "finalized",
        output,
        conversationUrl: receipt.conversationUrl,
        generatedImage: receipt.output.source,
        generatedSha256: receipt.output.sha256,
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
    throw new Error("Usage: node scripts/chatgpt-image-handoff.mjs --job /absolute/job.json --stage prepare|finalize");
  }
  return { jobPath: resolve(argv[jobIndex + 1]), stage };
}

function outputPath(value, label) {
  if (typeof value !== "string" || value.length === 0) throw new TypeError(`${label} must be a JSON path.`);
  const output = resolve(value);
  if (!existsSync(dirname(output))) throw new Error(`Output directory does not exist: ${dirname(output)}`);
  return output;
}
