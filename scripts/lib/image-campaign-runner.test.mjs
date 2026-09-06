import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import {
  advanceImageCampaignLocal,
  claimImageCampaignDispatch,
  inspectImageCampaign,
  loadImageCampaign,
  reserveImageCampaignDispatch,
  supersedeImageCampaignDispatch,
} from "./image-campaign-runner.mjs";

describe("durable image campaign runner", () => {
  test("prepares, reserves, and claims a Runway batch without duplicate dispatch", async () => {
    const fixture = campaignFixture();
    const campaign = loadImageCampaign(fixture.manifest);
    const first = await advanceImageCampaignLocal(campaign, { now: clock() });
    expect(first.actions).toEqual([{ stateId: "E01", action: "prepared-runway" }]);
    expect(first.status.states[0].phase).toBe("runway-ready");

    const reserved = reserveImageCampaignDispatch(campaign, "runway", { now: clock() });
    expect(reserved.dispatch.items).toHaveLength(1);
    expect(() => reserveImageCampaignDispatch(campaign, "runway", { now: clock() })).toThrow(/Unresolved/);

    const item = reserved.dispatch.items[0];
    const result = {
      attemptId: reserved.attempt.id,
      items: [
        {
          stateId: item.stateId,
          requestDigest: item.requestDigest,
          providerTaskIds: ["task-1", "task-2"],
        },
      ],
    };
    expect(claimImageCampaignDispatch(campaign, "runway", result, { now: clock() }).idempotent).toBe(false);
    expect(claimImageCampaignDispatch(campaign, "runway", result, { now: clock() }).idempotent).toBe(true);
    expect(inspectImageCampaign(campaign).states[0].phase).toBe("runway-submitted");
    expect(JSON.parse(readFileSync(fixture.runwayJob, "utf8")).providerTaskIds).toEqual(["task-1", "task-2"]);
  });

  test("blocks ambiguous provider outputs instead of guessing whether a paid call happened", async () => {
    const fixture = campaignFixture();
    writeFileSync(fixture.output1, "ambiguous");
    const campaign = loadImageCampaign(fixture.manifest);
    await advanceImageCampaignLocal(campaign, { now: clock() });
    const status = inspectImageCampaign(campaign);
    expect(status.states[0].phase).toBe("blocked");
    expect(status.states[0].error).toMatch(/outputs exist without claimed task ids/);
  });

  test("refreshes a drifted request only while no paid submission or output exists", async () => {
    const fixture = campaignFixture();
    const campaign = loadImageCampaign(fixture.manifest);
    await advanceImageCampaignLocal(campaign, { now: clock() });
    const job = JSON.parse(readFileSync(fixture.runwayJob, "utf8"));
    job.prompt = "A newly corrected prompt";
    writeFileSync(fixture.runwayJob, JSON.stringify(job));

    const advanced = await advanceImageCampaignLocal(campaign, { now: clock() });
    expect(advanced.actions).toContainEqual({ stateId: "E01", action: "refreshed-unsubmitted-runway" });
    expect(inspectImageCampaign(campaign).states[0].phase).toBe("runway-ready");
  });

  test("records a quarantined partial provider result before allowing a replacement dispatch", async () => {
    const fixture = campaignFixture();
    const campaign = loadImageCampaign(fixture.manifest);
    await advanceImageCampaignLocal(campaign, { now: clock() });
    const reserved = reserveImageCampaignDispatch(campaign, "runway", { now: clock() });
    const item = reserved.dispatch.items[0];
    const result = {
      attemptId: reserved.attempt.id,
      reason: "Reference policy changed after one remote task was accepted.",
      items: [
        {
          stateId: item.stateId,
          requestDigest: item.requestDigest,
          outcome: "submitted-quarantined",
          providerTaskIds: ["unsafe-task-1"],
          providerStatus: "THROTTLED",
        },
      ],
    };
    expect(supersedeImageCampaignDispatch(campaign, "runway", result, { now: clock() }).idempotent).toBe(false);
    expect(supersedeImageCampaignDispatch(campaign, "runway", result, { now: clock() }).idempotent).toBe(true);
    expect(reserveImageCampaignDispatch(campaign, "runway", { now: clock() }).dispatch.items).toHaveLength(1);
    expect(JSON.parse(readFileSync(fixture.runwayJob, "utf8")).providerTaskIds).toEqual([]);
  });

  test("isolates a blocked state while continuing valid local campaign work", async () => {
    const fixture = campaignFixture();
    const blockedJob = JSON.parse(readFileSync(fixture.runwayJob, "utf8"));
    blockedJob.requireReferenceReview = true;
    writeFileSync(fixture.runwayJob, JSON.stringify(blockedJob));

    const secondRunwayJob = join(fixture.root, "runway-job-E02.json");
    const secondComposeJob = join(fixture.root, "compose-job-E02.json");
    const secondChatgptJob = join(fixture.root, "chatgpt-job-E02.json");
    writeFileSync(
      secondRunwayJob,
      JSON.stringify({
        ...blockedJob,
        recipeId: "E02",
        requireReferenceReview: false,
        outputs: [{ path: join(fixture.root, "runway-E02-01.png") }, { path: join(fixture.root, "runway-E02-02.png") }],
        requestReceipt: join(fixture.root, "runway-request-E02.json"),
        generationReceipt: join(fixture.root, "runway-generation-E02.json"),
      }),
    );
    writeFileSync(
      secondComposeJob,
      JSON.stringify({
        sources: [{ path: join(fixture.root, "runway-E02-01.png") }, { path: join(fixture.root, "runway-E02-02.png") }],
        dominantSourceIndex: 0,
        orientation: "profile",
        output: join(fixture.root, "plate-E02.png"),
      }),
    );
    writeFileSync(
      secondChatgptJob,
      JSON.stringify({
        recipeId: "E02",
        plateSketch: join(fixture.root, "plate-E02.png"),
        references: [join(fixture.root, "reference.jpg")],
        prompt: "Complete the domemaster",
        output: join(fixture.root, "domemaster-E02.png"),
      }),
    );
    const manifest = JSON.parse(readFileSync(fixture.manifest, "utf8"));
    manifest.states.push({
      id: "E02",
      runwayJob: secondRunwayJob,
      composeJob: secondComposeJob,
      chatgptJob: secondChatgptJob,
    });
    writeFileSync(fixture.manifest, JSON.stringify(manifest));

    const advanced = await advanceImageCampaignLocal(loadImageCampaign(fixture.manifest), { now: clock() });
    expect(advanced.errors).toContainEqual({
      stateId: "E01",
      stage: "runway",
      error: "referenceReviewReceipt is required by this Runway job.",
    });
    expect(advanced.actions).toContainEqual({ stateId: "E02", action: "prepared-runway" });
    expect(advanced.status.states.map(({ id, phase }) => [id, phase])).toEqual([
      ["E01", "blocked"],
      ["E02", "runway-ready"],
    ]);
  });
});

