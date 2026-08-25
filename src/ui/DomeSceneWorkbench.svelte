<script lang="ts">
  import { cn } from "$lib/utils.js";
  import { tick, type Snippet } from "svelte";

  let leftColumn: HTMLElement | null = $state(null);
  let inspectorColumn: HTMLElement | null = $state(null);

  let {
    label,
    room,
    eyebrow = "Dome Scene",
    title,
    summary = "",
    rootClass = "",
    topbarClass = "",
    gridClass = "",
    leftClass = "",
    mainClass = "",
    inspectorClass = "",
    actions,
    left,
    viewport,
    inspector,
    bottom,
  }: {
    label: string;
    room: string;
    eyebrow?: string;
    title: string;
    summary?: string;
    rootClass?: string;
    topbarClass?: string;
    gridClass?: string;
    leftClass?: string;
    mainClass?: string;
    inspectorClass?: string;
    actions?: Snippet;
    left: Snippet;
    viewport: Snippet;
    inspector: Snippet;
    bottom?: Snippet;
  } = $props();

  $effect(() => {
    const activeRoom = room;
    void resetDockScroll(activeRoom);
  });

  async function resetDockScroll(activeRoom: string): Promise<void> {
    await tick();
    if (activeRoom !== room) return;
    if (leftColumn) leftColumn.scrollTop = 0;
    if (inspectorColumn) inspectorColumn.scrollTop = 0;
  }
</script>

<section class={cn("dome-scene-workbench", rootClass)} data-room={room} aria-label={label}>
  <div class={cn("dome-scene-topbar", topbarClass)}>
    <div class="dome-scene-title">
      <p class="eyebrow">{eyebrow}</p>
      <h2>{title}</h2>
      {#if summary}
        <small>{summary}</small>
      {/if}
    </div>

    {#if actions}
      <div class="dome-scene-actions" aria-label={`${title} room actions`}>
        {@render actions()}
      </div>
    {/if}
  </div>

  <div class={cn("dome-scene-editor-grid", gridClass)}>
    <aside bind:this={leftColumn} class={cn("dome-scene-left-column", leftClass)} aria-label={`${title} scene tools`}>
      {@render left()}
    </aside>

    <div class={cn("dome-scene-main", mainClass)} aria-label={`${title} viewport`}>
      <div class="dome-scene-viewport-region">
        {@render viewport()}
      </div>

      {#if bottom}
        <div class="dome-scene-bottom-strip">
          {@render bottom()}
        </div>
      {/if}
    </div>

    <aside
      bind:this={inspectorColumn}
      class={cn("dome-scene-inspector-column", inspectorClass)}
      aria-label={`${title} inspector`}
    >
      {@render inspector()}
    </aside>
  </div>
</section>
