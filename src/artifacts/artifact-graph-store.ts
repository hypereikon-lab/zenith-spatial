import { transitiveDependentArtifactIds } from "./artifact-dependencies.js";
import {
  clearArtifactResultMediaHandles,
  cloneMediaHandle,
  emptyMediaHandle,
  getArtifactMediaHandle,
  getArtifactResultMediaHandle,
  setArtifactMediaHandle,
  setArtifactResultMediaHandle,
} from "./artifact-media-handles.js";
import type {
  ArtifactMedia,
  ArtifactMediaHandle,
  ArtifactRecord,
  ArtifactResult,
  ArtifactSlotId,
} from "./artifact-types.js";
import { collectObjectUrlsFromArtifacts, revokeObjectUrls } from "./artifact-runtime-media.js";
import { now, type WorkbenchState } from "./workbench-defaults.js";
import type { SourceProjectionMode } from "../geometry/source-projection.js";

export const STALE_INPUT_WARNING = "Input artifact changed after this result was produced.";

export function getArtifactRecord(state: WorkbenchState, artifactId: ArtifactSlotId): ArtifactRecord {
  return state.project.artifacts[artifactId];
}

export function artifactIsReadyInState(state: WorkbenchState, artifactId: ArtifactSlotId): boolean {
  const artifact = getArtifactRecord(state, artifactId);
  return artifact.status === "ready" || artifact.status === "done" || artifact.status === "warning";
}

export function artifactInputsReadyInState(state: WorkbenchState, artifact: Pick<ArtifactRecord, "inputs">): boolean {
  return artifact.inputs.every((artifactId) => artifactIsReadyInState(state, artifactId));
}

export function updateArtifactRecord(
  state: WorkbenchState,
  artifactId: ArtifactSlotId,
  patch: Partial<Omit<ArtifactRecord, "id" | "type">>,
): void {
  const oldUrls = patch.media ? collectWorkbenchObjectUrls(state) : [];
  const artifact = getArtifactRecord(state, artifactId);
  Object.assign(artifact, patch, { updatedAt: now() });
  markDownstreamStale(state, artifactId);
  revokeObjectUrlsNoLongerInUse(state, oldUrls);
}

export function replaceArtifactRecords(state: WorkbenchState, artifacts: Record<ArtifactSlotId, ArtifactRecord>): void {
  const oldUrls = collectWorkbenchObjectUrls(state);
  state.project.artifacts = artifacts;
  clearArtifactResultMediaHandles();
  revokeObjectUrlsNoLongerInUse(state, oldUrls);
}

export function addArtifactResultToState(
  state: WorkbenchState,
  artifactId: ArtifactSlotId,
  result: Omit<ArtifactResult, "id" | "createdAt">,
): void {
  const artifact = getArtifactRecord(state, artifactId);
  const inserted = prependArtifactResult(artifact, artifactId, result);
  const handle = resultHandleForInsertedArtifactResult(state, artifactId, inserted.media);
  if (handle) {
    setArtifactResultMediaHandle(artifactId, inserted.id, handle);
  }
  artifact.updatedAt = now();
}

export function replaceArtifactMediaInState(
  state: WorkbenchState,
  artifactId: ArtifactSlotId,
  {
    patch,
    handle,
    result,
  }: {
    patch: Partial<Omit<ArtifactRecord, "id" | "type">> & Pick<ArtifactRecord, "media">;
    handle?: ArtifactMediaHandle;
    result?: Omit<ArtifactResult, "id" | "createdAt">;
  },
): void {
  const oldUrls = collectWorkbenchObjectUrls(state);
  const artifact = getArtifactRecord(state, artifactId);
  if (!("provenance" in patch)) artifact.provenance = undefined;
  Object.assign(artifact, patch, { updatedAt: now() });
  if (handle !== undefined) {
    setArtifactMediaHandle(artifactId, handle);
  }
  if (result) {
    const inserted = prependArtifactResult(artifact, artifactId, result);
    if (handle !== undefined) {
      setArtifactResultMediaHandle(artifactId, inserted.id, handle);
    }
  }
  markDownstreamStale(state, artifactId);
  revokeObjectUrlsNoLongerInUse(state, oldUrls);
}

