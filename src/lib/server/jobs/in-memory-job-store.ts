import {
  JOB_CONTRACT_VERSION,
  jobArtifactsForOperator,
  parseJob,
  parseJobEvent,
  parseJobResult,
  type JobEventV1,
  type JobEventTypeV1,
  type JobResultV1,
  type JobStatusV1,
  type JobV1,
  type PublicJobErrorV1,
} from "$lib/shared/contracts/jobs";
import { errorMessage, errorStatus, httpError } from "$lib/server/runway/errors";
import type {
  CreateJobInput,
  JobProgressInput,
  JobCancellation,
  JobRepository,
  JobRepositoryRecord,
  JobRunner,
  JobStore,
} from "./job-store";

export type { JobProgressInput, JobRunner, JobStore } from "./job-store";
export type InMemoryJobStore = JobStore;

type RuntimeJob = JobV1 & {
  controller: AbortController;
  events: JobEventV1[];
  listeners: Set<(event: JobEventV1) => void>;
  sequence: number;
  providerTaskId: string | null;
  providerTaskStatus: string | null;
  cancellationRequested: boolean;
  preCancellationStage: string | null;
  pendingResult: JobResultV1 | null;
  pendingError: unknown;
  promise?: Promise<void>;
};

type RuntimeJobEventInput = {
  type: JobEventTypeV1;
  status: JobStatusV1;
  stage: string;
  progress: number;
  provider?: "runway";
  providerTaskId?: string;
  providerTaskStatus?: string;
  result?: JobResultV1;
  error?: PublicJobErrorV1;
};

type RuntimeJobPatch = Partial<
  Pick<RuntimeJob, "status" | "stage" | "progress" | "startedAt" | "finishedAt" | "result" | "error">
> & {
  providerTaskId?: string | null;
  providerTaskStatus?: string | null;
};

export type JobStoreOptions = {
  idFactory?: () => string;
  now?: () => string;
  nowEpochMs?: () => number;
  maxJobs?: number;
  terminalRetentionMs?: number;
  repository?: JobRepository;
};

const DEFAULT_MAX_JOBS = 50;

