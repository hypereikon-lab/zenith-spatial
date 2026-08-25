<script lang="ts">
  import { executeOperator } from "../app/workbench-operator-commands.js";
  import { importProjectSnapshotFile } from "../app/workbench-project-commands.js";
  import { ActionButton, FileImportControl } from "./primitives/index.js";
  import SaveIcon from "@lucide/svelte/icons/save";

  async function handleProjectImport(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (file) await importProjectSnapshotFile(file);
    input.value = "";
  }
</script>

<div class="zenith-topbar-actions" aria-label="Workbench view and persistence controls">
  <ActionButton
    tone="secondary"
    density="compact"
    title="Save a portable Zenith project snapshot"
    onclick={() => executeOperator("save-project")}
  >
    <SaveIcon aria-hidden="true" />
    Save Project
  </ActionButton>
  <FileImportControl
    id="project-import-file"
    label="Load Project"
    accept="application/vnd.zenith.project,.zenith,application/json,.json"
    compact
    onchange={handleProjectImport}
    class="zenith-project-import"
  />
</div>