export function selectArtifactResultInState(state: WorkbenchState, artifactId: ArtifactSlotId, resultId: string): void {
  const oldUrls = collectWorkbenchObjectUrls(state);
  const artifact = getArtifactRecord(state, artifactId);
  const result = artifact.results.find((item) => item.id === resultId);
  if (!result) return;
  if (result.selected && artifactMediaDescriptorsMatch(artifact.media, result.media)) return;
  artifact.results.forEach((item) => {
    item.selected = item.id === resultId;
  });
  artifact.media = result.media;
  artifact.prompt = result.prompt || artifact.prompt;
  if (result.config !== undefined) {
    artifact.config = result.config;
  }
  artifact.provenance = result.provenance;
  if (result.provenance) {
    artifact.projectionProfile = result.provenance.spatialSpec.projectionMode;
  }
  artifact.updatedAt = now();
  const resultHandle = getArtifactResultMediaHandle(artifactId, resultId);
  setArtifactMediaHandle(artifactId, resultHandle ? cloneMediaHandle(resultHandle) : emptyMediaHandle());
  markDownstreamStale(state, artifactId);
  revokeObjectUrlsNoLongerInUse(state, oldUrls);
}

export function setArtifactProjectionProfilesInState(state: WorkbenchState, profile: SourceProjectionMode): void {
  for (const artifact of Object.values(state.project.artifacts)) {
    artifact.projectionProfile = profile;
  }
}

export function markArtifactAndDownstreamStale(
  state: WorkbenchState,
  changed: ArtifactSlotId,
  warning = STALE_INPUT_WARNING,
): void {
  markArtifactStale(state, changed, warning);
  markDownstreamStale(state, changed, warning);
}

export function collectWorkbenchObjectUrls(state: WorkbenchState): string[] {
  return collectObjectUrlsFromArtifacts(Object.values(state.project.artifacts), [
    state.project.workspace.mediaPreview.media,
  ]);
}

export function revokeObjectUrlsNoLongerInUse(state: WorkbenchState, oldUrls: readonly string[]): void {
  if (oldUrls.length === 0) return;
  const liveUrls = new Set(collectWorkbenchObjectUrls(state));
  revokeObjectUrls(oldUrls.filter((url) => !liveUrls.has(url)));
}

function markDownstreamStale(state: WorkbenchState, changed: ArtifactSlotId, warning = STALE_INPUT_WARNING): void {
  for (const artifactId of transitiveDependentArtifactIds(changed)) {
    markArtifactStale(state, artifactId, warning);
  }
}

function markArtifactStale(state: WorkbenchState, artifactId: ArtifactSlotId, warning: string): void {
  const artifact = state.project.artifacts[artifactId];
  if (artifact.status === "ready" || artifact.status === "done" || artifact.status === "warning") {
    artifact.stale = true;
    artifact.status = "stale";
    artifact.warnings = [...new Set([...artifact.warnings, warning])];
  }
}

function prependArtifactResult(
  artifact: ArtifactRecord,
  artifactId: ArtifactSlotId,
  result: Omit<ArtifactResult, "id" | "createdAt">,
): ArtifactResult {
  artifact.results.forEach((item) => {
    item.selected = false;
  });
  const inserted: ArtifactResult = {
    ...result,
    id: `${artifactId}-result-${Date.now()}`,
    createdAt: now(),
    selected: true,
  };
  artifact.results.unshift(inserted);
  return inserted;
}

function resultHandleForInsertedArtifactResult(
  state: WorkbenchState,
  artifactId: ArtifactSlotId,
  resultMedia: ArtifactMedia,
): ArtifactMediaHandle | undefined {
  const artifact = getArtifactRecord(state, artifactId);
  if (!artifactMediaDescriptorsMatch(artifact.media, resultMedia)) return undefined;
  return getArtifactMediaHandle(artifactId);
}

function artifactMediaDescriptorsMatch(left: ArtifactMedia, right: ArtifactMedia): boolean {
  return (
    left.kind === right.kind &&
    left.url === right.url &&
    left.name === right.name &&
    left.mime === right.mime &&
    left.alt === right.alt
  );
}
