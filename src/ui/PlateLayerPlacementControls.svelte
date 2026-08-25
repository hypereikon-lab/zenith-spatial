<script lang="ts" module>
  export type PlateLayerPlacementControlValue = {
    radius: number;
    azimuth: number;
    scale: number;
    spin: number;
    opacity: number;
  };

  export type PlateLayerPlacementControlPatch = Partial<PlateLayerPlacementControlValue>;
</script>

<script lang="ts">
  import { MAX_PLATE_SCALE, MIN_PLATE_SCALE } from "../plates/plate-placement.js";
  import { ActionButton, RangeField } from "./primitives/index.js";

  let {
    idPrefix,
    title = "Plate placement",
    summary = "",
    ariaLabel = "Plate placement controls",
    placement,
    disabled = false,
    showKeyAction = false,
    keyLabel = "Key +",
    oninput,
    onkey,
  }: {
    idPrefix: string;
    title?: string;
    summary?: string;
    ariaLabel?: string;
    placement: PlateLayerPlacementControlValue;
    disabled?: boolean;
    showKeyAction?: boolean;
    keyLabel?: string;
    oninput: (patch: PlateLayerPlacementControlPatch) => void;
    onkey?: () => void;
  } = $props();
</script>

<section class="plate-placement-controls" aria-label={ariaLabel}>
  <div class="plate-placement-heading">
    <div>
      <strong>{title}</strong>
      {#if summary}
        <small>{summary}</small>
      {/if}
    </div>
    {#if showKeyAction && onkey}
      <ActionButton tone="secondary" density="compact" {disabled} onclick={onkey}>{keyLabel}</ActionButton>
    {/if}
  </div>

  <div class="plate-placement-control-grid">
    <RangeField
      id={`${idPrefix}-radius`}
      label={`Radius ${placement.radius.toFixed(2)}`}
      value={placement.radius}
      min={0}
      max={1}
      step={0.01}
      {disabled}
      oninput={(value) => oninput({ radius: value })}
    />
    <RangeField
      id={`${idPrefix}-azimuth`}
      label={`Azimuth ${Math.round(placement.azimuth)} deg`}
      value={placement.azimuth}
      min={-180}
      max={180}
      step={1}
      {disabled}
      oninput={(value) => oninput({ azimuth: value })}
    />
    <RangeField
      id={`${idPrefix}-scale`}
      label={`Scale ${placement.scale.toFixed(2)}`}
      value={placement.scale}
      min={MIN_PLATE_SCALE}
      max={MAX_PLATE_SCALE}
      step={0.01}
      {disabled}
      oninput={(value) => oninput({ scale: value })}
    />
    <RangeField
      id={`${idPrefix}-spin`}
      label={`Spin ${Math.round(placement.spin)} deg`}
      value={placement.spin}
      min={-180}
      max={180}
      step={1}
      {disabled}
      oninput={(value) => oninput({ spin: value })}
    />
    <RangeField
      id={`${idPrefix}-opacity`}
      label={`Opacity ${placement.opacity.toFixed(2)}`}
      value={placement.opacity}
      min={0}
      max={1}
      step={0.01}
      {disabled}
      oninput={(value) => oninput({ opacity: value })}
    />
  </div>
</section>
