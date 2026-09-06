import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  advanceImageCampaignLocal,
  claimImageCampaignDispatch,
  inspectImageCampaign,
  loadImageCampaign,
  reserveImageCampaignDispatch,
  supersedeImageCampaignDispatch,
} from "./lib/image-campaign-runner.mjs";

const args = parseArgs(process.argv.slice(2));
const campaign = loadImageCampaign(args.campaign);

if (args.command === "status") {
  print(inspectImageCampaign(campaign), args.json);
} else if (args.command === "advance-local") {
  print(await advanceImageCampaignLocal(campaign), args.json);
} else if (args.command === "dispatch") {
  const result = reserveImageCampaignDispatch(campaign, args.provider);
  if (args.output) {
    writeFileSync(args.output, `${JSON.stringify(result.dispatch, null, 2)}\n`);
    console.log(`${args.provider} dispatch: ${result.dispatch.items.length} states -> ${args.output}`);
  } else {
    print(result.dispatch, true);
  }
} else if (args.command === "claim") {
  const result = JSON.parse(readFileSync(args.result, "utf8"));
  print(claimImageCampaignDispatch(campaign, args.provider, result), true);
} else if (args.command === "supersede") {
  const result = JSON.parse(readFileSync(args.result, "utf8"));
  print(supersedeImageCampaignDispatch(campaign, args.provider, result), true);
} else {
  throw new Error(`Unknown command: ${args.command}`);
}

function parseArgs(argv) {
  const command = argv[0];
  const campaign = flag(argv, "--campaign", true);
  const provider = flag(argv, "--provider", command === "dispatch" || command === "claim" || command === "supersede");
  const result = flag(argv, "--result", command === "claim" || command === "supersede");
  const output = flag(argv, "--output", false);
  if (!command || !campaign) usage();
  return {
    command,
    campaign: resolve(campaign),
    provider,
    result: result ? resolve(result) : null,
    output: output ? resolve(output) : null,
    json: argv.includes("--json"),
  };
}

function flag(argv, name, required) {
  const index = argv.indexOf(name);
  if (index < 0 || !argv[index + 1]) {
    if (required) usage();
    return null;
  }
  return argv[index + 1];
}

function usage() {
  throw new Error(
    "Usage: image-campaign status|advance-local --campaign manifest.json [--json]\n" +
      "       image-campaign dispatch --campaign manifest.json --provider runway|chatgpt\n" +
      "       image-campaign claim --campaign manifest.json --provider runway|chatgpt --result result.json\n" +
      "       image-campaign supersede --campaign manifest.json --provider runway|chatgpt --result result.json",
  );
}

function print(value, json) {
  if (json) {
    console.log(JSON.stringify(value, null, 2));
    return;
  }
  const status = value.status || value;
  console.log(`${status.campaignId}: ${status.states.length} states`);
  for (const state of status.states) {
    console.log(`${state.id.padEnd(6)} ${state.phase}${state.error ? ` — ${state.error}` : ""}`);
  }
  console.log(`counts: ${JSON.stringify(status.counts)}`);
  if (value.actions) console.log(`local actions: ${value.actions.length}`);
  if (value.errors) {
    console.log(`isolated errors: ${value.errors.length}`);
    for (const error of value.errors) {
      console.log(`  ${error.stateId} [${error.stage}] ${error.error}`);
    }
  }
}
