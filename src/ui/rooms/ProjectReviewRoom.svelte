<script lang="ts">
  import { workbench } from "../../artifacts/artifact-store.svelte.js";
  import type { ArtifactMedia } from "../../artifacts/artifact-types.js";
  import { downloadSelectedFinishedImage } from "../../app/workbench-media-commands.js";
  import { selectedCompositionState } from "../../app/workbench-sequence-commands.js";
  import {
    plateSketchRevisionForComposition,
    selectedImageRevisionForComposition,
  } from "../../sequence/composition-sequence.js";
  import DomeSceneWorkbench from "../DomeSceneWorkbench.svelte";
  import SourceMapMediaViewer from "../SourceMapMediaViewer.svelte";
  import { ActionButton, SegmentedControl, WorkstationPanel } from "../primitives/index.js";

  type ReviewSource = "image" | "plate";
  let source = $state<ReviewSource>("image");
  let downloadStatus = $state("");
  let observedImageId = $state<string | null>(null);
  const composition = $derived(selectedCompositionState());
  const plate = $derived(plateSketchRevisionForComposition(workbench.project.sequence, composition));
  const image = $derived(selectedImageRevisionForComposition(workbench.project.sequence, composition));
  const media = $derived.by((): ArtifactMedia => {
    const revision = source === "image" ? image : plate;
    return revision?.media || { kind: "none" };
  });
  const spatialSpec = $derived((source === "image" ? image : plate)?.spatialSpec || null);
  const summary = $derived(
    (composition?.label || "Composition") +
      " · " +
      (image ? "image ready" : "image pending") +
      " · " +
      workbench.project.scene.projectionMode,
  );
  const sourceOptions = $derived([
    { value: "image", label: "Inpainted Image", description: "Returned carrier pixels", disabled: !image },
    { value: "plate", label: "Plate Sketch", description: "Exact model input", disabled: !plate },
  ]);

  $effect(() => {
    const imageId = image?.id || null;
    if (imageId && imageId !== observedImageId) source = "image";
    else if (!imageId && plate && source === "image") source = "plate";
    observedImageId = imageId;
  });

  function selectSource(value: string) {
    if (value === "image" || value === "plate") source = value;
  }

  async function download() {
    try {
      downloadStatus = "Preparing image…";
      downloadStatus = (await downloadSelectedFinishedImage("original")) + " downloaded.";
    } catch (error) {
      downloadStatus = error instanceof Error ? error.message : "Could not download image.";
    }
  }
</script>

{#snippet left()}
  <WorkstationPanel label="Projection review source" title="Carrier image" {summary}>
    <SegmentedControl label="Review source" value={source} options={sourceOptions} onSelect={selectSource} />
    {#if image}
      <ActionButton density="compact" onclick={() => void download()}>Download original image</ActionButton>
      <a href={image.media.url} target="_blank" rel="noopener noreferrer">Open 1:1 ↗</a>
      <small role="status">{downloadStatus || "The original image and spatial metadata remain attached."}</small>
    {:else}
      <p>Inpaint or import an image for this composition first.</p>
    {/if}
  </WorkstationPanel>
{/snippet}

{#snippet viewport()}
  <section class="project-review-viewport" aria-label="Spatial projection review">
    <SourceMapMediaViewer {media} label={source === "image" ? "Inpainted Image" : "Plate Sketch"} {spatialSpec} />
  </section>
{/snippet}

{#snippet inspector()}
  <WorkstationPanel label="Pinned spatial metadata" title="Projection contract" summary="Read-only review">
    {#if spatialSpec}
      <dl>
        <div>
          <dt>Projection</dt>
          <dd>{spatialSpec.projectionMode}</dd>
        </div>
        <div>
          <dt>Carrier</dt>
          <dd>{spatialSpec.targetWidth} × {spatialSpec.targetHeight}</dd>
        </div>
        <div>
          <dt>Horizon</dt>
          <dd>{spatialSpec.horizonSplit.toFixed(3)}</dd>
        </div>
        <div>
          <dt>Surface</dt>
          <dd>{spatialSpec.surface.kind}</dd>
        </div>
      </dl>
    {:else}<p>No committed spatial contract.</p>{/if}
  </WorkstationPanel>
{/snippet}

<DomeSceneWorkbench
  label="Spatial projection review"
  room="project"
  eyebrow="Project / Spatial Review"
  title={composition?.label || "Composition"}
  {summary}
  {left}
  {viewport}
  {inspector}
/>

<style>
  .project-review-viewport {
    width: 100%;
    height: 100%;
    min-height: 32rem;
  }
  .project-review-viewport :global(.source-map-viewer) {
    min-height: 32rem;
  }
  a {
    color: #75d7e5;
    font-size: 0.6rem;
  }
  small,
  p,
  dt {
    color: #83999d;
    font-size: 0.56rem;
  }
  dl,
  dl div {
    display: grid;
    gap: 0.35rem;
  }
  dl div {
    grid-template-columns: 5rem 1fr;
  }
  dd {
    margin: 0;
    color: #dceff0;
    font-size: 0.6rem;
  }
</style>
