import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { prepareChatGptImageHandoff } from "./chatgpt-image-handoff.mjs";
import {
  loadChatGptImageCampaignDispatch,
  loadChatGptImageHandoff,
  startChatGptImageCampaignHandoffServer,
  startChatGptImageHandoffServer,
} from "./chatgpt-image-handoff-server.mjs";

const servers = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

describe("ChatGPT Images handoff asset server", () => {
  test("serves only the frozen prompt and indexed attachment bytes", async () => {
    const root = mkdtempSync(join(tmpdir(), "zenith-chatgpt-server-"));
    const plate = join(root, "plate.png");
    const reference = join(root, "reference.jpg");
    const output = join(root, "output.png");
    const requestPath = join(root, "request.json");
    writeFileSync(plate, "PLATE");
    writeFileSync(reference, "REFERENCE");
    const prepared = prepareChatGptImageHandoff({
      recipeId: "test",
      plateSketch: plate,
      references: [reference],
      prompt: "Exact prompt",
      output,
    });
    writeFileSync(requestPath, JSON.stringify(prepared));

    const request = loadChatGptImageHandoff(requestPath);
    const running = await startChatGptImageHandoffServer(request);
    servers.push(running.server);

    expect(await (await fetch(`${running.url}/prompt.txt`)).text()).toBe("Exact prompt");
    expect(await (await fetch(`${running.url}/attachments/1`)).text()).toBe("PLATE");
    expect(await (await fetch(`${running.url}/attachments/2`)).text()).toBe("REFERENCE");
    expect((await fetch(`${running.url}/attachments/3`)).status).toBe(404);
    expect((await fetch(`${running.url}/etc/passwd`)).status).toBe(404);
  });

  test("refuses an attachment changed after request preparation", () => {
    const root = mkdtempSync(join(tmpdir(), "zenith-chatgpt-server-drift-"));
    const plate = join(root, "plate.png");
    const reference = join(root, "reference.jpg");
    const requestPath = join(root, "request.json");
    writeFileSync(plate, "PLATE");
    writeFileSync(reference, "REFERENCE");
    writeFileSync(
      requestPath,
      JSON.stringify(
        prepareChatGptImageHandoff({
          recipeId: "test",
          plateSketch: plate,
          references: [reference],
          prompt: "Exact prompt",
          output: join(root, "output.png"),
        }),
      ),
    );
    writeFileSync(reference, "CHANGED");
    expect(() => loadChatGptImageHandoff(requestPath)).toThrow(/changed after preparation/);
  });

  test("serves a verified multi-state dispatch from one warm process", async () => {
    const root = mkdtempSync(join(tmpdir(), "zenith-chatgpt-campaign-server-"));
    const items = [];
    for (const stateId of ["E04", "E05"]) {
      const plate = join(root, `${stateId}-plate.png`);
      const reference = join(root, `${stateId}-reference.jpg`);
      const requestPath = join(root, `${stateId}-request.json`);
      writeFileSync(plate, `${stateId}-PLATE`);
      writeFileSync(reference, `${stateId}-REFERENCE`);
      const request = prepareChatGptImageHandoff({
        recipeId: stateId,
        plateSketch: plate,
        references: [reference],
        prompt: `${stateId} exact prompt`,
        output: join(root, `${stateId}-output.png`),
      });
      writeFileSync(requestPath, JSON.stringify(request));
      items.push({ stateId, requestDigest: request.requestDigest, requestPath });
    }
    const dispatchPath = join(root, "dispatch.json");
    writeFileSync(
      dispatchPath,
      JSON.stringify({
        schema: "zenith.chatgpt-campaign-dispatch.v1",
        campaignId: "campaign",
        attemptId: "attempt",
        items,
      }),
    );
    const dispatch = loadChatGptImageCampaignDispatch(dispatchPath);
    const running = await startChatGptImageCampaignHandoffServer(dispatch);
    servers.push(running.server);

    const index = await (await fetch(`${running.url}/campaign.json`)).json();
    expect(index.items.map(({ stateId }) => stateId)).toEqual(["E04", "E05"]);
    expect(await (await fetch(`${running.url}/states/E05/prompt.txt`)).text()).toBe("E05 exact prompt");
    expect(await (await fetch(`${running.url}/states/E04/attachments/1`)).text()).toBe("E04-PLATE");
    expect((await fetch(`${running.url}/states/E06/attachments/1`)).status).toBe(404);
  });
});
