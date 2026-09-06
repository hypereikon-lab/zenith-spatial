import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import {
  canonicalizePromptForUi,
  finalizeChatGptImageHandoff,
  prepareChatGptImageHandoff,
} from "./chatgpt-image-handoff.mjs";
import { createReferenceReview } from "./reference-review.mjs";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "zenith-chatgpt-handoff-"));
  const plateSketch = join(root, "00-plate-sketch.png");
  const referenceA = join(root, "01-a.png");
  const referenceB = join(root, "02-b.jpg");
  const promptFile = join(root, "prompt.txt");
  const output = join(root, "domemaster.png");
  writeFileSync(plateSketch, "PLATE");
  writeFileSync(referenceA, "REFERENCE-A");
  writeFileSync(referenceB, "REFERENCE-B");
  writeFileSync(promptFile, "Use @Image1 as the exact domemaster guide.\n");
  return {
    root,
    plateSketch,
    referenceA,
    referenceB,
    promptFile,
    output,
    job: {
      recipeId: "D13",
      plateSketch,
      references: [referenceA, referenceB],
      promptFile,
      output,
    },
  };
}

describe("ChatGPT Images in-app-browser handoff", () => {
  test("pins Image1, references, prompt, and the no-Chrome browser contract", () => {
    const { job } = fixture();
    const request = prepareChatGptImageHandoff(job, { createdAt: "2026-09-06T16:00:00.000Z" });

    expect(request).toMatchObject({
      schema: "zenith.chatgpt-image-handoff.v1",
      provider: "openai-chatgpt",
      productSurface: "chatgpt-images-2.5",
      invocation: "codex-in-app-browser",
      browserContract: {
        transport: "binary-clipboard",
        pasteOneAtATime: true,
        verifyCountAfterEveryPaste: true,
        promptVerification: "collapse-whitespace",
      },
    });
    expect(request.attachments.map(({ imageIndex, role, filename }) => [imageIndex, role, filename])).toEqual([
      [1, "plate_sketch", "00-plate-sketch.png"],
      [2, "reference", "01-a.png"],
      [3, "reference", "02-b.jpg"],
    ]);
  });

  test("uses a stable UI comparison when contenteditable rewrites paragraph breaks", () => {
    expect(canonicalizePromptForUi("Line one.\nLine two.")).toBe(canonicalizePromptForUi("Line one.\n\nLine two."));
  });

  test("deduplicates repeated reference bytes without moving Image1", () => {
    const { job, referenceA } = fixture();
    const request = prepareChatGptImageHandoff({ ...job, references: [referenceA, referenceA] });
    expect(request.attachments).toHaveLength(2);
    expect(request.attachments[0]).toMatchObject({ imageIndex: 1, role: "plate_sketch" });
  });

  test("can require a pixel-vision review before opening the browser handoff", () => {
    const { job } = fixture();
    expect(() => prepareChatGptImageHandoff({ ...job, requireReferenceReview: true })).toThrow(
      /referenceReviewReceipt is required/,
    );
  });

  test("can review only source references while retaining generated plate artifacts as attachments", () => {
    const { job, plateSketch, referenceA, root } = fixture();
    const upstream = join(root, "03-upstream.jpg");
    const reviewPath = join(root, "source-review.json");
    writeFileSync(upstream, "UPSTREAM");
    writeComposeManifest(plateSketch, referenceA, upstream);
    writeFileSync(reviewPath, `${JSON.stringify(createReferenceReview([{ path: upstream, decision: "approved" }]))}\n`);

    const request = prepareChatGptImageHandoff({
      ...job,
      references: [],
      requireReferenceReview: true,
      referenceReviewScope: "source-references",
      referenceReviewReceipt: reviewPath,
    });

    expect(request.attachments.map(({ role }) => role)).toEqual([
      "plate_sketch",
      "plate_source",
      "plate_direct_reference",
    ]);
    expect(request.referenceReview).toMatchObject({
      scope: "source-references",
      reviewedImageCount: 1,
    });
  });

  test("automatically expands plate sources and their direct provenance from the compose manifest", () => {
    const { job, plateSketch, referenceA, referenceB, root } = fixture();
    const upstream = join(root, "03-upstream.jpg");
    writeFileSync(upstream, "UPSTREAM");
    writeFileSync(
      `${plateSketch}.manifest.json`,
      JSON.stringify({
        schema: "zenith.fulldome-compose.v1",
        output: { sha256: digest(plateSketch) },
        sources: [
          {
            index: 0,
            slot: "upper-dominant",
            source: referenceA,
            sha256: digest(referenceA),
            directReferences: [{ filename: "03-upstream.jpg", source: upstream, sha256: digest(upstream) }],
          },
          {
            index: 1,
            slot: "front-center",
            source: referenceB,
            sha256: digest(referenceB),
            directReferences: [{ filename: "03-upstream.jpg", source: upstream, sha256: digest(upstream) }],
          },
        ],
      }),
    );

    const request = prepareChatGptImageHandoff({ ...job, references: [] });
    expect(request.attachments.map(({ imageIndex, role, filename }) => [imageIndex, role, filename])).toEqual([
      [1, "plate_sketch", "00-plate-sketch.png"],
      [2, "plate_source", "01-a.png"],
      [3, "plate_source", "02-b.jpg"],
      [4, "plate_direct_reference", "03-upstream.jpg"],
    ]);
    expect(request.attachments[3]).toMatchObject({ plateSourceIndices: [0, 1] });
    expect(request.provenance).toMatchObject({
      mode: "plate-manifest-direct",
      ancestryDepth: 1,
      plateSourceCount: 2,
      directReferenceCount: 1,
    });
  });

  test("supports older manifests by resolving plate sources from manual references", () => {
    const { job, plateSketch, referenceA } = fixture();
    writeFileSync(
      `${plateSketch}.manifest.json`,
      JSON.stringify({
        schema: "zenith.fulldome-compose.v2",
        output: { sha256: digest(plateSketch) },
        sources: [
          {
            index: 0,
            slot: "upper-dominant",
            sha256: digest(referenceA),
            directReferences: [],
          },
        ],
      }),
    );

    const request = prepareChatGptImageHandoff({ ...job, references: [referenceA] });
    expect(request.attachments).toHaveLength(2);
    expect(request.attachments[1]).toMatchObject({ role: "plate_source", filename: "01-a.png" });
  });

  test("treats a source without direct provenance as a leaf rather than inventing ancestors", () => {
    const { job, plateSketch, referenceA } = fixture();
    writeFileSync(
      `${plateSketch}.manifest.json`,
      JSON.stringify({
        schema: "zenith.fulldome-compose.v2",
        output: { sha256: digest(plateSketch) },
        sources: [{ index: 0, source: referenceA, sha256: digest(referenceA), directReferences: [] }],
      }),
    );

    const request = prepareChatGptImageHandoff({ ...job, references: [] });
    expect(request.attachments.map(({ role }) => role)).toEqual(["plate_sketch", "plate_source"]);
    expect(request.provenance.directReferenceCount).toBe(0);
  });

  test("rejects a compose manifest that no longer matches the Plate Sketch", () => {
    const { job, plateSketch, referenceA } = fixture();
    writeFileSync(
      `${plateSketch}.manifest.json`,
      JSON.stringify({
        schema: "zenith.fulldome-compose.v2",
        output: { sha256: "0".repeat(64) },
        sources: [{ index: 0, source: referenceA, sha256: digest(referenceA), directReferences: [] }],
      }),
    );
    expect(() => prepareChatGptImageHandoff({ ...job, references: [] })).toThrow(
      /does not match the compose manifest output/,
    );
  });

  test("hybrid conditioning combines exact plate ancestry with a reproducible Atlas state", () => {
    const { job, plateSketch, referenceA, referenceB, root } = fixture();
    const upstream = join(root, "03-upstream.jpg");
    const related = join(root, "04-related.jpg");
    const receipt = join(root, "scene-context.json");
    writeFileSync(upstream, "UPSTREAM");
    writeFileSync(related, "RELATED");
    writeComposeManifest(plateSketch, referenceA, upstream);
    writeFileSync(
      receipt,
      JSON.stringify({
        schemaVersion: "inside-valdivia.scene-context-selection@1",
        states: [
          {
            index: 0,
            progress: 0.5,
            interpolationProgress: 0.5,
            seed: "context-seed\\0state:0",
            sceneMix: [
              { sceneId: "I.4", weight: 0.5, referenceCount: 1 },
              { sceneId: "I.5", weight: 0.5, referenceCount: 1 },
            ],
            references: [
              {
                path: related,
                sha256: digest(related),
                assignedSceneId: "I.5",
                assetId: "atlas-related",
                retainedFromPreviousState: false,
              },
            ],
          },
        ],
      }),
    );

    const request = prepareChatGptImageHandoff({
      ...job,
      references: [referenceB],
      contextPolicy: { mode: "hybrid", sceneContextReceipt: receipt, stateIndex: 0 },
    });
    expect(request.attachments.map(({ role, filename }) => [role, filename])).toEqual([
      ["plate_sketch", "00-plate-sketch.png"],
      ["plate_source", "01-a.png"],
      ["plate_direct_reference", "03-upstream.jpg"],
      ["scene_context_reference", "04-related.jpg"],
      ["supplemental_reference", "02-b.jpg"],
    ]);
    expect(request.conditioning).toMatchObject({
      mode: "hybrid",
      availablePlateDirectReferenceCount: 1,
      attachedPlateDirectReferenceCount: 1,
      sceneContextReferenceCount: 1,
      sceneContextState: { index: 0, progress: 0.5 },
    });
  });

  test("related conditioning keeps plate ancestry in provenance but does not send it to the model", () => {
    const { job, plateSketch, referenceA, root } = fixture();
    const upstream = join(root, "03-upstream.jpg");
    const related = join(root, "04-drive-related.jpg");
    writeFileSync(upstream, "UPSTREAM");
    writeFileSync(related, "RELATED");
    writeComposeManifest(plateSketch, referenceA, upstream);

    const request = prepareChatGptImageHandoff({
      ...job,
      references: [],
      contextPolicy: {
        mode: "related",
        additionalReferences: [{ path: related, sourceKind: "google-drive", sceneIds: ["I.4"] }],
      },
    });
    expect(request.attachments.map(({ role }) => role)).toEqual([
      "plate_sketch",
      "plate_source",
      "scene_context_reference",
    ]);
    expect(request.provenance.directReferenceCount).toBe(1);
    expect(request.conditioning).toMatchObject({
      mode: "related",
      availablePlateDirectReferenceCount: 1,
      attachedPlateDirectReferenceCount: 0,
      sceneContextReferenceCount: 1,
    });
    expect(request.attachments[2]).toMatchObject({ sourceKind: "google-drive", sceneIds: ["I.4"] });
  });

  test("finalizes only the unchanged prepared request and a ChatGPT conversation URL", () => {
    const { job, output } = fixture();
    const request = prepareChatGptImageHandoff(job, { createdAt: "2026-09-06T16:00:00.000Z" });
    writeFileSync(output, "GENERATED");
    const receipt = finalizeChatGptImageHandoff(
      { ...job, conversationUrl: "https://chatgpt.com/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" },
      request,
    );
    expect(receipt).toMatchObject({
      schema: "zenith.chatgpt-image-generation.v2",
      invocation: "codex-in-app-browser",
      requestDigest: request.requestDigest,
    });
    expect(receipt.output.sha256).toHaveLength(64);
    expect(readFileSync(output, "utf8")).toBe("GENERATED");
  });

  test("rejects prompt or attachment drift after preparation", () => {
    const { job } = fixture();
    const request = prepareChatGptImageHandoff(job);
    writeFileSync(job.output, "GENERATED");
    expect(() =>
      finalizeChatGptImageHandoff(
        {
          ...job,
          prompt: "A different prompt",
          promptFile: undefined,
          conversationUrl: "https://chatgpt.com/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        },
        request,
      ),
    ).toThrow(/differs from its prepared handoff/);
  });
});

function digest(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function writeComposeManifest(plateSketch, source, directReference) {
  writeFileSync(
    `${plateSketch}.manifest.json`,
    JSON.stringify({
      schema: "zenith.fulldome-compose.v2",
      output: { sha256: digest(plateSketch) },
      sources: [
        {
          index: 0,
          slot: "upper-dominant",
          source,
          sha256: digest(source),
          directReferences: [
            {
              filename: directReference.split("/").at(-1),
              source: directReference,
              sha256: digest(directReference),
            },
          ],
        },
      ],
    }),
  );
}
