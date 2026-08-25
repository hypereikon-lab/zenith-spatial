<script lang="ts">
  import { ActionButton } from "../primitives/index.js";
  import type { PlateSketchImage } from "../../plates/plate-sketch-sources.js";
  import type {
    ProjectedSpatialAnchorGuide,
    ProjectedSpatialAnchorId,
  } from "../../plates/projected-physical-horizon.js";

  let {
    renderCanvas = $bindable<HTMLCanvasElement | null>(null),
    previewCanvas = $bindable<HTMLCanvasElement | null>(null),
    plates,
    renderStatus,
    viewerMode,
    projectionTitle,
    carrierAspect,
    loadDefaultPlates,
    dropActive,
    handlePlateDragEnter,
    handlePlateDragOver,
    handlePlateDragLeave,
    handlePlateDrop,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handleProjectedGuidePointerDown,
    handleProjectedGuideKeydown,
    handleWheel,
    projectedGuides,
    previewWidth,
    previewHeight,
  }: {
    renderCanvas: HTMLCanvasElement | null;
    previewCanvas: HTMLCanvasElement | null;
    plates: PlateSketchImage[];
    renderStatus: string;
    viewerMode: string;
    projectionTitle: string;
    carrierAspect: number;
    loadDefaultPlates: () => void | Promise<void>;
    dropActive: boolean;
    handlePlateDragEnter: (event: DragEvent) => void;
    handlePlateDragOver: (event: DragEvent) => void;
    handlePlateDragLeave: (event: DragEvent) => void;
    handlePlateDrop: (event: DragEvent) => void;
    handlePointerDown: (event: PointerEvent) => void;
    handlePointerMove: (event: PointerEvent) => void;
    handlePointerUp: (event: PointerEvent) => void;
    handleProjectedGuidePointerDown: (event: PointerEvent, anchorId: ProjectedSpatialAnchorId) => void;
    handleProjectedGuideKeydown: (event: KeyboardEvent, anchorId: ProjectedSpatialAnchorId) => void;
    handleWheel: (event: WheelEvent) => void;
    projectedGuides: readonly ProjectedSpatialAnchorGuide[];
    previewWidth: number;
    previewHeight: number;
  } = $props();
</script>

<div class="plate-canvas-wrap">
  <div
    class:dome-check={viewerMode === "dome-check"}
    class:rim-check={viewerMode === "rim-check"}
    class:drop-active={dropActive}
    class="plate-canvas-stack"
    style={`--carrier-aspect:${Math.max(0.01, carrierAspect)}`}
  >
    <div class="plate-viewport-hud" aria-hidden="true">
      <span>Plate Sketch</span>
      <span>{plates.length} raster layer{plates.length === 1 ? "" : "s"}</span>
      <span>{viewerMode.replace("-", " ")}</span>
      <span>Drop images to add</span>
    </div>
    <canvas bind:this={renderCanvas} class="plate-preview-canvas plate-render-canvas" aria-hidden="true"></canvas>
    <canvas
      bind:this={previewCanvas}
      class="plate-preview-canvas plate-overlay-canvas"
      aria-label="Editable Plate Sketch placement handles"
      aria-keyshortcuts="Delete Backspace"
      tabindex="0"
      title={projectionTitle}
      onpointerdown={handlePointerDown}
      onpointermove={handlePointerMove}
      onpointerup={handlePointerUp}
      onpointercancel={handlePointerUp}
      onwheel={handleWheel}
      oncontextmenu={(event) => event.preventDefault()}
      ondragenter={handlePlateDragEnter}
      ondragover={handlePlateDragOver}
      ondragleave={handlePlateDragLeave}
      ondrop={handlePlateDrop}
    ></canvas>
    {#if dropActive}
      <div class="plate-drop-target" aria-hidden="true">
        <strong>Add Plate sources</strong>
        <span>Drop images at this position</span>
      </div>
    {/if}
    {#if projectedGuides.some((guide) => guide.handle)}
      <div class="plate-projected-guide-layer">
        {#each projectedGuides as guide (guide.id)}
          {#if guide.handle}
            <button
              type="button"
              class:semantic={guide.id === "semantic"}
              class="plate-projected-guide-handle"
              style={`--guide-x:${guide.handle.x / Math.max(previewWidth, 1)};--guide-y:${guide.handle.y / Math.max(previewHeight, 1)}`}
              aria-label={`Drag ${guide.label.toLowerCase()} on projected space, currently ${guide.value.toFixed(guide.unit === "meters" ? 2 : 1)} ${guide.unit === "meters" ? "metres" : "degrees"}`}
              title="Drag the texture anchor on the projected surface; observer pose and source-map allocation stay fixed"
              onpointerdown={(event) => handleProjectedGuidePointerDown(event, guide.id)}
              onpointermove={handlePointerMove}
              onpointerup={handlePointerUp}
              onpointercancel={handlePointerUp}
              onkeydown={(event) => handleProjectedGuideKeydown(event, guide.id)}
            >
              <span class="plate-projected-guide-knob" aria-hidden="true"></span>
              <span class="plate-projected-guide-label">
                {guide.label} · {guide.value.toFixed(guide.unit === "meters" ? 2 : 1)}{guide.unit === "meters"
                  ? " m"
                  : "°"}
              </span>
            </button>
          {/if}
        {/each}
      </div>
    {/if}
    {#if plates.length === 0}
      <div class="plate-empty-viewport" aria-label="Plate viewport empty state">
        <span class="eyebrow">Awaiting raster evidence</span>
        <strong>No Plate sources loaded</strong>
        <small>{renderStatus}</small>
        <ActionButton tone="secondary" density="compact" onclick={() => void loadDefaultPlates()}>
          Load default plates
        </ActionButton>
      </div>
    {/if}
  </div>
</div>
