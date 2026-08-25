import { recordWorkbenchError, syncServerJob, toggleJobDetails, workbench } from "../artifacts/artifact-store.svelte.js";
import type { JobState } from "../artifacts/artifact-types.js";
import { cancelRunwayJob, requestRunwayJobStatus } from "../runway/client.js";
import { executeOperator } from "./workbench-operator-commands.js";

export function toggleWorkbenchJobDetails(jobId: string): void {
  toggleJobDetails(jobId);
}

export async function refreshWorkbenchJob(jobId: string): Promise<void> {
  const job = findJob(jobId);
  if (!job?.serverJobId) return;
  try {
    syncServerJob(await requestRunwayJobStatus(job.serverJobId));
  } catch (error) {
    recordWorkbenchError(errorMessage(error), job.operatorId);
  }
}

export async function cancelWorkbenchJob(jobId: string): Promise<void> {
  const job = findJob(jobId);
  if (!job) return;
  if (!job.serverJobId) {
    recordWorkbenchError("Only server-backed jobs can be cancelled from the workbench.", job.operatorId);
    return;
  }
  try {
    syncServerJob(await cancelRunwayJob(job.serverJobId));
  } catch (error) {
    recordWorkbenchError(errorMessage(error), job.operatorId);
  }
}

export async function retryWorkbenchJob(jobId: string): Promise<void> {
  const job = findJob(jobId);
  if (!job) return;
  await executeOperator(job.operatorId);
}

function findJob(jobId: string): JobState | undefined {
  return workbench.jobs.find((job) => job.id === jobId);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Job command failed.";
}
