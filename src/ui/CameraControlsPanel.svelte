<script lang="ts">
  import ArrowDownIcon from "@lucide/svelte/icons/arrow-down";
  import ArrowLeftIcon from "@lucide/svelte/icons/arrow-left";
  import ArrowRightIcon from "@lucide/svelte/icons/arrow-right";
  import ArrowUpIcon from "@lucide/svelte/icons/arrow-up";
  import EyeIcon from "@lucide/svelte/icons/eye";
  import Move3DIcon from "@lucide/svelte/icons/move-3d";
  import { Switch } from "$lib/components/ui/switch/index.js";
  import {
    eulerDegreesFromQuaternion,
    quaternionFromEulerDegrees,
    quaternionFromLookAt,
    lookAtPivot,
  } from "../geometry/camera-rig.js";
  import {
    defaultPlateEditorCamera,
    plateEditorViewDisabledReason,
    plateEditorViewLabel,
  } from "../plates/plate-editor-view.js";
  import { nudgeProjectionCamera } from "../geometry/projection-camera-controls.js";
  import ProjectionCameraPresetStrip, { type ProjectionCameraPreset } from "./ProjectionCameraPresetStrip.svelte";
  import ProjectionViewModeControls from "./ProjectionViewModeControls.svelte";
  import { ActionButton, NumberField, WorkstationPanel } from "./primitives/index.js";
  import type { PlateEditorViewMode, PlateEditorCamera } from "../plates/plate-editor-view.js";
  import type { SourceProjectionMode } from "../geometry/source-projection.js";
  import type { ProjectionSurface } from "../lib/shared/contracts/projection-authoring.js";

  let {
    viewMode = $bindable(),
    viewCamera = $bindable(),
    showCaveMask = $bindable(false),
    invertCaveMask = $bindable(false),
    projectionProfile,
    projectionSurface,
    onNudge,
  }: {
    viewMode: PlateEditorViewMode;
    viewCamera: PlateEditorCamera;
    showCaveMask?: boolean;
    invertCaveMask?: boolean;
    projectionProfile: SourceProjectionMode;
    projectionSurface?: ProjectionSurface | null;
    onNudge?: (truck: number, lift: number, push: number) => void;
  } = $props();

  let viewCameraEuler = $derived(eulerDegreesFromQuaternion(viewCamera.orientation));
  let advancedOpen = $state(false);

  function applyCameraPreset(preset: ProjectionCameraPreset) {
    const defaultCamera = defaultPlateEditorCamera(projectionProfile, projectionSurface);
    const pivot = defaultCamera.pivot || [0, 0, 0];
    const distance = Math.hypot(
      defaultCamera.position[0] - pivot[0],
      defaultCamera.position[1] - pivot[1],
      defaultCamera.position[2] - pivot[2],
    );

    if (preset === "reset") {
      viewCamera = defaultCamera;
      return;
    }

    let yaw = 0;
    let pitch = 0;

    if (preset === "zenith") {
      yaw = 0;
      pitch = (89.9 * Math.PI) / 180;
    } else if (preset === "horizon") {
      yaw = 0;
      pitch = 0;
    } else if (preset === "front") {
      yaw = 0;
      pitch = (12 * Math.PI) / 180;
    }

    const position: [number, number, number] = [
      pivot[0] + distance * Math.cos(pitch) * Math.sin(yaw),
      pivot[1] + distance * Math.sin(pitch),
      pivot[2] + distance * Math.cos(pitch) * Math.cos(yaw),
    ];

    viewCamera = {
      ...defaultCamera,
      position,
      orientation: quaternionFromLookAt(position, pivot),
      pivot,
    };
  }

  function setViewMode(mode: PlateEditorViewMode) {
    if (plateEditorViewDisabledReason(mode, projectionProfile)) return;
    viewMode = mode;
  }

  function updateCameraPosition(axis: 0 | 1 | 2, value: number) {
    const position = [...viewCamera.position] as [number, number, number];
    position[axis] = value;
    viewCamera = { ...viewCamera, position };
  }

  function updateCameraEuler(axis: "yawDegrees" | "pitchDegrees" | "rollDegrees", value: number) {
    const next = { ...viewCameraEuler, [axis]: value };
    viewCamera = {
      ...viewCamera,
      orientation: quaternionFromEulerDegrees(next.yawDegrees, next.pitchDegrees, next.rollDegrees),
    };
  }

  function updateCameraPivot(axis: 0 | 1 | 2, value: number) {
    const pivot = viewCamera.pivot
      ? ([...viewCamera.pivot] as [number, number, number])
      : ([0, 0, 0] as [number, number, number]);
    pivot[axis] = value;
    viewCamera = { ...viewCamera, pivot };
  }

  function relockToPivot() {
    viewCamera = lookAtPivot(viewCamera);
  }

  function handleNudge(truck: number, lift: number, push: number) {
    if (onNudge) {
      onNudge(truck, lift, push);
    } else {
      viewCamera = nudgeProjectionCamera(viewCamera, viewMode, truck, lift, push);
    }
  }
</script>

<WorkstationPanel
  class="camera-controls-panel"
  label="Local projection camera controls"
  title="Projection view"
  summary={plateEditorViewLabel(viewMode)}
