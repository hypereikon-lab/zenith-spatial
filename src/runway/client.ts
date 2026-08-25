import { readProgressStream } from "./progress-stream.js";
import {
  JOB_CONTRACT_VERSION,
  type JobInputArtifactIdsV1,
  type JobOperatorIdV1,
  type JobV1,
} from "../lib/shared/contracts/jobs.js";
import { paidConfirmationInputDigest } from "../lib/shared/contracts/paid-confirmation.js";
import type { ImageGenerationProvenanceV1 } from "../lib/shared/contracts/composition-sequence.js";

const ROUTES = {
  status: "/api/runway/status",
  projectJobs: "/api/projects/local/jobs",
  paidConfirmations: "/api/projects/local/paid-confirmations",
};

type RunwayRequestOptions = {
  signal?: AbortSignal;
  onProgress?: (stage: string, progress: number) => void;
  onJobCreated?: (job: JobV1) => void;
  confirmationGrant?: string;
  inputArtifactIds?: JobInputArtifactIdsV1;
};

type JsonPayload = Record<string, unknown>;
export type RunwayOutput = {
  dataUri?: string;
  url?: string;
  contentType?: string;
  name?: string;
  duration?: number;
  [key: string]: unknown;
};
export type RunwayStreamResult = {
  outputs?: RunwayOutput[];
  model?: string;
  duration?: number;
  prompt?: string;
  provenance?: ImageGenerationProvenanceV1;
  [key: string]: unknown;
};

export async function requestRunwayStatus(): Promise<unknown | null> {
  const response = await fetch(ROUTES.status);
  if (!response.ok) return null;
  return response.json();
}

export async function requestRunwayJob(
  operatorId: JobOperatorIdV1,
  payload: JsonPayload,
  options: RunwayRequestOptions = {},
): Promise<RunwayStreamResult> {
  if (!options.confirmationGrant) {
    throw new Error("A server-issued confirmation is required before creating a paid job.");
  }
  const createResponse = await postRunwayJson(
    ROUTES.projectJobs,
    {
      version: JOB_CONTRACT_VERSION,
      operatorId,
      confirmationGrant: options.confirmationGrant,
      ...(options.inputArtifactIds ? { inputArtifactIds: options.inputArtifactIds } : {}),
      input: payload,
    },
    options.signal,
  );
  if (!createResponse.ok) {
    const result = (await createResponse.json().catch((): null => null)) as { error?: string } | null;
    throw new Error(result?.error || `Runway job request failed (${createResponse.status})`);
  }

  const job = (await createResponse.json()) as JobV1;
  options.onJobCreated?.(job);
  const eventsResponse = await fetch(`/api/jobs/${encodeURIComponent(job.id)}/events`, {
    signal: options.signal,
  });
  return readProgressStream(eventsResponse, {
    errorPrefix: "Runway job failed",
    emptyMessage: "Runway job event stream closed before returning a result.",
    defaultStage: job.stage || "Running",
    onProgress: options.onProgress,
  }) as Promise<RunwayStreamResult>;
}

export async function requestPaidConfirmationGrant(
  operatorId: JobOperatorIdV1,
  input: JsonPayload,
  options: { signal?: AbortSignal } = {},
): Promise<string> {
  const inputDigest = await paidConfirmationInputDigest({
    version: JOB_CONTRACT_VERSION,
    operatorId,
    input,
  });
  const response = await postRunwayJson(
    ROUTES.paidConfirmations,
    { version: JOB_CONTRACT_VERSION, operatorId, inputDigest },
    options.signal,
  );
  const result = (await response.json().catch((): null => null)) as {
    confirmationGrant?: string;
    error?: string;
  } | null;
  if (!response.ok || !result?.confirmationGrant) {
    throw new Error(result?.error || `Paid confirmation request failed (${response.status})`);
  }
  return result.confirmationGrant;
}

export async function requestRunwayJobStatus(jobId: string, options: { signal?: AbortSignal } = {}): Promise<JobV1> {
  const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`, { signal: options.signal });
  return readJobResponse(response, "Runway job status request failed");
}

export async function cancelRunwayJob(jobId: string, options: { signal?: AbortSignal } = {}): Promise<JobV1> {
  const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`, {
    method: "DELETE",
    signal: options.signal,
  });
  return readJobResponse(response, "Runway job cancellation failed");
}

async function postRunwayJson(route: string, payload: JsonPayload, signal?: AbortSignal): Promise<Response> {
  return fetch(route, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });
}

async function readJobResponse(response: Response, fallback: string): Promise<JobV1> {
  const result = (await response.json().catch((): null => null)) as (JobV1 & { error?: string }) | null;
  if (!response.ok) {
    throw new Error(result?.error || `${fallback} (${response.status})`);
  }
  if (!result) throw new Error(`${fallback}: empty response.`);
  return result;
}
