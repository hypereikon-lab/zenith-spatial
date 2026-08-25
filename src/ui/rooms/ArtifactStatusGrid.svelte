<script lang="ts">
  import { getArtifact } from "../../artifacts/artifact-store.svelte.js";
  import type { ArtifactSlotId } from "../../artifacts/artifact-types.js";

  let {
    artifactIds,
    roles = {},
    label = "Stage artifact status",
  }: {
    artifactIds: ArtifactSlotId[];
    roles?: Partial<Record<ArtifactSlotId, string>>;
    label?: string;
  } = $props();

  function statusFor(artifactId: ArtifactSlotId): string {
    const artifact = getArtifact(artifactId);
    if (artifact.stale || artifact.status === "stale") return "stale";
    return artifact.status;
  }

  function mediaFor(artifactId: ArtifactSlotId): string {
    const media = getArtifact(artifactId).media;
    if (media.kind === "none") return "No media";
    return media.name || media.kind;
  }
</script>

<div class="stage-artifact-grid" aria-label={label}>
  {#each artifactIds as artifactId}
    {@const artifact = getArtifact(artifactId)}
    <article data-status={statusFor(artifactId)}>
      <span>{roles[artifactId] || artifact.label}</span>
      <strong>{artifact.label}</strong>
      <small>{statusFor(artifactId)} · {mediaFor(artifactId)}</small>
    </article>
  {/each}
</div>