function campaignFixture() {
  const root = mkdtempSync(join(tmpdir(), "zenith-image-campaign-"));
  const runwayJob = join(root, "runway-job.json");
  const composeJob = join(root, "compose-job.json");
  const chatgptJob = join(root, "chatgpt-job.json");
  const manifest = join(root, "campaign.json");
  const reference = join(root, "reference.jpg");
  const output1 = join(root, "runway-01.png");
  const output2 = join(root, "runway-02.png");
  const plate = join(root, "plate.png");
  writeFileSync(reference, "REFERENCE");
  writeFileSync(
    runwayJob,
    JSON.stringify({
      recipeId: "E01",
      invocation: "runway-mcp",
      prompt: "One continuous place",
      references: [{ path: reference }],
      outputs: [{ path: output1 }, { path: output2 }],
      providerTaskIds: [],
      requestReceipt: join(root, "runway-request.json"),
      generationReceipt: join(root, "runway-generation.json"),
    }),
  );
  writeFileSync(
    composeJob,
    JSON.stringify({
      sources: [{ path: output1 }, { path: output2 }],
      dominantSourceIndex: 0,
      orientation: "profile",
      output: plate,
    }),
  );
  writeFileSync(
    chatgptJob,
    JSON.stringify({
      recipeId: "E01",
      plateSketch: plate,
      references: [reference],
      prompt: "Complete the domemaster",
      output: join(root, "domemaster.png"),
      requestReceipt: join(root, "chatgpt-request.json"),
      generationReceipt: join(root, "chatgpt-generation.json"),
    }),
  );
  writeFileSync(
    manifest,
    JSON.stringify({
      schema: "zenith.image-campaign.v1",
      campaignId: "test-campaign",
      ledger: "./ledger.json",
      states: [{ id: "E01", runwayJob, composeJob, chatgptJob }],
    }),
  );
  return { root, manifest, runwayJob, output1, output2 };
}

function clock() {
  let tick = 0;
  return () => `2026-09-06T00:00:${String(tick++).padStart(2, "0")}.000Z`;
}
