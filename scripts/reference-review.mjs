import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { createReferenceReview } from "./lib/reference-review.mjs";

const args = process.argv.slice(2);
const input = flag(args, "--input");
const output = flag(args, "--output");
const raw = JSON.parse(readFileSync(resolve(input), "utf8"));
const entries = Array.isArray(raw) ? raw : raw.entries;
const receipt = createReferenceReview(entries, {
  policyId: raw.policyId,
  reviewer: raw.reviewer,
  createdAt: raw.createdAt,
});
writeFileSync(resolve(output), `${JSON.stringify(receipt, null, 2)}\n`);
console.log(`reference review: ${receipt.entries.length} images -> ${resolve(output)}`);

function flag(argv, name) {
  const index = argv.indexOf(name);
  if (index < 0 || !argv[index + 1]) throw new Error(`Missing ${name}.`);
  return argv[index + 1];
}
