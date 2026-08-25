<script lang="ts">
  import { workbench } from "../artifacts/artifact-store.svelte.js";
  import {
    createCompositionState,
    deleteCompositionState,
    selectedCompositionState,
    selectCompositionState,
  } from "../app/workbench-sequence-commands.js";
  import { ActionButton } from "./primitives/index.js";

  const selected = $derived(selectedCompositionState());

  function select(event: Event) {
    selectCompositionState((event.currentTarget as HTMLSelectElement).value);
  }
</script>

<section class="composition-library" aria-label="Composition library">
  <label for="composition-library-select">Composition</label>
  <select id="composition-library-select" value={selected?.id || ""} onchange={select}>
    {#each workbench.project.sequence.compositions as composition}
      <option value={composition.id}>{composition.label}</option>
    {/each}
  </select>
  <ActionButton density="compact" tone="secondary" title="Duplicate selected composition" onclick={() => createCompositionState()}>
    Duplicate
  </ActionButton>
  <ActionButton
    density="compact"
    tone="secondary"
    title="Create an empty composition"
    onclick={() => createCompositionState({ duplicateSelected: false })}
  >
    New
  </ActionButton>
  <ActionButton
    density="compact"
    tone="secondary"
    disabled={workbench.project.sequence.compositions.length <= 1}
    title="Delete selected composition"
    onclick={() => selected && deleteCompositionState(selected.id)}
  >
    Delete
  </ActionButton>
</section>

<style>
  .composition-library { display: flex; min-width: 0; align-items: center; gap: .3rem; }
  label { color: var(--workstation-text-dim); font-size: .52rem; letter-spacing: .07em; text-transform: uppercase; }
  select {
    max-width: 11rem; border: 1px solid rgb(220 235 236 / .14); border-radius: .2rem;
    background: rgb(4 8 9 / .76); padding: .28rem .4rem; color: var(--workstation-text); font-size: .58rem;
  }
</style>
