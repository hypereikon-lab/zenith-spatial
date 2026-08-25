<script lang="ts">
  import {
    SPATIAL_PROJECTION_VIEW_MODES,
    spatialProjectionViewModeUi,
    type SpatialProjectionViewMode,
  } from "../scene/projection-view-contract.js";
  import { SegmentedControl } from "./primitives/index.js";
  import { sourceProjectionIsSurfaceCarrier, type SourceProjectionMode } from "../geometry/source-projection.js";
  import type { SegmentedControlOption } from "./primitives/types.js";

  let {
    label = "Projection view",
    value,
    projectionMode,
    class: className = "",
    itemClass = "",
    disabledReason,
    onSelect,
  }: {
    label?: string;
    value: SpatialProjectionViewMode;
    projectionMode: SourceProjectionMode;
    class?: string;
    itemClass?: string;
    disabledReason?: (mode: SpatialProjectionViewMode) => string | null;
    onSelect: (mode: SpatialProjectionViewMode) => void;
  } = $props();

  const options = $derived(
    SPATIAL_PROJECTION_VIEW_MODES.map((mode) => {
      const copy = spatialProjectionViewModeUi(mode);
      const reason = disabledReason?.(mode) || defaultDisabledReason(mode);
      return {
        value: mode,
        label: copy.label,
        description: reason || copy.description,
        disabled: Boolean(reason),
      };
    }) satisfies SegmentedControlOption<SpatialProjectionViewMode>[],
  );

  function defaultDisabledReason(mode: SpatialProjectionViewMode): string | null {
    if ((mode === "dome-orbit" || mode === "dome-pov") && projectionMode.startsWith("cylinder-")) {
      return "Cylinder carriers are inspected in Plate Map or Volume Room.";
    }
    if (mode === "cave-room" && !sourceProjectionIsSurfaceCarrier(projectionMode)) {
      return "Volume Room is available for CAVE and cylinder surface carriers.";
    }
    return null;
  }
</script>

<SegmentedControl
  {label}
  {value}
  {options}
  class={`projection-view-mode-control ${className}`}
  {itemClass}
  onSelect={(mode) => onSelect(mode as SpatialProjectionViewMode)}
/>
