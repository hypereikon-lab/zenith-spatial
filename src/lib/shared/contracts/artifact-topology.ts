export const PROJECT_ARTIFACT_SLOT_IDS = ["plate-sketch", "finished-image"] as const;

export const PROJECT_ARTIFACT_PHASE_IDS = ["compose", "image"] as const;

export type ProjectArtifactSlotId = (typeof PROJECT_ARTIFACT_SLOT_IDS)[number];
export type ProjectArtifactPhaseId = (typeof PROJECT_ARTIFACT_PHASE_IDS)[number];

export const PROJECT_ARTIFACT_PHASE_BY_ID: Record<ProjectArtifactSlotId, ProjectArtifactPhaseId> = {
  "plate-sketch": "compose",
  "finished-image": "image",
};

export const PROJECT_ARTIFACT_INPUTS_BY_ID: Record<ProjectArtifactSlotId, readonly ProjectArtifactSlotId[]> = {
  "plate-sketch": [],
  "finished-image": ["plate-sketch"],
};
