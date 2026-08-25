<script lang="ts">
  import { getSelectedArtifact, getSelectedMode, workbench } from "../artifacts/artifact-store.svelte.js";
  import { sourceProjectionSummary } from "../geometry/source-projection.js";
  import type { Component } from "svelte";
  import MediaPreviewPanel from "./MediaPreviewPanel.svelte";
  import PaidActionConfirm from "./PaidActionConfirm.svelte";
  import JobStrip from "./JobStrip.svelte";
  import WorkstationShell from "./layout/WorkstationShell.svelte";
  import WorkbenchDropController from "./WorkbenchDropController.svelte";
  import WorkbenchHeaderControls from "./WorkbenchHeaderControls.svelte";
  import WorkbenchProjectionControls from "./WorkbenchProjectionControls.svelte";
  import WorkbenchModeNav from "./WorkbenchModeNav.svelte";
  import CompositionLibraryPanel from "./CompositionLibraryPanel.svelte";
  import { selectedCompositionState } from "../app/workbench-sequence-commands.js";
  import { projectionSurfaceSummary } from "../lib/shared/contracts/projection-authoring.js";

  const artifact = $derived(getSelectedArtifact());
  const mode = $derived(getSelectedMode());
  const composition = $derived(selectedCompositionState());
  const projection = $derived(
    sourceProjectionSummary(workbench.project.scene.projectionMode, workbench.project.scene.guideSplit),
  );
  const roomComponent = $derived(loadRoomComponent(mode.id));
  const roomComponents = new Map<string, Promise<Component>>();
  const summary = $derived(
    (composition?.label || artifact.label) +
      " · " +
      mode.shortLabel +
      " · " +
      projection.label +
      " · " +
      workbench.project.scene.raster.width +
      "×" +
      workbench.project.scene.raster.height,
  );

  function loadRoomComponent(modeId: string): Promise<Component> {
    const cached = roomComponents.get(modeId);
    if (cached) return cached;
    const loaded = roomModule(modeId).then((module) => module.default);
    roomComponents.set(modeId, loaded);
    return loaded;
  }

  function roomModule(modeId: string) {
    if (modeId === "inpaint") return import("./rooms/InpaintRoom.svelte");
    if (modeId === "project") return import("./rooms/ProjectReviewRoom.svelte");
    return import("./PlateSketchEditor.svelte");
  }
</script>

{#snippet headerControls()}<WorkbenchHeaderControls />{/snippet}
{#snippet projectionControls()}
  <div class="zenith-projection-context">
    {#if mode.id === "compose"}<WorkbenchProjectionControls />{:else}
      <span>Committed geometry</span>
      <strong>{projection.label} · {projectionSurfaceSummary(workbench.project.scene.surface)}</strong>
    {/if}
    <CompositionLibraryPanel />
  </div>
{/snippet}
{#snippet room()}
  {#await roomComponent}
    <div class="zenith-room-loading" role="status">Preparing {mode.label}…</div>
  {:then Room}<Room />
  {:catch error}
    <div class="zenith-room-loading error" role="alert">
      Could not open {mode.label}: {error instanceof Error ? error.message : "Unknown error"}
    </div>
  {/await}
{/snippet}
{#snippet dock()}<WorkbenchModeNav />{/snippet}
{#snippet jobs()}<JobStrip />{/snippet}
{#snippet errors()}
  {#if workbench.errors.length}<section class="error-strip" aria-label="Recent errors">
      {#each workbench.errors as error}<p>{error.message}</p>{/each}
    </section>{/if}
{/snippet}
{#snippet mediaPreview()}
  {#if workbench.project.workspace.mediaPreview.open}
    <div class="media-preview-overlay" role="dialog" aria-label="Media Preview geometry inspector">
      <MediaPreviewPanel />
    </div>
  {/if}
{/snippet}
{#snippet dropController()}<WorkbenchDropController />{/snippet}
{#snippet paidConfirm()}<PaidActionConfirm />{/snippet}

<WorkstationShell
  label="Zenith spatial image workbench"
  eyebrow="Spatial image studio"
  title="Zenith"
  {summary}
  roomClass={"mode-" + mode.id + "-room"}
  {headerControls}
  {projectionControls}
  {room}
  {dock}
  {jobs}
  {errors}
  {mediaPreview}
  {dropController}
  {paidConfirm}
/>

<style>
  .zenith-room-loading {
    display: grid;
    height: 100%;
    place-items: center;
    color: var(--muted-foreground);
  }
  .zenith-room-loading.error {
    color: var(--destructive);
  }
  .zenith-projection-context {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 0.65rem;
  }
  .zenith-projection-context > span {
    color: var(--workstation-text-dim);
    font-size: 0.52rem;
    text-transform: uppercase;
  }
  .zenith-projection-context > strong {
    color: var(--workstation-text);
    font-size: 0.58rem;
    white-space: nowrap;
  }
</style>
