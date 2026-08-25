<script lang="ts">
  import { setDropActive, workbench } from "../artifacts/artifact-store.svelte.js";
  import { importPreviewMediaFile } from "../app/workbench-media-commands.js";

  function handleDragEnter(event: DragEvent) {
    event.preventDefault();
    setDropActive(true, workbench.drop.depth + 1);
  }

  function handleDragOver(event: DragEvent) {
    event.preventDefault();
  }

  function handleDragLeave() {
    setDropActive(workbench.drop.depth > 1, Math.max(0, workbench.drop.depth - 1));
  }

  async function handleDrop(event: DragEvent) {
    event.preventDefault();
    setDropActive(false, 0);
    const file = event.dataTransfer?.files?.[0];
    if (file) await importPreviewMediaFile(file);
  }
</script>

<svelte:window
  ondragenter={handleDragEnter}
  ondragover={handleDragOver}
  ondragleave={handleDragLeave}
  ondrop={handleDrop}
/>

{#if workbench.drop.active}
  <div class="drop-overlay">
    <span>Drop media to open Media Preview</span>
    <small>Keep it in preview until it is ready to become the Plate Sketch or finished image.</small>
  </div>
{/if}