export function createInMemoryJobStore({
  idFactory = randomJobId,
  now = () => new Date().toISOString(),
  nowEpochMs = Date.now,
  maxJobs = DEFAULT_MAX_JOBS,
  terminalRetentionMs = Number.POSITIVE_INFINITY,
  repository,
}: JobStoreOptions = {}): JobStore {
  const jobs = new Map<string, RuntimeJob>();
  for (const record of repository?.load() || []) {
    const job = restoreRuntimeJob(record);
    jobs.set(job.id, job);
  }
  pruneTerminalJobs();

  function createJob({ projectId, operatorId, inputArtifactIds, provenance }: CreateJobInput): JobV1 {
    const artifacts = jobArtifactsForOperator(operatorId);
    const job: RuntimeJob = {
      version: JOB_CONTRACT_VERSION,
      id: idFactory(),
      projectId,
      operatorId,
      status: "queued",
      stage: "Queued",
      progress: 0,
      inputArtifactIds: inputArtifactIds || artifacts.inputArtifactIds,
      outputArtifactIds: artifacts.outputArtifactIds,
      provenance,
      createdAt: now(),
      controller: new AbortController(),
      events: [],
      listeners: new Set(),
      sequence: 0,
      providerTaskId: null,
      providerTaskStatus: null,
      cancellationRequested: false,
      preCancellationStage: null,
      pendingResult: null,
      pendingError: null,
    };
    const metadata = publicJob(job);
    repository?.create(metadata);
    jobs.set(job.id, job);
    try {
      commitTransition(
        job,
        {},
        {
          type: "queued",
          status: "queued",
          stage: "Queued",
          progress: 0,
        },
      );
    } catch (error) {
      jobs.delete(job.id);
      repository?.delete(job.id);
      throw error;
    }
    pruneTerminalJobs();
    return publicJob(job);
  }

  function runJob(jobId: string, runner: JobRunner): Promise<void> {
    const job = requireJob(jobId);
    if (job.status !== "queued") {
      throw httpError(409, `Job ${jobId} is already ${job.status}.`);
    }
    const startedAt = now();
    commitTransition(
      job,
      { status: "running", stage: "Starting", progress: 0.01, startedAt },
      {
        type: "started",
        status: "running",
        stage: "Starting",
        progress: 0.01,
      },
    );
    return executeRunner(job, runner);
  }

  function resumeJob(jobId: string, runner: JobRunner): Promise<void> {
    const job = requireJob(jobId);
    if (job.status !== "running") {
      throw httpError(409, `Job ${jobId} cannot resume from ${job.status}.`);
    }
    commitTransition(
      job,
      { stage: "Reconnecting to provider", status: "running" },
      {
        type: "progress",
        status: "running",
        stage: "Reconnecting to provider",
        progress: job.progress,
        provider: "runway",
        providerTaskId: job.providerTaskId || undefined,
        providerTaskStatus: job.providerTaskStatus || undefined,
      },
    );
    return executeRunner(job, runner);
  }

  function executeRunner(job: RuntimeJob, runner: JobRunner): Promise<void> {
    const promise = Promise.resolve()
      .then(() =>
        runner((event) => appendProgress(job.id, event), {
          signal: job.controller.signal,
        }),
      )
      .then((result) => {
        if (isTerminal(job.status)) return;
        if (job.cancellationRequested) {
          job.pendingResult = result;
          return;
        }
        completeJob(job.id, result);
      })
      .catch((error) => {
        if (isTerminal(job.status)) return;
        if (job.cancellationRequested) {
          job.pendingError = error;
          return;
        }
        if (errorStatus(error) === 499) cancelJob(job.id, error);
        else failJob(job.id, error);
      });
    job.promise = promise;
    return promise;
  }

  function appendProgress(jobId: string, event: JobProgressInput): JobV1 | null {
    const job = jobs.get(jobId);
    if (!job || isTerminal(job.status)) return job ? publicJob(job) : null;
    const stage = job.cancellationRequested ? "Cancelling provider task" : event.stage || job.stage || "Running";
    const progress = job.cancellationRequested ? job.progress : normalizeProgress(event.progress ?? job.progress);
    const providerTaskId = typeof event.taskId === "string" ? event.taskId : job.providerTaskId;
    const providerTaskStatus = typeof event.taskStatus === "string" ? event.taskStatus : job.providerTaskStatus;
    commitTransition(
      job,
      { status: "running", stage, progress, providerTaskId, providerTaskStatus },
      {
        type: "progress",
        status: "running",
        stage,
        progress,
        provider: "runway",
        providerTaskId: providerTaskId || undefined,
        providerTaskStatus: providerTaskStatus || undefined,
      },
    );
    return publicJob(job);
  }

  function completeJob(jobId: string, result: JobResultV1): JobV1 | null {
    const job = jobs.get(jobId);
    if (!job || isTerminal(job.status)) return job ? publicJob(job) : null;
    const parsedResult = parseJobResult(result);
    const expected = jobArtifactsForOperator(job.operatorId);
    if (parsedResult.operatorId !== job.operatorId) {
      throw httpError(500, `Job ${jobId} returned result for ${parsedResult.operatorId}, expected ${job.operatorId}.`);
    }
    if (parsedResult.outputArtifactId !== expected.outputArtifactId) {
      throw httpError(
        500,
        `Job ${jobId} returned ${parsedResult.outputArtifactId}, expected ${expected.outputArtifactId}.`,
      );
    }
    if (
      job.provenance &&
      (!parsedResult.provenance || JSON.stringify(parsedResult.provenance) !== JSON.stringify(job.provenance))
    ) {
      throw httpError(500, `Job ${jobId} returned image provenance that does not match its pinned input.`);
    }
    const finishedAt = now();
    commitTransition(
      job,
      { status: "succeeded", stage: "Complete", progress: 1, finishedAt, result: parsedResult },
      {
        type: "complete",
        status: "succeeded",
        stage: "Complete",
        progress: 1,
        result: parsedResult,
      },
    );
    return publicJob(job);
  }

  function failJob(jobId: string, error: unknown): JobV1 | null {
    const job = jobs.get(jobId);
    if (!job || isTerminal(job.status)) return job ? publicJob(job) : null;
    const publicError = publicJobError(error);
    const finishedAt = now();
    commitTransition(
      job,
      { status: "failed", stage: "Failed", progress: 1, finishedAt, error: publicError },
      {
        type: "error",
        status: "failed",
        stage: "Failed",
        progress: 1,
        error: publicError,
      },
    );
    return publicJob(job);
  }

  function cancelJob(jobId: string, reason: unknown = httpError(499, "Job was cancelled.")): JobV1 | null {
    const cancellation = beginCancellation(jobId);
    if (!cancellation) return null;
    return finishCancellation(jobId, reason);
  }

  function beginCancellation(jobId: string): JobCancellation | null {
    const job = jobs.get(jobId);
    if (!job) return null;
    if (isTerminal(job.status) || job.cancellationRequested) {
      return { job: publicJob(job), providerTaskId: job.providerTaskId };
    }
    const preCancellationStage = job.stage;
    commitTransition(
      job,
      { status: "running", stage: "Cancelling provider task" },
      {
        type: "progress",
        status: "running",
        stage: "Cancelling provider task",
        progress: job.progress,
        provider: "runway",
        providerTaskId: job.providerTaskId || undefined,
        providerTaskStatus: job.providerTaskStatus || undefined,
      },
    );
    job.cancellationRequested = true;
    job.preCancellationStage = preCancellationStage;
    return { job: publicJob(job), providerTaskId: job.providerTaskId };
  }

  function finishCancellation(jobId: string, reason: unknown = httpError(499, "Job was cancelled.")): JobV1 | null {
    const job = jobs.get(jobId);
    if (!job || isTerminal(job.status)) return job ? publicJob(job) : null;
    const publicError = publicJobError(reason, "cancelled");
    const abortReason = reason instanceof Error ? reason : httpError(499, "Job was cancelled.");
    const finishedAt = now();
    commitTransition(
      job,
      { status: "cancelled", stage: "Cancelled", progress: 1, finishedAt, error: publicError },
      {
        type: "cancelled",
        status: "cancelled",
        stage: "Cancelled",
        progress: 1,
        error: publicError,
      },
    );
    job.controller.abort(abortReason);
    job.cancellationRequested = false;
    job.preCancellationStage = null;
    job.pendingResult = null;
    job.pendingError = null;
    return publicJob(job);
  }

  function rejectCancellation(jobId: string, error: unknown): JobV1 | null {
    const job = jobs.get(jobId);
    if (!job || isTerminal(job.status)) return job ? publicJob(job) : null;
    const pendingResult = job.pendingResult;
    const pendingError = job.pendingError;
    const stage = `Cancellation failed · ${errorMessage(error)} · continuing ${job.preCancellationStage || "job"}`;
    job.cancellationRequested = false;
    job.preCancellationStage = null;
    job.pendingResult = null;
    job.pendingError = null;
    if (pendingResult) return completeJob(jobId, pendingResult);
    if (pendingError) {
      if (errorStatus(pendingError) === 499) return cancelJob(jobId, pendingError);
      return failJob(jobId, pendingError);
    }
    commitTransition(
      job,
      { status: "running", stage },
      {
        type: "progress",
        status: "running",
        stage,
        progress: job.progress,
        provider: "runway",
        providerTaskId: job.providerTaskId || undefined,
        providerTaskStatus: job.providerTaskStatus || undefined,
      },
    );
    return publicJob(job);
  }

  function getJob(jobId: string): JobV1 | null {
    const job = jobs.get(jobId);
    return job ? publicJob(job) : null;
  }

  function listJobs(): JobV1[] {
    return [...jobs.values()].sort((left, right) => right.createdAt.localeCompare(left.createdAt)).map(publicJob);
  }

  function getEvents(jobId: string): JobEventV1[] | null {
    const job = jobs.get(jobId);
    return job ? cloneJson(job.events) : null;
  }

  function getSignal(jobId: string): AbortSignal | null {
    return jobs.get(jobId)?.controller.signal ?? null;
  }

  function getProviderTaskId(jobId: string): string | null {
    return jobs.get(jobId)?.providerTaskId ?? null;
  }

  function subscribeEvents(
    jobId: string,
    listener: (event: JobEventV1) => void,
    { replay = false }: { replay?: boolean } = {},
  ): (() => void) | null {
    const job = jobs.get(jobId);
    if (!job) return null;
    job.listeners.add(listener);
    if (replay) {
      for (const event of job.events) listener(cloneJson(event));
    }
    return () => {
      job.listeners.delete(listener);
    };
  }

  function clear(): void {
    for (const [jobId, job] of jobs) {
      if (!job.controller.signal.aborted) job.controller.abort(httpError(499, "Job store was cleared."));
      repository?.delete(jobId);
    }
    jobs.clear();
  }

  function requireJob(jobId: string): RuntimeJob {
    const job = jobs.get(jobId);
    if (!job) throw httpError(404, `Job ${jobId} was not found.`);
    return job;
  }

  function commitTransition(job: RuntimeJob, patch: RuntimeJobPatch, event: RuntimeJobEventInput): JobEventV1 {
    const fullEvent = parseJobEvent({
      version: JOB_CONTRACT_VERSION,
      id: `${job.id}-event-${job.sequence + 1}`,
      jobId: job.id,
      sequence: job.sequence + 1,
      createdAt: now(),
      ...stripUndefined(event),
    });
    repository?.appendEvent(fullEvent);
    Object.assign(job, patch);
    job.sequence = fullEvent.sequence;
    job.events.push(fullEvent);
    for (const listener of job.listeners) listener(cloneJson(fullEvent));
    return fullEvent;
  }

  function pruneTerminalJobs(): void {
    const terminal = [...jobs.values()]
      .filter((job) => isTerminal(job.status))
      .sort((left, right) => (left.finishedAt || left.createdAt).localeCompare(right.finishedAt || right.createdAt));
    for (const job of terminal) {
      const finishedAt = Date.parse(job.finishedAt || job.createdAt);
      const expired = Number.isFinite(finishedAt) && nowEpochMs() - finishedAt > terminalRetentionMs;
      const overCapacity = jobs.size > maxJobs;
      if (!expired && !overCapacity) continue;
      jobs.delete(job.id);
      repository?.delete(job.id);
    }
  }

  return {
    createJob,
    runJob,
    resumeJob,
    appendProgress,
    completeJob,
    failJob,
    cancelJob,
    beginCancellation,
    finishCancellation,
    rejectCancellation,
    getJob,
    getEvents,
    getSignal,
    getProviderTaskId,
    listJobs,
    clear,
    subscribeEvents,
  };
}

