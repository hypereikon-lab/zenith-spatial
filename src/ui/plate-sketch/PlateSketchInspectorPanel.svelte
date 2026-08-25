<script lang="ts">
  import { ActionButton, RangeField, SelectField, WorkstationPanel } from "../primitives/index.js";
  import PlateLayerPlacementControls from "../PlateLayerPlacementControls.svelte";
  import type { NormalizedPlatePlacement } from "../../plates/plate-placement.js";
  import type { PlateSketchImage } from "../../plates/plate-sketch-sources.js";
  import type { SelectFieldOption } from "../primitives/types.js";
  import ProjectionAuthoringPanel from "./ProjectionAuthoringPanel.svelte";

  type PlateEditMode = "scale" | "warp";

  let {
    activePlate,
    activePlacement,
    activeIndex,
    plates,
    plateFit,
    plateFeather,
    plateEditMode,
    canCommit,
    plateOptions,
    setActivePlateValue,
    setPlateFit,
    setPlateEditMode,
    setPlateFeather,
    updateActivePlacement,
    autoArrangeAndRender,
    resetActivePlate,
    resetActiveWarp,
    commitPlateSketch,
    downloadCurrentHandoff,
  }: {
    activePlate: PlateSketchImage | null;
    activePlacement: NormalizedPlatePlacement | null;
    activeIndex: number;
    plates: PlateSketchImage[];
    plateFit: string;
    plateFeather: number;
    plateEditMode: PlateEditMode;
    canCommit: boolean;
    plateOptions: SelectFieldOption[];
    setActivePlateValue: (value: string) => void;
    setPlateFit: (value: string) => void;
    setPlateEditMode: (value: string) => void;
    setPlateFeather: (value: number) => void;
    updateActivePlacement: (patch: Partial<NormalizedPlatePlacement>) => void;
    autoArrangeAndRender: () => void;
    resetActivePlate: () => void;
    resetActiveWarp: () => void;
    commitPlateSketch: () => void | Promise<void>;
    downloadCurrentHandoff: () => void | Promise<void>;
  } = $props();

  function flipActivePlacement(axis: "x" | "y"): void {
    if (!activePlacement) return;
    if (axis === "x") {
      updateActivePlacement({ flipX: !activePlacement.flipX });
    } else {
      updateActivePlacement({ flipY: !activePlacement.flipY });
    }
  }
</script>

<ProjectionAuthoringPanel />

<WorkstationPanel
  class="plate-inspector-panel"
  label="Selected plate inspector"
  title={activePlate?.name || "No active plate"}
  summary="Static raster placement"
>
  <SelectField
    id="plate-editor-active"
    label="Active plate"
    value={String(activeIndex)}
    options={plateOptions}
    disabled={plates.length === 0}
    onchange={setActivePlateValue}
  />

  <div class="plate-transform-grid" aria-label="Active plate transform controls">
    <SelectField
      id="plate-editor-fit"
      label="Fit mode"
      value={plateFit}
      options={[
        { value: "contain", label: "Contain ratio" },
        { value: "cover", label: "Cover crop" },
        { value: "stretch", label: "Stretch" },
      ]}
      onchange={setPlateFit}
    />
    <SelectField
      id="plate-editor-handle-mode"
      label="Corner handles"
      value={plateEditMode}
      options={[
        { value: "scale", label: "Scale plate" },
        { value: "warp", label: "Warp corners" },
      ]}
      onchange={setPlateEditMode}
    />
    <RangeField
      id="plate-editor-feather"
      label={`Edge fade ${plateFeather.toFixed(3)}`}
      value={plateFeather}
      min={0}
      max={0.18}
      step={0.002}
      oninput={setPlateFeather}
    />
  </div>

  {#if activePlacement}
    <PlateLayerPlacementControls
      idPrefix="plate-editor-placement"
      title="Plate placement"
      summary="Static composition"
      ariaLabel="Plate placement controls"
      placement={{
        radius: activePlacement.radius,
        azimuth: activePlacement.azimuth,
        scale: activePlacement.scale,
        spin: activePlacement.spin,
        opacity: activePlacement.opacity,
      }}
      oninput={updateActivePlacement}
    />
  {/if}

  <div class="tool-row plate-action-row">
    <ActionButton tone="secondary" disabled={plates.length === 0} onclick={autoArrangeAndRender}
      >Auto arrange</ActionButton
    >
    <ActionButton tone="secondary" disabled={!activePlacement} onclick={resetActivePlate}>Reset active</ActionButton>
    <ActionButton
      tone="secondary"
      disabled={!activePlacement}
      title={!activePlacement ? "Select a plate before editing warp." : "Reset active plate corner warp."}
      onclick={resetActiveWarp}
    >
      Reset warp
    </ActionButton>
    <ActionButton tone="secondary" disabled={!activePlacement} onclick={() => flipActivePlacement("x")}>
      Flip X
    </ActionButton>
    <ActionButton tone="secondary" disabled={!activePlacement} onclick={() => flipActivePlacement("y")}>
      Flip Y
    </ActionButton>
  </div>
</WorkstationPanel>

<WorkstationPanel
  class="plate-inspector-panel"
  label="Plate Sketch output actions"
  title="Plate Sketch output"
  summary="Commit the visible composition as the exact image-model input"
>
  <div class="tool-row plate-action-row">
    <ActionButton tone="operator" disabled={!canCommit} onclick={() => void commitPlateSketch()}
      >Use as Plate Sketch</ActionButton
    >
    <ActionButton tone="secondary" disabled={!canCommit} onclick={() => void downloadCurrentHandoff()}
      >Download full-scale PNG</ActionButton
    >
  </div>
</WorkstationPanel>
