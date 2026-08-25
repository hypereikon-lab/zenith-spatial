<script lang="ts">
  import { Label } from "$lib/components/ui/label/index.js";
  import type { Snippet } from "svelte";

  let {
    for: fieldId,
    label,
    note = "",
    labelHidden = false,
    class: className = "",
    children,
  }: {
    for?: string;
    label: string;
    note?: string;
    labelHidden?: boolean;
    class?: string;
    children: Snippet;
  } = $props();
</script>

<div class={`field-row zenith-field grid min-w-0 gap-1.5 ${labelHidden ? "label-hidden" : ""} ${className}`}>
  <Label for={fieldId} class="zenith-field-label grid gap-0.5 text-xs font-semibold text-muted-foreground">
    <span>{label}</span>
    {#if note}
      <small class="font-mono text-[10px] leading-tight text-muted-foreground/70">{note}</small>
    {/if}
  </Label>
  {@render children()}
</div>
