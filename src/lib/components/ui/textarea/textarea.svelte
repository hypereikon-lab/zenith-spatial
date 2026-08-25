<script lang="ts">
  import { cn, type WithElementRef } from "$lib/utils.js";
  import type { HTMLTextareaAttributes } from "svelte/elements";

  let {
    class: className,
    ref = $bindable(null),
    value = $bindable(),
    "data-slot": dataSlot = "textarea",
    ...restProps
  }: WithElementRef<HTMLTextareaAttributes, HTMLTextAreaElement> = $props();
</script>

<textarea
  bind:this={ref}
  data-slot={dataSlot}
  class={cn(
    "border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 aria-invalid:border-destructive dark:bg-input/30 min-h-24 w-full min-w-0 rounded-lg border bg-transparent px-2.5 py-2 text-sm leading-5 outline-none transition-colors focus-visible:ring-3 disabled:cursor-not-allowed disabled:opacity-50",
    className,
  )}
  bind:value
  {...restProps}
></textarea>
