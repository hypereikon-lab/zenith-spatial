<script lang="ts">
  import { getArtifact, workbench } from "../artifacts/artifact-store.svelte.js";
  import { getOperator } from "../app/operator-registry.js";
  import { cancelPendingPaidAction, confirmPendingPaidAction } from "../app/workbench-operator-commands.js";
  import { selectedCompositionState } from "../app/workbench-sequence-commands.js";
  import { plateSketchRevisionForComposition } from "../sequence/composition-sequence.js";
  import { compileRepairPromptForProjectionSnapshot } from "../inpaint/inpaint-prompts.js";
  import { inpaintSourceReferenceDescriptors } from "../inpaint/inpaint-source-references.js";
  import { ActionButton } from "./primitives/index.js";

  function compiledPrompt(): string {
    const composition = selectedCompositionState();
    const revision = plateSketchRevisionForComposition(workbench.project.sequence, composition);
    const snapshot = revision?.plateComposition || composition?.plateDraft;
    if (!snapshot) return "No committed Plate Sketch prompt is available.";
    return compileRepairPromptForProjectionSnapshot(
      workbench.project.generation.prompt,
      snapshot,
      workbench.project.generation.direction,
      workbench.project.generation.mode,
    );
  }

  function sourceReferencePreviews() {
    if (workbench.project.generation.mode !== "integrated") return [];
    const composition = selectedCompositionState();
    const revision = plateSketchRevisionForComposition(workbench.project.sequence, composition);
    const snapshot = revision?.plateComposition || composition?.plateDraft;
    if (!snapshot) return [];
    return inpaintSourceReferenceDescriptors(snapshot.frame).map((reference) => {
      const layer = snapshot.frame.plateLayers.find((candidate) => candidate.id === reference.layerId);
      const asset = reference.assetId ? workbench.project.sequence.sourceAssets[reference.assetId] : undefined;
      return {
        ...reference,
        url: asset?.media.url || layer?.source.url,
        label: asset?.label || layer?.name || reference.sourceName,
      };
    });
  }
</script>

{#if workbench.pendingPaidAction}
  {@const operator = getOperator(workbench.pendingPaidAction.operatorId)}
  {@const plate = getArtifact("plate-sketch")}
  {@const sourceReferences = sourceReferencePreviews()}
  <div class="modal-backdrop" role="presentation">
    <div class="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="paid-action-title">
      <p class="eyebrow">Paid image action</p>
      <h2 id="paid-action-title">{workbench.pendingPaidAction.label}</h2>
      <p>{workbench.pendingPaidAction.body}</p>
      <article class="paid-reference">
        {#if plate.media.kind === "image" && plate.media.url}
          <img src={plate.media.url} alt={plate.media.alt || "Committed Plate Sketch input"} />
        {:else}<span>Committed canvas input</span>{/if}
        <div>
          <strong>Spatial authority · @plate_sketch</strong>
          <span>{plate.media.name || plate.label}</span>
          <small>{plate.stale ? "stale" : plate.status}</small>
        </div>
      </article>
      {#if sourceReferences.length > 0}
        <section class="paid-source-references" aria-label="Original Plate appearance references">
          <p><strong>Appearance authorities</strong><span>{sourceReferences.length} original source images</span></p>
          <div>
            {#each sourceReferences as reference}
              <article>
                {#if reference.url}<img src={reference.url} alt={reference.label} />{/if}
                <span
                  ><strong>@{reference.tag}</strong><small>Layer {reference.layerOrdinal} · {reference.label}</small
                  ></span
                >
              </article>
            {/each}
          </div>
        </section>
      {/if}
      <section class="repair-prompt-contract">
        <p>
          <strong>Integration</strong>
          {workbench.project.generation.mode === "integrated"
            ? "Content and placement remain anchored while plate boundaries may be harmonized."
            : "Source pixels and plate silhouettes remain protected."}
        </p>
        <p><strong>Direction</strong>{workbench.project.generation.direction.trim() || "No additional direction."}</p>
        <details>
          <summary>Inspect exact prompt</summary>
          <pre>{compiledPrompt()}</pre>
        </details>
      </section>
      <p class="control-help">No automated test or smoke check can press this confirmation.</p>
      <div class="dialog-actions">
        <ActionButton tone="secondary" onclick={cancelPendingPaidAction}>Cancel</ActionButton>
        <ActionButton tone="danger" onclick={confirmPendingPaidAction}>Confirm and generate</ActionButton>
      </div>
    </div>
  </div>
{/if}

<style>
  .paid-reference {
    display: grid;
    grid-template-columns: 7rem 1fr;
    gap: 0.6rem;
    align-items: center;
  }
  .paid-reference img {
    width: 7rem;
    max-height: 5rem;
    object-fit: contain;
    background: #000;
  }
  .paid-reference div,
  .repair-prompt-contract {
    display: grid;
    gap: 0.25rem;
  }
  .paid-reference span,
  .paid-reference small {
    color: #91a6aa;
    font-size: 0.62rem;
  }
  .paid-source-references {
    display: grid;
    gap: 0.45rem;
  }
  .paid-source-references > p {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    margin: 0;
  }
  .paid-source-references > p span {
    color: #91a6aa;
  }
  .paid-source-references > div {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
    gap: 0.4rem;
    max-height: 10rem;
    overflow: auto;
  }
  .paid-source-references article {
    display: grid;
    grid-template-columns: 2.8rem minmax(0, 1fr);
    gap: 0.4rem;
    align-items: center;
    padding: 0.35rem;
    border: 1px solid #263b3f;
    background: #0a1214;
  }
  .paid-source-references img {
    width: 2.8rem;
    height: 2.8rem;
    object-fit: cover;
    background: #000;
  }
  .paid-source-references article > span {
    display: grid;
    min-width: 0;
  }
  .paid-source-references small {
    overflow: hidden;
    color: #91a6aa;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .repair-prompt-contract pre {
    max-height: 17rem;
    overflow: auto;
    white-space: pre-wrap;
    font-size: 0.58rem;
  }
</style>
