import { json } from "@sveltejs/kit";
import { jobEventStreamResponse } from "$lib/server/jobs/job-event-stream";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ params, request }) => {
  const response = jobEventStreamResponse(params.jobId, { signal: request.signal });
  return response || json({ error: `Job ${params.jobId} was not found.` }, { status: 404 });
};
