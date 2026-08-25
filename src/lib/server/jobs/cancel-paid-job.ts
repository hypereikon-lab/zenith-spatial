import type { JobV1 } from "$lib/shared/contracts/jobs";
import { getRunwayApiKey } from "$lib/server/runway/config";
import { errorStatus, httpError } from "$lib/server/runway/errors";
import { cancelRunwayTask } from "$lib/server/runway/http";
import { isTerminalJobStatus } from "./in-memory-job-store";
import type { JobStore } from "./job-store";
import { serverJobStore } from "./server-job-store";

export type CancelProviderTask = (taskId: string, signal?: AbortSignal) => Promise<void>;

export async function cancelPaidJob(
  jobId: string,
  {
    store = serverJobStore,
    signal,
    cancelProviderTask = cancelConfiguredRunwayTask,
  }: {
    store?: JobStore;
    signal?: AbortSignal;
    cancelProviderTask?: CancelProviderTask;
  } = {},
): Promise<JobV1 | null> {
  const cancellation = store.beginCancellation(jobId);
  if (!cancellation) return null;
  if (isTerminalJobStatus(cancellation.job.status)) return cancellation.job;
  if (!cancellation.providerTaskId) {
    return store.finishCancellation(jobId, httpError(499, "Job was cancelled before a provider task started."));
  }
  try {
    await cancelProviderTask(cancellation.providerTaskId, signal);
  } catch (error) {
    store.rejectCancellation(jobId, error);
    throw error;
  }
  return store.finishCancellation(jobId, httpError(499, "Runway task was cancelled."));
}

async function cancelConfiguredRunwayTask(taskId: string, signal?: AbortSignal): Promise<void> {
  const apiKey = getRunwayApiKey();
  if (!apiKey) throw httpError(401, "Runway cancellation requires RUNWAYML_API_SECRET.");
  try {
    await cancelRunwayTask(apiKey, taskId, signal);
  } catch (error) {
    if (errorStatus(error) === 404) return;
    throw error;
  }
}