export function isTerminalJobStatus(status: JobStatusV1): boolean {
  return isTerminal(status);
}

export function publicJobError(error: unknown, codeOverride?: PublicJobErrorV1["code"]): PublicJobErrorV1 {
  const status = errorStatus(error);
  return {
    message: errorMessage(error),
    status,
    code: codeOverride || codeForStatus(status),
    provider: "zenith",
  };
}

function restoreRuntimeJob({ job: metadata, events }: JobRepositoryRecord): RuntimeJob {
  const job: RuntimeJob = {
    ...parseJob(metadata),
    controller: new AbortController(),
    events: [],
    listeners: new Set(),
    sequence: 0,
    providerTaskId: null,
    providerTaskStatus: null,
    cancellationRequested: false,
    preCancellationStage: null,
    pendingResult: null,
    pendingError: null,
  };
  for (const event of events) applyRestoredEvent(job, parseJobEvent(event));
  return job;
}

function applyRestoredEvent(job: RuntimeJob, event: JobEventV1): void {
  if (event.jobId !== job.id || event.sequence !== job.sequence + 1) {
    throw new Error(`Job ${job.id} contains a non-contiguous event journal.`);
  }
  job.status = event.status;
  job.stage = event.stage;
  job.progress = event.progress;
  if (event.type === "started") job.startedAt = event.createdAt;
  if (event.type === "progress") {
    job.providerTaskId = event.providerTaskId || job.providerTaskId;
    job.providerTaskStatus = event.providerTaskStatus || job.providerTaskStatus;
  }
  if (event.type === "complete") {
    job.result = event.result;
    job.finishedAt = event.createdAt;
  }
  if (event.type === "error" || event.type === "cancelled") {
    job.error = event.error;
    job.finishedAt = event.createdAt;
  }
  job.sequence = event.sequence;
  job.events.push(event);
}

function publicJob(job: RuntimeJob): JobV1 {
  return parseJob(
    stripUndefined({
      version: job.version,
      id: job.id,
      projectId: job.projectId,
      operatorId: job.operatorId,
      status: job.status,
      stage: job.stage,
      progress: job.progress,
      inputArtifactIds: job.inputArtifactIds,
      outputArtifactIds: job.outputArtifactIds,
      provenance: job.provenance,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      result: job.result,
      error: job.error,
    }),
  );
}

function randomJobId(): string {
  return `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeProgress(value: number | null | undefined): number {
  const progress = Number(value);
  if (!Number.isFinite(progress)) return 0;
  return Math.max(0, Math.min(1, progress));
}

function isTerminal(status: JobStatusV1): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}

function codeForStatus(status: number): PublicJobErrorV1["code"] {
  if (status === 400) return "invalid_input";
  if (status === 401) return "missing_secret";
  if (status === 499) return "cancelled";
  if (status === 504) return "timeout";
  if (status >= 500) return "upstream_failed";
  return "server_error";
}

function stripUndefined<T>(value: T): T {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => stripUndefined(item)) as T;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .map(([key, entryValue]) => [key, stripUndefined(entryValue)]);
  return Object.fromEntries(entries) as T;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
