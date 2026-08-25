<script lang="ts">
  import {
    downloadSelectedFinishedImage,
    importPlateSketchFile,
    importSourceFile,
  } from "../../app/workbench-media-commands.js";
  import {
    getArtifact,
    recordWorkbenchError,
    updateRepairDirection,
    updateRepairMode,
    workbench,
  } from "../../artifacts/artifact-store.svelte.js";
  import type { ArtifactMedia, ArtifactSlotId } from "../../artifacts/artifact-types.js";
  import DomeSceneWorkbench from "../DomeSceneWorkbench.svelte";
  import {
    ActionButton,
    FileImportControl,
    SegmentedControl,
    TextAreaField,
    WorkstationPanel,
  } from "../primitives/index.js";
  import SourceMapMediaViewer from "../SourceMapMediaViewer.svelte";
  import PrimaryOperatorAction from "./PrimaryOperatorAction.svelte";
  import ArtifactStatusGrid from "./ArtifactStatusGrid.svelte";
  import { selectedCompositionState } from "../../app/workbench-sequence-commands.js";
  import {
    plateSketchRevisionForComposition,
    selectedImageRevisionForComposition,
  } from "../../sequence/composition-sequence.js";
  import {
    compileRepairPromptForProjectionSnapshot,
    type PlateIntegrationMode,
  } from "../../inpaint/inpaint-prompts.js";

  type InpaintReviewSourceId = "plate-sketch" | "generated-result";

  const inpaintArtifacts: ArtifactSlotId[] = ["plate-sketch", "finished-image"];
  const inpaintRoles: Partial<Record<ArtifactSlotId, string>> = {
    "plate-sketch": "Plate Sketch",
    "finished-image": "Generated Result",
  };
  const repairModeOptions = [
    {
      value: "integrated",
      label: "Integrated",
      description: "Preserve content and placement while repainting through plate boundaries for one continuous image.",
    },
    {
      value: "strict",
      label: "Strict pixels",
      description: "Archive-style copy-through that keeps the original plate pixels and silhouettes unchanged.",
    },
  ];
  const initialImageRevision = selectedImageRevisionForComposition(
    workbench.project.sequence,
    selectedCompositionState(),
  );
  let reviewSourceId = $state<InpaintReviewSourceId>(initialImageRevision ? "generated-result" : "plate-sketch");
  let observedImageRevisionId = $state<string | null>(initialImageRevision?.id || null);
  let downloadStatus = $state("");
  let plateSketch = $derived(getArtifact("plate-sketch"));
  let finishedImageArtifact = $derived(getArtifact("finished-image"));
  let composition = $derived(selectedCompositionState());
  let plateRevision = $derived(plateSketchRevisionForComposition(workbench.project.sequence, composition));
  let imageRevision = $derived(selectedImageRevisionForComposition(workbench.project.sequence, composition));
  let preparedRepairPrompt = $derived.by(() => {
    const snapshot = plateRevision?.plateComposition || composition?.plateDraft;
    if (!snapshot) return "";
    return compileRepairPromptForProjectionSnapshot(
      workbench.project.generation.prompt,
      snapshot,
      workbench.project.generation.direction,
      workbench.project.generation.mode,
    );
  });
  let reviewSources = $derived([
    { value: "plate-sketch", label: "Plate Sketch", description: "Exact committed model input" },
    {
      value: "generated-result",
      label: "Generated Result",
      description: "Single returned image, projected without pixel rewriting",
      disabled: !imageRevision,
    },
  ]);
  let reviewSpatialSpec = $derived(
    reviewSourceId === "plate-sketch" ? plateRevision?.spatialSpec || null : imageRevision?.spatialSpec || null,
  );
  let reviewMedia = $derived.by((): ArtifactMedia => {
    if (reviewSourceId === "plate-sketch") return plateSketch.media;
    if (!imageRevision) return { kind: "none" };
    return imageRevision.media;
  });
  let reviewSourceLabel = $derived(reviewSourceId === "plate-sketch" ? "Plate Sketch" : "Generated Result");

  $effect(() => {
    const revisionId = imageRevision?.id || null;
    if (revisionId === observedImageRevisionId) return;
    observedImageRevisionId = revisionId;
    reviewSourceId = revisionId ? "generated-result" : "plate-sketch";
    downloadStatus = revisionId ? "New image result opened automatically." : "";
  });
  let summary = $derived(
    `${composition?.label || "No composition selected"} · ${finishedImageArtifact.status}${finishedImageArtifact.stale ? " stale" : ""} · ${
      finishedImageArtifact.media.name || "approved image pending"
    }`,
  );

  async function handlePlateSketchFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (file) await importPlateSketchFile(file);
    input.value = "";
  }

  async function handleFinishedImageFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (file) await importSourceFile(file);
    input.value = "";
  }

  function selectReviewSource(value: string): void {
    if (value === "plate-sketch" || value === "generated-result") {
      reviewSourceId = value;
    }
  }

  function selectRepairMode(value: string): void {
    if (value === "integrated" || value === "strict") updateRepairMode(value as PlateIntegrationMode);
  }

  function artifactStatus(artifactId: "plate-sketch" | "finished-image"): string {
    const artifact = getArtifact(artifactId);
    return artifact.stale || artifact.status === "stale" ? "stale" : artifact.status;
  }

  function reviewStatus(): string {
    if (reviewSourceId === "plate-sketch") return artifactStatus("plate-sketch");
    return imageRevision ? "revision ready" : "image pending";
  }

  function reviewMediaName(): string {
    if (reviewSourceId === "plate-sketch") return plateSketch.media.name || "No media";
    return reviewMedia.name || "No image revision";
  }

  function spatialReadout(): string {
    const spec = imageRevision?.spatialSpec;
    if (!spec) return "Generate or import an image to establish its raster contract.";
    return `${spec.projectionMode} · ${spec.targetWidth}×${spec.targetHeight} · direct carrier pixels`;
  }

  async function downloadFinishedImage(): Promise<void> {
    downloadStatus = "Preparing generated result…";
    try {
      const filename = await downloadSelectedFinishedImage("original");
      downloadStatus = `${filename} downloaded.`;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not download the finished image.";
      downloadStatus = message;
      recordWorkbenchError(message, "inpaint-review");
    }
  }
