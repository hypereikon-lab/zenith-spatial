import { resolve } from "node:path";

import {
  loadChatGptImageCampaignDispatch,
  loadChatGptImageHandoff,
  startChatGptImageCampaignHandoffServer,
  startChatGptImageHandoffServer,
} from "./lib/chatgpt-image-handoff-server.mjs";

const args = parseArgs(process.argv.slice(2));
const request = args.requestPath ? loadChatGptImageHandoff(args.requestPath) : null;
const campaign = args.campaignDispatchPath ? loadChatGptImageCampaignDispatch(args.campaignDispatchPath) : null;
const { url } = campaign
  ? await startChatGptImageCampaignHandoffServer(campaign, { port: args.port })
  : await startChatGptImageHandoffServer(request, { port: args.port });

console.log(
  JSON.stringify(
    {
      stage: "serving",
      url,
      ...(campaign
        ? { campaignId: campaign.campaignId, attemptId: campaign.attemptId, stateCount: campaign.items.length }
        : { requestDigest: request.requestDigest, attachmentCount: request.attachments.length }),
    },
    null,
    2,
  ),
);

function parseArgs(argv) {
  const requestIndex = argv.indexOf("--request");
  const campaignIndex = argv.indexOf("--campaign-dispatch");
  const portIndex = argv.indexOf("--port");
  const hasRequest = requestIndex >= 0 && Boolean(argv[requestIndex + 1]);
  const hasCampaign = campaignIndex >= 0 && Boolean(argv[campaignIndex + 1]);
  if (hasRequest === hasCampaign) {
    throw new Error(
      "Usage: node scripts/chatgpt-image-handoff-server.mjs (--request request.json | --campaign-dispatch dispatch.json) [--port 4321]",
    );
  }
  const port = portIndex < 0 ? 0 : Number(argv[portIndex + 1]);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new RangeError("--port must be 0…65535.");
  return {
    requestPath: hasRequest ? resolve(argv[requestIndex + 1]) : null,
    campaignDispatchPath: hasCampaign ? resolve(argv[campaignIndex + 1]) : null,
    port,
  };
}
