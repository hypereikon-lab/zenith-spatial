import { setMediaPreviewHandle } from "./artifact-media-handles.js";
import type { ArtifactMedia, ArtifactMediaHandle, ArtifactSlotId, JobState } from "./artifact-types.js";
import { collectWorkbenchObjectUrls, revokeObjectUrlsNoLongerInUse } from "./artifact-graph-store.js";
import { createDefaultMediaPreviewState, now, type WorkbenchState } from "./workbench-defaults.js";
import type { JobV1 } from "../lib/shared/contracts/jobs.js";

export function startWorkbenchJob(
  state: WorkbenchState,
  operatorId: JobState["operatorId"],
  label: string,
  stage = "Starting",
): void {
  state.jobs.unshift({
    id: `local-${operatorId}-${Date.now()}`,
    operatorId,
    label,
    status: "running",
    stage,
    progress: 0.01,
    busy: true,
    createdAt: now(),
  });
}

export function updateWorkbenchJob(
  state: WorkbenchState,
  operatorId: JobState["operatorId"],
  stage: string,
  progress: number | null = null,
): void {
  const job = state.jobs.find((item) => item.operatorId === operatorId && item.busy);
  if (!job) return;
  job.stage = stage;
  job.progress = progress;
  if (job.status === "queued" && (stage !== "Queued" || (progress ?? 0) > 0)) {
    job.status = "running";
  }
}

export function finishWorkbenchJob(state: WorkbenchState, operatorId: JobState["operatorId"], stage = "Done"): void {
  const job = state.jobs.find((item) => item.operatorId === operatorId && item.busy);
  if (!job) return;
  job.stage = stage;
  job.progress = 1;
  job.busy = false;
  job.status = stage === "Failed" ? "failed" : stage === "Cancelled" ? "cancelled" : "succeeded";
  job.finishedAt = now();
}

export function syncWorkbenchServerJob(state: WorkbenchState, serverJob: JobV1): void {
  const job =
    state.jobs.find((item) => item.serverJobId === serverJob.id) ||
    state.jobs.find((item) => item.operatorId === serverJob.operatorId && item.busy);
  const next: JobState = {
    id: job?.id || `server-${serverJob.id}`,
    serverJobId: serverJob.id,
    operatorId: serverJob.operatorId,
    label: job?.label || labelForOperator(serverJob.operatorId),
    status: serverJob.status,
    stage: serverJob.stage,
    progress: serverJob.progress,
    busy: !isTerminalStatus(serverJob.status),
    inputArtifactIds: [...serverJob.inputArtifactIds] as ArtifactSlotId[],
    outputArtifactIds: [...serverJob.outputArtifactIds] as ArtifactSlotId[],
    createdAt: serverJob.createdAt,
    startedAt: serverJob.startedAt,
    finishedAt: serverJob.finishedAt,
    error: serverJob.error?.message,
    detailsOpen: job?.detailsOpen,
  };
  if (job) {
    Object.assign(job, next);
    return;
  }
  state.jobs.unshift(next);
}

export function toggleWorkbenchJobDetails(state: WorkbenchState, jobId: string): void {
  const job = state.jobs.find((item) => item.id === jobId);
  if (!job) return;
  job.detailsOpen = !job.detailsOpen;
}

export function recordWorkbenchErrorInState(state: WorkbenchState, message: string, scope?: string): void {
  state.errors.unshift({ id: `error-${Date.now()}`, message, scope, createdAt: now() });
  state.errors = state.errors.slice(0, 5);
}

export function setMediaPreviewInState(state: WorkbenchState, media: ArtifactMedia, summary: string): void {
  const oldUrls = collectWorkbenchObjectUrls(state);
  state.project.workspace.mediaPreview.open = true;
  state.project.workspace.mediaPreview.media = media;
  state.project.workspace.mediaPreview.summary = summary;
  state.project.workspace.mediaPreview.updatedAt = now();
  revokeObjectUrlsNoLongerInUse(state, oldUrls);
}

export function replaceMediaPreviewInState(
  state: WorkbenchState,
  media: ArtifactMedia,
  summary: string,
  handle: ArtifactMediaHandle,
): void {
  const oldUrls = collectWorkbenchObjectUrls(state);
  state.project.workspace.mediaPreview.open = true;
  state.project.workspace.mediaPreview.media = media;
  state.project.workspace.mediaPreview.summary = summary;
  state.project.workspace.mediaPreview.updatedAt = now();
  setMediaPreviewHandle(handle);
  revokeObjectUrlsNoLongerInUse(state, oldUrls);
}

export function clearMediaPreviewInState(state: WorkbenchState): void {
  const oldUrls = collectWorkbenchObjectUrls(state);
  state.project.workspace.mediaPreview = createDefaultMediaPreviewState();
  setMediaPreviewHandle({ blob: null, file: null, canvas: null });
  revokeObjectUrlsNoLongerInUse(state, oldUrls);
}

export function setDropActiveInState(state: WorkbenchState, active: boolean, depth = 0): void {
  state.drop.active = active;
  state.drop.depth = depth;
}

function isTerminalStatus(status: JobState["status"]): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}

function labelForOperator(operatorId: JobState["operatorId"]): string {
  return operatorId
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