</script>

{#snippet inpaintLeft()}
  <WorkstationPanel
    class="inpaint-panel"
    label="Inpaint artifact status"
    title="Source roles"
    summary={`${composition?.label || "Select a composition"} · Plate Sketch → approved image`}
  >
    <ArtifactStatusGrid artifactIds={inpaintArtifacts} roles={inpaintRoles} label="Inpaint artifact readiness" />
  </WorkstationPanel>

  <WorkstationPanel class="inpaint-panel" label="Inpaint import shortcuts" title="Import" summary="Local files only">
    <FileImportControl
      id="plate-sketch-import"
      label="Import Plate Sketch handoff"
      accept="image/*"
      onchange={handlePlateSketchFile}
    />
    <FileImportControl
      id="finished-image-import"
      label="Import generated result"
      accept="image/*"
      onchange={handleFinishedImageFile}
    />
  </WorkstationPanel>
{/snippet}

{#snippet inpaintViewport()}
  <section class="inpaint-review-compare" aria-label="Plate Sketch and generated result review">
    <div class="inpaint-review-switch">
      <SegmentedControl
        label="Generation pipeline image"
        value={reviewSourceId}
        options={reviewSources}
        onSelect={selectReviewSource}
      />
      <small>
        {reviewSourceLabel} · {reviewStatus()} · {reviewMediaName()}
      </small>
      {#if imageRevision}
        <div class="inpaint-review-result-access" aria-label="Returned image access">
          <div class="inpaint-review-result-copy">
            <strong>Generated result ready</strong>
            <span>One returned raster. Projection views sample these pixels directly without seam correction.</span>
          </div>
          <div class="inpaint-review-result-actions">
            <ActionButton density="compact" onclick={() => void downloadFinishedImage()}
              >Download generated result</ActionButton
            >
            <a
              class="inpaint-review-open-original"
              href={imageRevision.media.url}
              target="_blank"
              rel="noopener noreferrer">Open result 1:1 ↗</a
            >
          </div>
          <small class="inpaint-review-download-status" role="status">
            {downloadStatus || "Downloads retain the image revision; PNG results include Zenith spatial metadata."}
          </small>
        </div>
      {:else}
        <div class="inpaint-review-result-empty" role="status">
          The returned image will open here automatically when generation completes.
        </div>
      {/if}
    </div>
    <div class="inpaint-review-viewer">
      <SourceMapMediaViewer media={reviewMedia} label={reviewSourceLabel} spatialSpec={reviewSpatialSpec} />
    </div>
  </section>
{/snippet}

{#snippet inpaintInspector()}
  <WorkstationPanel
    class="inpaint-panel inpaint-image-direction"
    label="GPT Image edit strategy"
    title="Plate integration + fill direction"
    summary={`${workbench.project.generation.mode === "integrated" ? "Integrated preservation" : "Strict pixel preservation"} · ${preparedRepairPrompt.length.toLocaleString()} chars compiled`}
  >
    <SegmentedControl
      label="Plate preservation strategy"
      value={workbench.project.generation.mode}
      options={repairModeOptions}
      onSelect={selectRepairMode}
    />
    <p class="control-help">
      Integrated keeps subjects and authored placement while allowing relighting, local deformation, and inward/outward
      repainting to remove crop boundaries. Strict pixels is intended for archival copy-through.
    </p>
    <TextAreaField
      id="inpaint-image-fill-direction"
      label={workbench.project.generation.mode === "integrated"
        ? "Artist direction for integrated scene"
        : "Artist direction for unresolved field"}
      note={workbench.project.generation.mode === "integrated"
        ? "Describe subject, material, atmosphere, and continuity. Plate identity and placement remain anchored while pixels and boundaries may harmonize."
        : "Describe subject, material, atmosphere, and continuity for newly synthesized field pixels. Existing Plate pixels remain locked."}
      rows={6}
      value={workbench.project.generation.direction}
      oninput={updateRepairDirection}
      placeholder="Example: Continue the luminous wetland as a dense bioluminescent botanical environment; preserve the existing flower scale, glassy material, cool dusk light, and fine interface traces."
    />
    <details class="compiled-repair-prompt">
      <summary>Inspect exact compiled prompt</summary>
      <pre>{preparedRepairPrompt}</pre>
    </details>
  </WorkstationPanel>

  <WorkstationPanel
    class="inpaint-panel"
    label="Inpaint primary action"
    title="Generate finished image"
    summary={`${composition?.label || "No composition"} · paid · Plate Sketch + original appearance references`}
  >
    <PrimaryOperatorAction
      operatorId="inpaint-plate-sketch"
      label="Inpaint Plate Sketch"
      note="Paid image generation returns one immutable raster from this composition's exact Plate Sketch and compiled prompt."
    />
  </WorkstationPanel>

  <WorkstationPanel
    class="inpaint-panel"
    label="Inpaint review"
    title="Image review gates"
    summary="Compare the exact model input with its returned image"
  >
    <div class="stage-artifact-grid" aria-label="Inpaint quality gates">
      <article data-status={artifactStatus("plate-sketch")}>
        <span>Plate Sketch</span>
        <strong>Exact model input</strong>
        <small>{artifactStatus("plate-sketch")} · authored carrier pixels</small>
      </article>
      <article data-status={artifactStatus("finished-image")}>
        <span>Generated Result</span>
        <strong>Single immutable output</strong>
        <small>{spatialReadout()}</small>
      </article>
    </div>
  </WorkstationPanel>
{/snippet}

{#snippet inpaintBottom()}
  <section class="inpaint-status-strip" aria-label="Inpaint composition readiness">
    <strong>{composition?.label || "Composition"}</strong>
    <span>Compose the carrier, inpaint it, then inspect the same pixels in the projection.</span>
    <small>{summary}</small>
  </section>
{/snippet}

<DomeSceneWorkbench
  label="Inpaint workspace"
  room="inpaint"
  eyebrow="Inpaint / Spatial Image"
  title={composition?.label || "Composition"}
  {summary}
  rootClass="finished-image-dock inpaint-workbench"
  topbarClass="inpaint-topbar"
  gridClass="inpaint-grid"
  leftClass="inpaint-left"
  mainClass="inpaint-main"
  inspectorClass="inpaint-inspector"
  left={inpaintLeft}
  viewport={inpaintViewport}
  bottom={inpaintBottom}
  inspector={inpaintInspector}
/>

<style>
  .inpaint-review-switch {
    grid-template-columns: minmax(21.5rem, 0.72fr) minmax(0, 1fr);
  }

  .inpaint-review-result-access {
    display: grid;
    grid-column: 1 / -1;
    gap: 0.38rem;
    border: 1px solid rgb(117 215 229 / 0.24);
    border-radius: 0.25rem;
    background: rgb(117 215 229 / 0.055);
    padding: 0.45rem;
  }

  .inpaint-review-result-copy {
    display: flex;
    min-width: 0;
    align-items: baseline;
    gap: 0.5rem;
  }

  .inpaint-review-result-copy strong {
    flex: none;
    color: #dceff0;
    font-size: 0.62rem;
    letter-spacing: 0.045em;
    text-transform: uppercase;
  }

  .inpaint-review-result-copy span,
  .inpaint-review-download-status,
  .inpaint-review-result-empty {
    color: #83999d;
    font-size: 0.56rem;
  }

  .compiled-repair-prompt {
    min-width: 0;
  }

  .compiled-repair-prompt summary {
    cursor: pointer;
    color: #90a5a8;
    font-size: 0.58rem;
  }

  .compiled-repair-prompt pre {
    max-height: 16rem;
    margin: 0.45rem 0 0;
    overflow: auto;
    border: 1px solid rgb(220 235 236 / 0.1);
    border-radius: 0.22rem;
    background: rgb(0 0 0 / 0.34);
    padding: 0.5rem;
    color: #9db1b4;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 0.52rem;
    line-height: 1.45;
    white-space: pre-wrap;
  }

  .inpaint-review-result-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.3rem;
  }

  .inpaint-review-open-original {
    border-bottom: 1px solid rgb(117 215 229 / 0.42);
    color: #75d7e5;
    font-size: 0.58rem;
    text-decoration: none;
  }

  .inpaint-review-open-original:hover {
    color: #dceff0;
  }

  .inpaint-review-result-empty {
    grid-column: 1 / -1;
    border: 1px dashed rgb(220 235 236 / 0.12);
    border-radius: 0.22rem;
    padding: 0.42rem;
  }

  @media (min-width: 981px) {
    :global(.dome-scene-workbench[data-room="inpaint"]) .inpaint-review-compare {
      padding-top: 3.35rem;
    }
  }

  @media (max-width: 980px) {
    .inpaint-review-switch {
      grid-template-columns: 1fr;
    }
  }
</style>
