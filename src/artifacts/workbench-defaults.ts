import type {
  ArtifactMedia,
  ArtifactPhase,
  ArtifactRecord,
  ArtifactSlotId,
  JobState,
  OperatorEnvironmentStatus,
  PendingPaidAction,
} from "./artifact-types.js";
import { DOME_HANDOFF_GUIDE } from "../geometry/dome-handoff-guide.js";
import { defaultSourceGuideCarrierHorizonRadius } from "../geometry/source-guide-semantics.js";
import {
  DEFAULT_PLATE_INTEGRATION_MODE,
  inpaintPromptForProjection,
  type PlateIntegrationMode,
} from "../inpaint/inpaint-prompts.js";
import {
  PROJECT_ARTIFACT_INPUTS_BY_ID,
  PROJECT_ARTIFACT_PHASE_BY_ID,
} from "../lib/shared/contracts/artifact-topology.js";
import type { CompositionSequence } from "../lib/shared/contracts/composition-sequence.js";
import type { DomeSceneGeneration, DomeSceneWorkspace } from "../lib/shared/contracts/projects.js";
import { createInitialCompositionSequence } from "../sequence/composition-sequence.js";
import { addCompositionSourceAsset, replaceCompositionSourceAssets } from "../sequence/composition-source-set.js";
import { DEFAULT_PLATE_REFERENCES } from "../plates/default-plate-profile.js";
import { createDefaultDomeScene, type DomeScene } from "../scene/dome-scene.js";

const DEFAULT_PLATE_SKETCH = "/default-plates/plate-01.png";

export type WorkbenchPromptDrafts = {
  prompt: string;
  direction: string;
  mode: PlateIntegrationMode;
};

export type WorkbenchErrorState = {
  id: string;
  message: string;
  scope?: string;
  createdAt: string;
};

export type WorkbenchMediaPreviewState = {
  open: boolean;
  media: ArtifactMedia;
  summary: string;
  updatedAt: string;
};

export type WorkbenchDomeSceneProject = {
  scene: DomeScene;
  sequence: CompositionSequence;
  workspace: Omit<DomeSceneWorkspace, "mediaPreview"> & { mediaPreview: WorkbenchMediaPreviewState };
  artifacts: Record<ArtifactSlotId, ArtifactRecord>;
  generation: DomeSceneGeneration & WorkbenchPromptDrafts;
};

export type WorkbenchState = {
  project: WorkbenchDomeSceneProject;
  jobs: JobState[];
  errors: WorkbenchErrorState[];
  pendingPaidAction: PendingPaidAction;
  operatorEnvironment: OperatorEnvironmentStatus;
  drop: { active: boolean; depth: number };
};

export const ARTIFACT_PHASES: ArtifactPhase[] = [
  {
    id: "compose",
    number: "01",
    label: "Plate composition",
    summary: "Source images and the committed Plate Sketch",
    artifactIds: ["plate-sketch"],
  },
  {
    id: "image",
    number: "02",
    label: "Spatial image",
    summary: "Generated or imported image revision",
    artifactIds: ["finished-image"],
  },
];

export const now = () => new Date().toISOString();

