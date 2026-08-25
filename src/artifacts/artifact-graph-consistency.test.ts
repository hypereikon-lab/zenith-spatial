import { describe, expect, test } from "vitest";
import { OPERATORS } from "../app/operator-registry.js";
import {
  PROJECT_ARTIFACT_INPUTS_BY_ID,
  PROJECT_ARTIFACT_PHASE_BY_ID,
  PROJECT_ARTIFACT_SLOT_IDS,
  PROJECT_ARTIFACT_PHASE_IDS,
} from "../lib/shared/contracts/artifact-topology.js";
import { ARTIFACT_PHASES, workbench } from "./artifact-store.svelte.js";

describe("artifact graph consistency", () => {
  test("keeps runtime artifact phase ordering aligned with the shared project contract", () => {
    expect(ARTIFACT_PHASES.map((phase) => phase.id)).toEqual([...PROJECT_ARTIFACT_PHASE_IDS]);
    expect(ARTIFACT_PHASES.flatMap((phase) => phase.artifactIds)).toEqual([...PROJECT_ARTIFACT_SLOT_IDS]);

    for (const phase of ARTIFACT_PHASES) {
      for (const artifactId of phase.artifactIds) {
        expect(PROJECT_ARTIFACT_PHASE_BY_ID[artifactId]).toBe(phase.id);
      }
    }
  });

  test("creates initial runtime artifacts from the shared project topology", () => {
    expect(Object.keys(workbench.project.artifacts)).toEqual([...PROJECT_ARTIFACT_SLOT_IDS]);

    for (const artifactId of PROJECT_ARTIFACT_SLOT_IDS) {
      const artifact = workbench.project.artifacts[artifactId];

      expect(artifact.id).toBe(artifactId);
      expect(artifact.type).toBe(artifactId);
      expect(artifact.phase).toBe(PROJECT_ARTIFACT_PHASE_BY_ID[artifactId]);
      expect(artifact.inputs).toEqual([...PROJECT_ARTIFACT_INPUTS_BY_ID[artifactId]]);
    }
  });

  test("keeps operators attached to known artifact slots and phases", () => {
    const artifactSlots = new Set(PROJECT_ARTIFACT_SLOT_IDS);
    const artifactPhases = new Set(PROJECT_ARTIFACT_PHASE_IDS);

    for (const operator of OPERATORS) {
      expect(artifactPhases.has(operator.phase)).toBe(true);
      expect(artifactSlots.has(operator.attachTo)).toBe(true);
      expect(artifactSlots.has(operator.output)).toBe(true);
      expect(operator.inputs.every((input) => artifactSlots.has(input))).toBe(true);
      expect(PROJECT_ARTIFACT_PHASE_BY_ID[operator.attachTo]).toBe(operator.phase);
      expect(PROJECT_ARTIFACT_PHASE_BY_ID[operator.output]).toBe(operator.phase);
    }
  });
});
