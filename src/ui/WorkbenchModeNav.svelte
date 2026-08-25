<script lang="ts">
  import { domeSceneModeNavView, openDomeSceneMode } from "../app/dome-scene-mode-nav-view-model.js";
  import { ActionButton } from "./primitives/index.js";

  const nav = $derived(domeSceneModeNavView());
</script>

<nav class="stage-nav mode-nav" aria-label="Dome Scene modes">
  <div class="stage-nav-mode-strip mode-nav-mode-strip" aria-label="Dome Scene operating modes">
    {#each nav.modes as editorMode}
      <section
        class="stage-nav-item mode-nav-item"
        class:active={editorMode.active}
        data-ready={editorMode.readySummary}
        aria-label={`${editorMode.label} · ${editorMode.roleLabel} outputs`}
      >
        <ActionButton
          type="button"
          tone="secondary"
          density="compact"
          class="stage-nav-primary mode-nav-primary"
          selected={editorMode.active}
          aria-label={`Open ${editorMode.technicalLabel} — ${editorMode.label}`}
          aria-pressed={editorMode.active ? "true" : "false"}
          onclick={() => openDomeSceneMode(editorMode.id)}
        >
          <span class="stage-nav-index">{editorMode.number}</span>
          <span class="stage-nav-copy">
            <strong>{editorMode.label}</strong>
            <small>{editorMode.roleLabel}</small>
          </span>
          <span class="stage-nav-state" aria-hidden="true"></span>
        </ActionButton>
        <span class="stage-nav-readiness" aria-hidden="true">{editorMode.readySummary}</span>
      </section>
    {/each}
  </div>

  <section class="stage-nav-active-status" aria-label={`${nav.modeLabel} output readiness`}>
    <span class="stage-nav-output-label">Now</span>
    <div class="stage-artifact-strip mode-artifact-strip">
      {#each nav.activeArtifacts.filter((artifact) => artifact.selected) as artifact}
        <output
          class="stage-artifact-chip mode-artifact-chip"
          data-status={artifact.statusLabel}
          aria-label={artifact.ariaLabel}
        >
          <span>{artifact.label}</span>
          <strong>{artifact.statusLabel}</strong>
        </output>
      {/each}
      {#if nav.activeArtifacts.length > 1}
        <span class="stage-artifact-count">{nav.activeArtifacts.length} roles</span>
      {/if}
    </div>
  </section>
</nav>
