import { PROJECT_ARTIFACT_INPUTS_BY_ID, PROJECT_ARTIFACT_SLOT_IDS } from "../lib/shared/contracts/artifact-topology.js";
import type { ArtifactSlotId } from "./artifact-types.js";

export function transitiveDependentArtifactIds(changed: ArtifactSlotId): ArtifactSlotId[] {
  return PROJECT_ARTIFACT_SLOT_IDS.filter(
    (artifactId) => artifactId !== changed && artifactDependsOn(artifactId, changed),
  );
}

export function artifactDependsOn(artifactId: ArtifactSlotId, dependency: ArtifactSlotId): boolean {
  const visited = new Set<ArtifactSlotId>();

  function visit(current: ArtifactSlotId): boolean {
    if (visited.has(current)) return false;
    visited.add(current);
    const inputs = PROJECT_ARTIFACT_INPUTS_BY_ID[current] as readonly ArtifactSlotId[];
    if (inputs.includes(dependency)) return true;
    return inputs.some(visit);
  }

  return visit(artifactId);
}
