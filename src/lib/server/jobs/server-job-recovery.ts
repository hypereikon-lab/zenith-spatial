import type { JobResultV1, JobV1 } from "$lib/shared/contracts/jobs";
import { getRunwayApiKey } from "$lib/server/runway/config";
import { downloadTaskOutputs, waitForRunwayTask } from "$lib/server/runway/http";
import type { ProgressWriter } from "$lib/server/runway/types";
import { httpError } from "$lib/server/runway/errors";
import { runwayResultToJobResult } from "./paid-runway-job";
import type { JobProgressInput, JobStore } from "./job-store";
import { serverJobStore } from "./server-job-store";
import { serverJobOutputStore, type JobOutputStore } from "./job-output-store";
import { cancelPaidJob } from "./cancel-paid-job";

export type RecoverProviderJob = (input: {
  job: JobV1;
  providerTaskId: string;
  apiKey: string;
  onProgress: (event: JobProgressInput) => void;
  signal?: AbortSignal;
  outputStore: JobOutputStore;
}) => Promise<JobResultV1>;

let recoveryStarted = false;

export function ensureServerJobRecovery(): void {
  if (recoveryStarted) return;
  recoveryStarted = true;
  recoverInterruptedJobs();
}

export function recoverInterruptedJobs({
  store = serverJobStore,
  outputStore = serverJobOutputStore,
  apiKey = getRunwayApiKey(),
  recoverProviderJob = recoverRunwayProviderJob,
}: {
  store?: JobStore;
  outputStore?: JobOutputStore;
  apiKey?: string;
  recoverProviderJob?: RecoverProviderJob;
} = {}): void {
  for (const job of store.listJobs()) {
    if (job.status !== "queued" && job.status !== "running") continue;
    const providerTaskId = store.getProviderTaskId(job.id);
    if (job.stage === "Cancelling provider task" && providerTaskId) {
      if (!apiKey) {
        store.appendProgress(job.id, {
          stage: "Recovery paused · Runway secret unavailable",
          progress: job.progress,
          taskId: providerTaskId,
        });
        continue;
      }
      void cancelPaidJob(job.id, { store }).catch((): void => undefined);
      continue;
    }
    if (!providerTaskId) {
      store.failJob(
        job.id,
        httpError(
          503,
          "Zenith restarted before a provider task id was recorded. Automatic resubmission was blocked to prevent duplicate paid work.",
        ),
      );
      continue;
    }
    if (!apiKey) {
      store.appendProgress(job.id, {
        stage: "Recovery paused · Runway secret unavailable",
        progress: job.progress,
        taskId: providerTaskId,
      });
      continue;
    }
    void store.resumeJob(job.id, (onProgress, options) =>
      recoverProviderJob({
        job,
        providerTaskId,
        apiKey,
        onProgress,
        signal: options.signal,
        outputStore,
      }),
    );
  }
}

async function recoverRunwayProviderJob({
  job,
  providerTaskId,
  apiKey,
  onProgress,
  signal,
  outputStore,
}: Parameters<RecoverProviderJob>[0]): Promise<JobResultV1> {
  const writeProgress: ProgressWriter = (event) =>
    onProgress({
      stage: event.stage,
      progress: typeof event.progress === "number" ? event.progress : null,
      taskId: event.taskId || providerTaskId,
      taskStatus: event.taskStatus,
    });
  const completed = await waitForRunwayTask(apiKey, providerTaskId, writeProgress, {
    signal,
    label: "Recovering Runway task",
  });
  const outputs = await downloadTaskOutputs(completed.output || [], writeProgress, 0.92, 0.98, {
    signal,
    outputSink: outputStore.outputSink(job.id),
    fallbackContentType: "image/png",
  });
  if (!job.provenance) throw new Error("Recovered image job is missing its spatial provenance.");
  return runwayResultToJobResult({ ...completed, outputs }, job.provenance);
}
