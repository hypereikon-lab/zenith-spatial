<script lang="ts">
  import { cn } from "$lib/utils.js";
  import type { Snippet } from "svelte";

  let {
    label,
    eyebrow = "Zenith",
    title,
    summary,
    roomClass = "",
    headerControls,
    projectionControls,
    room,
    dock,
    jobs,
    errors,
    mediaPreview,
    dropController,
    paidConfirm,
  }: {
    label: string;
    eyebrow?: string;
    title: string;
    summary: string;
    roomClass?: string;
    headerControls: Snippet;
    projectionControls: Snippet;
    room: Snippet;
    dock: Snippet;
    jobs?: Snippet;
    errors?: Snippet;
    mediaPreview?: Snippet;
    dropController?: Snippet;
    paidConfirm?: Snippet;
  } = $props();
</script>

<main class={cn("zenith-workstation-shell", roomClass)} aria-label={label}>
  <header class="zenith-workstation-topbar">
    <div class="zenith-workstation-title">
      <span class="zenith-brand-mark" aria-hidden="true">Z</span>
      <span class="zenith-brand-copy">
        <span class="eyebrow">{eyebrow}</span>
        <span class="zenith-product-line">
          <h1>{title}</h1>
          <small>Fulldome studio</small>
        </span>
      </span>
    </div>

    <div class="zenith-workflow-dock" aria-label="Dome Scene mode and artifact readiness">
      {@render dock()}
    </div>

    {@render headerControls()}
  </header>

  <section class="zenith-workstation-contextbar" aria-label="Active workspace context">
    <div class="zenith-active-workspace-readout" aria-label="Current creative context">
      <span>Scene</span>
      <strong>{summary}</strong>
    </div>
    {@render projectionControls()}
  </section>

  <section class="zenith-workstation-room" aria-label="Dome Scene active editor">
    {@render room()}
  </section>

  {#if jobs}
    {@render jobs()}
  {/if}

  {#if errors}
    {@render errors()}
  {/if}

  {#if mediaPreview}
    {@render mediaPreview()}
  {/if}

  {#if dropController}
    {@render dropController()}
  {/if}

  {#if paidConfirm}
    {@render paidConfirm()}
  {/if}
</main>
