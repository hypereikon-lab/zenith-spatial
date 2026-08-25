import { json } from "@sveltejs/kit";
import { jobOutputResponse } from "$lib/server/jobs/job-output-response";
import { serverJobOutputStore } from "$lib/server/jobs/job-output-store";
import { serverJobStore } from "$lib/server/jobs/server-job-store";
import type { RequestHandler } from "./$types";

const respond: RequestHandler = async ({ params, request }) => {
  if (!serverJobStore.getJob(params.jobId)) {
    return json({ error: `Job ${params.jobId} was not found.` }, { status: 404 });
  }
  return jobOutputResponse(params.jobId, params.outputId, request, serverJobOutputStore);
};

export const GET = respond;
export const HEAD = respond;
