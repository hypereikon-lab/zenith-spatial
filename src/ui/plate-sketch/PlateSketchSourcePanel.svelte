<script lang="ts">
  import { ActionButton, FileImportControl, WorkstationPanel } from "../primitives/index.js";
  import type { PlateSketchImage } from "../../plates/plate-sketch-sources.js";

  let {
    plates,
    activeIndex,
    handlePlateInput,
    loadDefaultPlates,
    removeActivePlate,
    selectPlate,
    plateLayerPlacementLabel,
  }: {
    plates: PlateSketchImage[];
    activeIndex: number;
    handlePlateInput: (event: Event) => void | Promise<void>;
    loadDefaultPlates: () => void | Promise<void>;
    removeActivePlate: () => void | Promise<void>;
    selectPlate: (index: number) => void;
    plateLayerPlacementLabel: (index: number) => string;
  } = $props();
</script>

<WorkstationPanel
  class="plate-scene-tool-panel"
  label="Plate source import tools"
  title="Plate sources"
  summary="Add source images to this plate composition"
>
  <div class="tool-row">
    <FileImportControl
      id="plate-editor-files"
      label="Add plate images"
      accept="image/*"
      multiple
      compact
      onchange={handlePlateInput}
    />
    <ActionButton tone="secondary" onclick={() => void loadDefaultPlates()}>Load default plates</ActionButton>
    <ActionButton tone="danger" disabled={plates.length === 0} onclick={() => void removeActivePlate()}>
      Remove selected
    </ActionButton>
  </div>
</WorkstationPanel>

<WorkstationPanel
  class="plate-source-layer-stack"
  label="Plate source layers"
  title="Source Layers"
  summary={`${plates.length} loaded`}
>
  <div class="plate-layer-list">
    {#if plates.length === 0}
      <p class="empty-note">Add plate images, drop them on the canvas, or load the defaults.</p>
    {/if}

    {#each plates as plate, index}
      <ActionButton
        type="button"
        tone="ghost"
        density="compact"
        class="plate-layer-row"
        selected={index === activeIndex}
        aria-pressed={index === activeIndex}
        aria-label={`Select ${plate.name} plate source`}
        onclick={() => selectPlate(index)}
      >
        <span class="plate-layer-kind">PLT</span>
        <span class="plate-layer-copy">
          <strong>{index + 1}. {plate.name}</strong>
          <small>{plateLayerPlacementLabel(index)}</small>
        </span>
      </ActionButton>
    {/each}
  </div>
</WorkstationPanel>
