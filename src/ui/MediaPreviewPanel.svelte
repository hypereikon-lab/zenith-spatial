<script lang="ts">
  import { clearMediaPreview, setMediaPreviewOpen, workbench } from "../artifacts/artifact-store.svelte.js";
  import { importPreviewMediaFile, promotePreviewMedia } from "../app/workbench-media-commands.js";
  import SourceMapMediaViewer from "./SourceMapMediaViewer.svelte";
  import { ActionButton, FileImportControl } from "./primitives/index.js";

  const media = $derived(workbench.project.workspace.mediaPreview.media);
  const hasMedia = $derived(media.kind === "image");

  async function handleFileInput(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (file) await importPreviewMediaFile(file);
    input.value = "";
  }
</script>

<section class="media-preview-panel" aria-label="Image projection preview">
  <div class="media-preview-header">
    <div>
      <p class="eyebrow">Image Preview</p>
      <h2>Inspect an image before attaching it to a composition.</h2>
      <p>{workbench.project.workspace.mediaPreview.summary}</p>
    </div>
    <div class="media-preview-actions">
      <FileImportControl
        id="media-preview-file"
        label="Import image"
        accept="image/*"
        compact
        onchange={handleFileInput}
      />
      <ActionButton tone="secondary" disabled={!hasMedia} onclick={clearMediaPreview}>Clear</ActionButton>
      <ActionButton tone="secondary" onclick={() => setMediaPreviewOpen(false)}>Close</ActionButton>
    </div>
  </div>
  {#if hasMedia}
    <SourceMapMediaViewer {media} label="Image Preview" />
  {:else}
    <div class="media-preview-empty">Drop an image to inspect it in source-map and projected views.</div>
  {/if}
  <div class="media-attach-panel">
    <strong>Attach to selected composition</strong>
    <div class="media-attach-grid">
      <ActionButton tone="secondary" disabled={!hasMedia} onclick={() => promotePreviewMedia("plate-sketch")}>
        Use as Plate Sketch
      </ActionButton>
      <ActionButton tone="secondary" disabled={!hasMedia} onclick={() => promotePreviewMedia("finished-image")}>
        Use as Finished Image
      </ActionButton>
    </div>
  </div>
</section>
