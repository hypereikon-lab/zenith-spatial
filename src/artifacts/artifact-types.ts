import type { SourceProjectionMode } from "../geometry/source-projection.js";
import type { JobStatusV1 } from "../lib/shared/contracts/jobs.js";
import type { ImageGenerationProvenanceV1 } from "../lib/shared/contracts/composition-sequence.js";
import type { ProjectArtifactPhaseId, ProjectArtifactSlotId } from "../lib/shared/contracts/artifact-topology.js";

export type ArtifactPhaseId = ProjectArtifactPhaseId;

export type ArtifactSlotId = ProjectArtifactSlotId;

export type ArtifactStatus = "missing" | "ready" | "working" | "done" | "warning" | "stale";

export type ArtifactMediaKind = "none" | "image" | "canvas";

export type ArtifactMedia = {
  kind: ArtifactMediaKind;
  url?: string;
  name?: string;
  mime?: string;
  alt?: string;
  blob?: Blob | null;
  file?: File | null;
  canvas?: HTMLCanvasElement | null;
};

export type ArtifactMediaHandle = {
  blob?: Blob | null;
  file?: File | null;
  canvas?: HTMLCanvasElement | null;
};

export type ArtifactResult = {
  id: string;
  label: string;
  createdAt: string;
  media: ArtifactMedia;
  prompt?: string;
  config?: Record<string, ArtifactConfigValue>;
  provenance?: ImageGenerationProvenanceV1;
  operatorId?: string;
  selected?: boolean;
};

export type ArtifactConfigValue =
  | string
  | number
  | boolean
  | null
  | ArtifactConfigValue[]
  | { [key: string]: ArtifactConfigValue };

export type ArtifactRecord = {
  id: ArtifactSlotId;
  type: ArtifactSlotId;
  phase: ArtifactPhaseId;
  label: string;
  summary: string;
  status: ArtifactStatus;
  inputs: ArtifactSlotId[];
  operatorId?: string;
  projectionProfile: SourceProjectionMode;
  provenance?: ImageGenerationProvenanceV1;
  prompt?: string;
  config?: Record<string, ArtifactConfigValue>;
  media: ArtifactMedia;
  results: ArtifactResult[];
  createdAt?: string;
  updatedAt?: string;
  warnings: string[];
  qcNotes: string[];
  stale: boolean;
};

export type ArtifactPhase = {
  id: ArtifactPhaseId;
  number: string;
  label: string;
  summary: string;
  artifactIds: ArtifactSlotId[];
};

export type OperatorId =
  | "import-plate-sketch"
  | "import-source"
  | "choose-projection"
  | "commit-plates"
  | "inpaint-plate-sketch"
  | "save-project"
  | "load-project";

export type OperatorKind = "local" | "paid-api";

export type OperatorExecutionMode = "command" | "file-import" | "control";

export type OperatorBrowserCapability = "webgpu";

export type OperatorServiceRequirement = "runway";

export type OperatorMediaRequirement = {
  artifactId: ArtifactSlotId;
  kinds: Exclude<ArtifactMediaKind, "none">[];
};

export type OperatorPreflight = {
  media?: OperatorMediaRequirement[];
  browser?: OperatorBrowserCapability[];
  services?: OperatorServiceRequirement[];
};

export type PromptField = {
  id: string;
  label: string;
  artifactId: ArtifactSlotId;
  rows?: number;
};

export type OperatorDefinition = {
  id: OperatorId;
  phase: ArtifactPhaseId;
  attachTo: ArtifactSlotId;
  label: string;
  description: string;
  inputs: ArtifactSlotId[];
  output: ArtifactSlotId;
  kind: OperatorKind;
  executionMode?: OperatorExecutionMode;
  controlHint?: string;
  requiresConfirmation: boolean;
  confirmationTitle?: string;
  confirmationBody?: string;
  promptFields?: PromptField[];
  configFields?: string[];
  preflight?: OperatorPreflight;
};

export type OperatorAvailability = {
  operator: OperatorDefinition;
  disabledReason: string | null;
};

export type JobState = {
  id: string;
  serverJobId?: string;
  operatorId: OperatorId;
  label: string;
  status: JobStatusV1;
  stage: string;
  progress: number | null;
  busy: boolean;
  inputArtifactIds?: ArtifactSlotId[];
  outputArtifactIds?: ArtifactSlotId[];
  createdAt?: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  detailsOpen?: boolean;
};

export type PendingPaidAction = {
  operatorId: OperatorId;
  label: string;
  body: string;
} | null;

export type OperatorEnvironmentStatus = {
  browser: boolean;
  webgpu: boolean;
  runwayConfigured: boolean | null;
  checkedAt: string | null;
};
