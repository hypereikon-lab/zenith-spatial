<script lang="ts">
  import { Button } from "$lib/components/ui/button/index.js";
  import { cn } from "$lib/utils.js";
  import type { SegmentedControlOption } from "./types.js";

  let {
    label,
    value,
    options,
    class: className = "",
    itemClass = "",
    disabled = false,
    onSelect,
  }: {
    label: string;
    value: string;
    options: SegmentedControlOption[];
    class?: string;
    itemClass?: string;
    disabled?: boolean;
    onSelect?: (value: string) => void;
  } = $props();

  function selectValue(nextValue: string): void {
    if (disabled) return;
    onSelect?.(nextValue);
  }
</script>

<div
  role="group"
  aria-label={label}
  aria-disabled={disabled}
  class={cn("zenith-segmented-control grid w-full gap-1", className)}
>
  {#each options as option}
    <Button
      type="button"
      variant={option.value === value ? "secondary" : "outline"}
      size="sm"
      disabled={disabled || option.disabled}
      class={cn(
        "zenith-segmented-item min-w-0 text-xs font-semibold text-muted-foreground",
        itemClass,
        option.value === value && "selected border-primary/70 bg-primary/15 text-foreground",
      )}
      aria-label={option.label}
      aria-pressed={option.value === value ? "true" : "false"}
      data-state={option.value === value ? "on" : "off"}
      title={option.description}
      onclick={() => selectValue(option.value)}
    >
      {option.label}
    </Button>
  {/each}
</div>
