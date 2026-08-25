<script lang="ts">
  import { Separator } from "$lib/components/ui/separator/index.js";
  import type { Snippet } from "svelte";

  let {
    label,
    title,
    summary = "",
    class: className = "",
    children,
    actions,
  }: {
    label: string;
    title: string;
    summary?: string;
    class?: string;
    children: Snippet;
    actions?: Snippet;
  } = $props();
</script>

<section class={`zenith-panel ${className}`} aria-label={label}>
  <div class="zenith-panel-heading">
    <span class="zenith-panel-title">
      <strong>{title}</strong>
      {#if summary}
        <small>{summary}</small>
      {/if}
    </span>
    {#if actions}
      <div class="zenith-panel-actions">
        {@render actions()}
      </div>
    {/if}
  </div>
  <Separator class="zenith-panel-separator" />
  {@render children()}
</section>
