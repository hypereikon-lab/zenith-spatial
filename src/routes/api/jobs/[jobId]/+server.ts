import { json } from "@sveltejs/kit";
import { serverJobStore } from "$lib/server/jobs/server-job-store";
import { cancelPaidJob } from "$lib/server/jobs/cancel-paid-job";
import { errorMessage, errorStatus } from "$lib/server/runway/errors";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ params }) => {
  const job = serverJobStore.getJob(params.jobId);
  const headers = { "cache-control": "no-store" };
  return job ? json(job, { headers }) : json({ error: `Job ${params.jobId} was not found.` }, { status: 404, headers });
};

export const DELETE: RequestHandler = async ({ params, request }) => {
  try {
    const job = await cancelPaidJob(params.jobId, { signal: request.signal });
    return job ? json(job) : json({ error: `Job ${params.jobId} was not found.` }, { status: 404 });
  } catch (error) {
    return json({ error: errorMessage(error) }, { status: errorStatus(error) });
  }
};
