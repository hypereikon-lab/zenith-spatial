import type {
  JobEventV1,
  JobInputArtifactIdsV1,
  JobOperatorIdV1,
  JobResultV1,
  JobV1,
} from "$lib/shared/contracts/jobs";
import type { ImageGenerationProvenanceV1 } from "$lib/shared/contracts/composition-sequence";

export type CreateJobInput = {
  projectId: string;
  operatorId: JobOperatorIdV1;
  inputArtifactIds?: JobInputArtifactIdsV1;
  provenance?: ImageGenerationProvenanceV1;
};

export type JobProgressInput = {
  stage?: string;
  progress?: number | null;
  taskId?: unknown;
  taskStatus?: unknown;
};

export type JobRunner = (
  onProgress: (event: JobProgressInput) => void,
  options: { signal?: AbortSignal },
) => Promise<JobResultV1>;

export type JobRepositoryRecord = {
  job: JobV1;
  events: JobEventV1[];
};

export interface JobRepository {
  load(): JobRepositoryRecord[];
  create(job: JobV1): void;
  appendEvent(event: JobEventV1): void;
  delete(jobId: string): void;
}

export type JobCancellation = {
  job: JobV1;
  providerTaskId: string | null;
};

export interface JobStore {
  createJob(input: CreateJobInput): JobV1;
  runJob(jobId: string, runner: JobRunner): Promise<void>;
  resumeJob(jobId: string, runner: JobRunner): Promise<void>;
  appendProgress(jobId: string, event: JobProgressInput): JobV1 | null;
  completeJob(jobId: string, result: JobResultV1): JobV1 | null;
  failJob(jobId: string, error: unknown): JobV1 | null;
  cancelJob(jobId: string, reason?: unknown): JobV1 | null;
  beginCancellation(jobId: string): JobCancellation | null;
  finishCancellation(jobId: string, reason?: unknown): JobV1 | null;
  rejectCancellation(jobId: string, error: unknown): JobV1 | null;
  getJob(jobId: string): JobV1 | null;
  getEvents(jobId: string): JobEventV1[] | null;
  getSignal(jobId: string): AbortSignal | null;
  getProviderTaskId(jobId: string): string | null;
  listJobs(): JobV1[];
  clear(): void;
  subscribeEvents(
    jobId: string,
    listener: (event: JobEventV1) => void,
    options?: { replay?: boolean },
  ): (() => void) | null;
}