>
  <ProjectionViewModeControls
    label="Projection view"
    value={viewMode}
    projectionMode={projectionProfile}
    class="camera-mode-segment"
    itemClass="camera-mode-item"
    disabledReason={(mode) => plateEditorViewDisabledReason(mode, projectionProfile)}
    onSelect={(value) => setViewMode(value)}
  />

  {#if viewMode !== "source-map"}
    <div class="camera-inspector-body">
      <ProjectionCameraPresetStrip onSelect={applyCameraPreset} />

      {#if viewMode === "cave-room" || viewMode === "dome-orbit" || viewMode === "dome-pov"}
        <div class="camera-settings-row">
          <label class="setting-toggle">
            <Switch bind:checked={showCaveMask} size="sm" aria-label="Show CAVE/Dome lattice mask" />
            <span class="toggle-label">CAVE / dome lattice mask</span>
          </label>
        </div>
        {#if showCaveMask}
          <div class="camera-settings-row nested">
            <label class="setting-toggle">
              <Switch bind:checked={invertCaveMask} size="sm" aria-label="Invert CAVE/Dome lattice mask" />
              <span class="toggle-label">Invert lattice mask</span>
            </label>
          </div>
        {/if}
      {/if}

      <details class="camera-transform-section" bind:open={advancedOpen}>
        <summary class="transform-toggle">
          <Move3DIcon aria-hidden="true" />
          <span>Transforms and nudge</span>
        </summary>
        {#if advancedOpen}
          <div class="transform-grid">
            <div class="transform-row">
              <span class="transform-label">Pos</span>
              <NumberField
                label="X"
                ariaLabel="X Position"
                step="0.1"
                value={Number(viewCamera.position[0].toFixed(2))}
                onchange={(value) => updateCameraPosition(0, value)}
              />
              <NumberField
                label="Y"
                ariaLabel="Y Position"
                step="0.1"
                value={Number(viewCamera.position[1].toFixed(2))}
                onchange={(value) => updateCameraPosition(1, value)}
              />
              <NumberField
                label="Z"
                ariaLabel="Z Position"
                step="0.1"
                value={Number(viewCamera.position[2].toFixed(2))}
                onchange={(value) => updateCameraPosition(2, value)}
              />
            </div>
            <div class="transform-row">
              <span class="transform-label">Rot</span>
              <NumberField
                label="Yaw"
                ariaLabel="Yaw"
                step="1"
                value={Math.round(viewCameraEuler.yawDegrees)}
                onchange={(value) => updateCameraEuler("yawDegrees", value)}
              />
              <NumberField
                label="Pitch"
                ariaLabel="Pitch"
                step="1"
                value={Math.round(viewCameraEuler.pitchDegrees)}
                onchange={(value) => updateCameraEuler("pitchDegrees", value)}
              />
              <NumberField
                label="Roll"
                ariaLabel="Roll"
                step="1"
                value={Math.round(viewCameraEuler.rollDegrees)}
                onchange={(value) => updateCameraEuler("rollDegrees", value)}
              />
            </div>
            <div class="transform-row">
              <span class="transform-label">Pvt</span>
              <NumberField
                label="X"
                ariaLabel="Pivot X"
                step="0.1"
                value={Number((viewCamera.pivot?.[0] ?? 0).toFixed(2))}
                onchange={(value) => updateCameraPivot(0, value)}
              />
              <NumberField
                label="Y"
                ariaLabel="Pivot Y"
                step="0.1"
                value={Number((viewCamera.pivot?.[1] ?? 0).toFixed(2))}
                onchange={(value) => updateCameraPivot(1, value)}
              />
              <NumberField
                label="Z"
                ariaLabel="Pivot Z"
                step="0.1"
                value={Number((viewCamera.pivot?.[2] ?? 0).toFixed(2))}
                onchange={(value) => updateCameraPivot(2, value)}
              />
            </div>
            <div class="nudge-pad">
              <ActionButton
                tone="secondary"
                density="icon-compact"
                class="nudge-btn"
                title="Truck Left"
                aria-label="Truck Left"
                onclick={() => handleNudge(-0.2, 0, 0)}
              >
                <ArrowLeftIcon aria-hidden="true" />
              </ActionButton>
              <ActionButton
                tone="secondary"
                density="icon-compact"
                class="nudge-btn"
                title="Lift Up"
                aria-label="Lift Up"
                onclick={() => handleNudge(0, 0.2, 0)}
              >
                <ArrowUpIcon aria-hidden="true" />
              </ActionButton>
              <ActionButton
                tone="secondary"
                density="icon-compact"
                class="nudge-btn"
                title="Truck Right"
                aria-label="Truck Right"
                onclick={() => handleNudge(0.2, 0, 0)}
              >
                <ArrowRightIcon aria-hidden="true" />
              </ActionButton>
              <ActionButton
                tone="secondary"
                density="compact"
                class="nudge-btn"
                title="Push Forward"
                aria-label="Push Forward"
                onclick={() => handleNudge(0, 0, 0.2)}
              >
                In
              </ActionButton>
              <ActionButton
                tone="secondary"
                density="icon-compact"
                class="nudge-btn"
                title="Lift Down"
                aria-label="Lift Down"
                onclick={() => handleNudge(0, -0.2, 0)}
              >
                <ArrowDownIcon aria-hidden="true" />
              </ActionButton>
              <ActionButton
                tone="secondary"
                density="compact"
                class="nudge-btn"
                title="Pull Back"
                aria-label="Pull Back"
                onclick={() => handleNudge(0, 0, -0.2)}
              >
                Out
              </ActionButton>
            </div>
            <ActionButton tone="secondary" density="compact" class="relock-btn" onclick={relockToPivot}>
              <EyeIcon aria-hidden="true" />
              Look at Pivot
            </ActionButton>
          </div>
        {/if}
      </details>
    </div>
  {/if}
</WorkstationPanel>
