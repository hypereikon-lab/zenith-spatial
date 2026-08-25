<script lang="ts" module>
  export type ProjectionCameraPreset = "reset" | "zenith" | "horizon" | "front";
</script>

<script lang="ts">
  import CrosshairIcon from "@lucide/svelte/icons/crosshair";
  import RotateCcwIcon from "@lucide/svelte/icons/rotate-ccw";
  import ScanEyeIcon from "@lucide/svelte/icons/scan-eye";
  import TargetIcon from "@lucide/svelte/icons/target";
  import { ActionButton } from "./primitives/index.js";

  let {
    label = "Projection camera presets",
    density = "compact",
    onSelect,
  }: {
    label?: string;
    density?: "compact" | "icon-compact";
    onSelect: (preset: ProjectionCameraPreset) => void;
  } = $props();

  const presets = [
    {
      id: "reset",
      title: "Reset projected view",
      label: "Reset",
      icon: RotateCcwIcon,
    },
    {
      id: "zenith",
      title: "Look toward the zenith/nadir axis",
      label: "Zenith",
      icon: TargetIcon,
    },
    {
      id: "horizon",
      title: "Look across the horizon or CAVE wall band",
      label: "Horizon",
      icon: CrosshairIcon,
    },
    {
      id: "front",
      title: "Face the front of the projected stage",
      label: "Front",
      icon: ScanEyeIcon,
    },
  ] satisfies Array<{
    id: ProjectionCameraPreset;
    title: string;
    label: string;
    icon: typeof RotateCcwIcon;
  }>;
</script>

<div class="projection-camera-preset-strip" aria-label={label}>
  {#each presets as preset}
    {@const Icon = preset.icon}
    <ActionButton
      type="button"
      tone="secondary"
      {density}
      class="preset-btn"
      title={preset.title}
      onclick={() => onSelect(preset.id)}
    >
      <Icon aria-hidden="true" />
      <span class="preset-label">{preset.label}</span>
    </ActionButton>
  {/each}
</div>
