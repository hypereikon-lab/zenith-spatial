import { artifactIsReady, getArtifact, workbench } from "../artifacts/artifact-store.svelte.js";
import { getArtifactMediaHandle } from "../artifacts/artifact-media-handles.js";
import type {
  ArtifactMediaHandle,
  ArtifactMediaKind,
  ArtifactPhaseId,
  ArtifactSlotId,
  OperatorAvailability,
  OperatorDefinition,
  OperatorId,
  OperatorMediaRequirement,
} from "../artifacts/artifact-types.js";

const IMAGE_OR_CANVAS = ["image", "canvas"] as const;

export const OPERATORS: OperatorDefinition[] = [
  {
    id: "import-plate-sketch",
    phase: "compose",
    attachTo: "plate-sketch",
    label: "Import Plate Sketch",
    description: "Replace the selected composition with a committed Plate Sketch PNG.",
    inputs: [],
    output: "plate-sketch",
    kind: "local",
    executionMode: "file-import",
    requiresConfirmation: false,
  },
  {
    id: "choose-projection",
    phase: "compose",
    attachTo: "plate-sketch",
    label: "Choose Projection",
    description: "Set the selected composition's source-map and physical projection contract.",
    inputs: [],
    output: "plate-sketch",
    kind: "local",
    executionMode: "control",
    controlHint: "Use the projection controls above the viewport.",
    requiresConfirmation: false,
  },
  {
    id: "commit-plates",
    phase: "compose",
    attachTo: "plate-sketch",
    label: "Commit Plate Sketch",
    description: "Render the authored plates and semantic field into the exact image-model input.",
    inputs: [],
    output: "plate-sketch",
    kind: "local",
    requiresConfirmation: false,
  },
  {
    id: "import-source",
    phase: "image",
    attachTo: "finished-image",
    label: "Import Finished Image",
    description: "Attach an existing finished carrier image to this composition.",
    inputs: [],
    output: "finished-image",
    kind: "local",
    executionMode: "file-import",
    requiresConfirmation: false,
  },
  {
    id: "inpaint-plate-sketch",
    phase: "image",
    attachTo: "finished-image",
    label: "Inpaint Plate Sketch",
    description: "Generate one continuous carrier image from the committed Plate Sketch and its original sources.",
    inputs: ["plate-sketch"],
    output: "finished-image",
    kind: "paid-api",
    preflight: { media: [{ artifactId: "plate-sketch", kinds: [...IMAGE_OR_CANVAS] }], services: ["runway"] },
    requiresConfirmation: true,
    confirmationTitle: "Run paid image generation?",
    confirmationBody:
      "This sends the committed Plate Sketch, its original source images as appearance references, its projection-aware inpaint harness, and your direction to the configured image endpoint.",
    promptFields: [{ id: "direction", label: "Inpaint direction", artifactId: "finished-image", rows: 7 }],
  },
  {
    id: "save-project",
    phase: "image",
    attachTo: "finished-image",
    label: "Save Zenith Project",
    description: "Download a portable project archive with compositions, media, and spatial metadata.",
    inputs: [],
    output: "finished-image",
    kind: "local",
    requiresConfirmation: false,
  },
  {
    id: "load-project",
    phase: "image",
    attachTo: "finished-image",
    label: "Load Zenith Project",
    description: "Restore a Zenith project archive from disk.",
    inputs: [],
    output: "finished-image",
    kind: "local",
    executionMode: "control",
    controlHint: "Use Load Project in the top toolbar.",
    requiresConfirmation: false,
  },
];

export function getOperator(operatorId: OperatorId): OperatorDefinition {
  const operator = OPERATORS.find((item) => item.id === operatorId);
  if (!operator) throw new Error("Unknown operator: " + operatorId);
  return operator;
}

export function operatorsForArtifact(artifactId: ArtifactSlotId): OperatorAvailability[] {
  return OPERATORS.filter((operator) => operator.attachTo === artifactId).map((operator) => ({
    operator,
    disabledReason: disabledReasonForOperator(operator),
  }));
}

export function operatorsForPhase(phaseId: ArtifactPhaseId): OperatorAvailability[] {
  return OPERATORS.filter((operator) => operator.phase === phaseId).map((operator) => ({
    operator,
    disabledReason: disabledReasonForOperator(operator),
  }));
}

export function disabledReasonForOperator(operator: OperatorDefinition): string | null {
  const stale = operator.inputs.filter((id) => {
    const artifact = getArtifact(id);
    return artifact.stale || artifact.status === "stale";
  });
  if (stale.length) return "Refresh stale " + stale.map((id) => getArtifact(id).label).join(", ") + ".";
  const missing = operator.inputs.filter((id) => !artifactIsReady(id));
  if (missing.length) return "Needs " + missing.map((id) => getArtifact(id).label).join(", ") + ".";
  for (const requirement of operator.preflight?.media || []) {
    const reason = mediaRequirementFailure(requirement);
    if (reason) return reason;
  }
  if (operator.preflight?.services?.includes("runway") && workbench.operatorEnvironment.runwayConfigured === false) {
    return "Image service is not configured.";
  }
  return null;
}

function mediaRequirementFailure(requirement: OperatorMediaRequirement): string | null {
  const artifact = getArtifact(requirement.artifactId);
  const kind = effectiveMediaKind(artifact.media.kind, getArtifactMediaHandle(requirement.artifactId));
  return requirement.kinds.includes(kind as Exclude<ArtifactMediaKind, "none">)
    ? null
    : artifact.label + " needs " + requirement.kinds.join(" or ") + " media.";
}

function effectiveMediaKind(kind: ArtifactMediaKind, handle: ArtifactMediaHandle | undefined): ArtifactMediaKind {
  if (handle?.canvas) return "canvas";
  if (handle?.blob || handle?.file) return "image";
  return kind;
}

export function operatorExecutionMode(operator: OperatorDefinition) {
  return operator.executionMode || "command";
}