export function createInitialWorkbenchState(): WorkbenchState {
  const scene = createDefaultDomeScene({
    projectionMode: "zenith-180",
    guideSplit: DOME_HANDOFF_GUIDE.defaultSemanticSplit,
    horizonSplit: defaultSourceGuideCarrierHorizonRadius("cave-270", DOME_HANDOFF_GUIDE.defaultSemanticSplit),
  });
  const artifacts = createInitialArtifacts();
  const initialPlate = artifacts["plate-sketch"].media;
  if (initialPlate.kind !== "image" || !initialPlate.url) throw new Error("Initial Plate Sketch is required.");
  const sequence = createInitialCompositionSequence({
    plateSketch: {
      kind: "image",
      url: initialPlate.url,
      ...(initialPlate.name ? { name: initialPlate.name } : {}),
      ...(initialPlate.mime ? { mime: initialPlate.mime } : {}),
      ...(initialPlate.alt ? { alt: initialPlate.alt } : {}),
    },
    scene,
    createdAt: artifacts["plate-sketch"].createdAt,
  });
  const defaultSourceIds = DEFAULT_PLATE_REFERENCES.map((reference, index) => {
    const id = `composition-source-default-${index + 1}`;
    addCompositionSourceAsset(sequence, {
      id,
      label: reference.name,
      media: { kind: "image", url: reference.url, name: reference.name, mime: "image/png", alt: reference.name },
      width: reference.width,
      height: reference.height,
      aspect: reference.width / reference.height,
      createdAt: artifacts["plate-sketch"].createdAt || now(),
    });
    return id;
  });
  const initialComposition = sequence.compositions[0];
  replaceCompositionSourceAssets(sequence, initialComposition, defaultSourceIds);
  scene.frame0 = structuredClone(initialComposition.plateDraft.frame);
  const initialRevision = sequence.revisions[initialComposition.plateSketchRevisionId || ""];
  if (initialRevision) initialRevision.plateComposition = structuredClone(initialComposition.plateDraft);

  const prompts = createDefaultPromptDrafts();
  return {
    project: {
      scene,
      sequence,
      workspace: {
        modeId: "compose",
        selectedArtifactId: "plate-sketch",
        viewerMode: "domemaster",
        selectedCompositionId: initialComposition.id,
        mediaPreview: createDefaultMediaPreviewState(),
      },
      artifacts,
      generation: prompts,
    },
    jobs: [],
    errors: [],
    pendingPaidAction: null,
    operatorEnvironment: initialOperatorEnvironment(),
    drop: { active: false, depth: 0 },
  };
}

export function initialOperatorEnvironment(): OperatorEnvironmentStatus {
  const browser = typeof document !== "undefined" && typeof navigator !== "undefined";
  return {
    browser,
    webgpu: browser && Boolean(navigator.gpu),
    runwayConfigured: null,
    checkedAt: null,
  };
}

export function createDefaultMediaPreviewState(): WorkbenchMediaPreviewState {
  return {
    open: false,
    media: { kind: "none", blob: null, file: null, canvas: null },
    summary: "Drop an image here to inspect it through the selected projection geometry.",
    updatedAt: now(),
  };
}

export function createDefaultPromptDrafts(): WorkbenchPromptDrafts {
  return {
    prompt: inpaintPromptForProjection("zenith-180"),
    direction: "",
    mode: DEFAULT_PLATE_INTEGRATION_MODE,
  };
}

function createInitialArtifacts(): Record<ArtifactSlotId, ArtifactRecord> {
  const records: Record<ArtifactSlotId, ArtifactRecord> = {
    "plate-sketch": artifact(
      "plate-sketch",
      "Plate Sketch",
      "Exact projection-aware composition sent to the image model.",
      {
        kind: "image",
        url: DEFAULT_PLATE_SKETCH,
        name: "Default Plate Sketch",
        alt: "Default fulldome Plate Sketch",
        blob: null,
        file: null,
        canvas: null,
      },
      "ready",
    ),
    "finished-image": artifact(
      "finished-image",
      "Generated Image",
      "The original generated or imported spatial image revision.",
      { kind: "none", blob: null, file: null, canvas: null },
    ),
  };
  seedInitialResult(records, "plate-sketch", "Default Plate Sketch");
  return records;
}

function artifact(
  id: ArtifactSlotId,
  label: string,
  summary: string,
  media: ArtifactRecord["media"],
  status: ArtifactRecord["status"] = "missing",
): ArtifactRecord {
  return {
    id,
    type: id,
    phase: PROJECT_ARTIFACT_PHASE_BY_ID[id],
    label,
    summary,
    status,
    inputs: [...PROJECT_ARTIFACT_INPUTS_BY_ID[id]],
    projectionProfile: "zenith-180",
    media,
    results: [],
    createdAt: now(),
    updatedAt: now(),
    warnings: [],
    qcNotes: [],
    stale: false,
  };
}

function seedInitialResult(
  records: Record<ArtifactSlotId, ArtifactRecord>,
  artifactId: ArtifactSlotId,
  label: string,
): void {
  const source = records[artifactId];
  source.results = [
    {
      id: `${artifactId}-initial-result`,
      label,
      createdAt: source.createdAt || now(),
      media: source.media,
      operatorId: source.operatorId,
      selected: true,
    },
  ];
}
