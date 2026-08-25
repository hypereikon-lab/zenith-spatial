import { json } from "@sveltejs/kit";
import {
  jobInputArtifactIdsForInput,
  parseCreateJobRequest,
  parseJobResult,
  type CreateJobRequestV1,
  type JobInputArtifactIdsV1,
  type JobOperatorIdV1,
  type JobV1,
} from "$lib/shared/contracts/jobs";
import { errorMessage, errorStatus } from "$lib/server/runway/errors";
import { readJsonPayload } from "$lib/server/runway/route-response";
import { requestRunwayInpaint } from "$lib/server/runway/runway-jobs";
import { validateRunwayInpaintPayload } from "$lib/server/runway/schemas";
import type { ApiPayload, JobOptions, ProgressEvent, ProgressWriter } from "$lib/server/runway/types";
import {
  ImageGenerationProvenanceV1Schema,
  type ImageGenerationProvenanceV1,
} from "$lib/shared/contracts/composition-sequence";
import { serverJobStore } from "./server-job-store";
import type { JobStore } from "./job-store";
import { serverJobOutputStore, type JobOutputStore } from "./job-output-store";
import {
  serverPaidConfirmationGrantStore,
  serverPaidConfirmationInputDigest,
  type PaidConfirmationGrantStore,
} from "./paid-confirmation-grants";

export type RunPaidRunwayJob = (
  payload: ApiPayload,
  onProgress: ProgressWriter,
  options: JobOptions,
) => Promise<unknown>;

export type PaidRunwayJobDependencies = {
  store?: JobStore;
  confirmationGrants?: PaidConfirmationGrantStore;
  runInpaint?: RunPaidRunwayJob;
  outputStore?: JobOutputStore;
};

export function startPaidRunwayJob({
  projectId,
  input,
  inputArtifactIds,
  store = serverJobStore,
  runInpaint = requestRunwayInpaint,
  outputStore = serverJobOutputStore,
}: {
  projectId: string;
  operatorId: JobOperatorIdV1;
  input: ApiPayload;
  inputArtifactIds?: JobInputArtifactIdsV1;
} & PaidRunwayJobDependencies): JobV1 {
  const payload = validateRunwayInpaintPayload(input);
  const provenance = ImageGenerationProvenanceV1Schema.parse(payload.provenance);
  const job = store.createJob({
    projectId,
    operatorId: "inpaint-plate-sketch",
    inputArtifactIds: inputArtifactIds || jobInputArtifactIdsForInput("inpaint-plate-sketch", payload),
    provenance,
  });
  void store.runJob(job.id, async (onProgress, options) => {
    const result = await runInpaint(payload, (event) => onProgress(progressFromRunway(event)), {
      ...options,
      outputSink: outputStore.outputSink(job.id),
    });
    return runwayResultToJobResult(result, provenance);
  });
  return job;
}

export function startPaidRunwayJobFromRequest(
  projectId: string,
  payload: unknown,
  dependencies: PaidRunwayJobDependencies = {},
): JobV1 {
  const request = parseCreateJobRequest(payload);
  const grants = dependencies.confirmationGrants || serverPaidConfirmationGrantStore;
  grants.consume({
    projectId,
    operatorId: request.operatorId,
    inputDigest: serverPaidConfirmationInputDigest({
      version: request.version,
      operatorId: request.operatorId,
      input: request.input,
    }),
    confirmationGrant: request.confirmationGrant,
  });
  return startPaidRunwayJob({
    projectId,
    operatorId: request.operatorId,
    input: requestToPayload(request),
    ...(request.inputArtifactIds ? { inputArtifactIds: request.inputArtifactIds as JobInputArtifactIdsV1 } : {}),
    ...dependencies,
  });
}

export async function createProjectJobResponse(
  request: Request,
  projectId: string,
  dependencies: PaidRunwayJobDependencies = {},
): Promise<Response> {
  try {
    const job = startPaidRunwayJobFromRequest(projectId, await readJsonPayload(request), dependencies);
    return json(job, { status: 202 });
  } catch (error) {
    return json({ error: errorMessage(error) }, { status: errorStatus(error) });
  }
}

function requestToPayload(request: CreateJobRequestV1): ApiPayload {
  return request.input;
}

function progressFromRunway(event: ProgressEvent) {
  return {
    stage: event.stage,
    progress: typeof event.progress === "number" ? event.progress : null,
    taskId: event.taskId,
    taskStatus: event.taskStatus,
  };
}

export function runwayResultToJobResult(result: unknown, provenance: ImageGenerationProvenanceV1) {
  const record = isRecord(result) ? result : {};
  const outputs = Array.isArray(record.outputs)
    ? record.outputs
        .filter(isRecord)
        .map((output) => ({
          kind: "image" as const,
          dataUri: typeof output.dataUri === "string" ? output.dataUri : undefined,
          url: typeof output.url === "string" ? output.url : undefined,
          contentType: typeof output.contentType === "string" ? output.contentType : undefined,
          name: typeof output.name === "string" ? output.name : undefined,
        }))
        .filter((output) => output.dataUri || output.url)
    : [];
  return parseJobResult({
    resultType: "runway-stream-result",
    operatorId: "inpaint-plate-sketch",
    outputArtifactId: "finished-image",
    id: typeof record.id === "string" ? record.id : undefined,
    status: typeof record.status === "string" ? record.status : undefined,
    model: typeof record.model === "string" ? record.model : undefined,
    ratio: typeof record.ratio === "string" ? record.ratio : undefined,
    provenance,
    outputs,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
