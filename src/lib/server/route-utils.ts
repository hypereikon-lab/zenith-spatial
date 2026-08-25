import { json } from "@sveltejs/kit";
import { errorMessage, errorStatus } from "$lib/server/runway/errors";
import { readJsonPayload, streamProgressResponse } from "$lib/server/runway/route-response";
import type { ApiPayload, JobOptions, ProgressWriter } from "$lib/server/runway/types";

type JsonRunner = (payload: ApiPayload, signal: AbortSignal) => Promise<unknown>;
type StreamRunner = (payload: ApiPayload, onProgress: ProgressWriter, options: JobOptions) => Promise<unknown>;

export async function jsonPost(request: Request, run: JsonRunner): Promise<Response> {
  try {
    const payload = await readJsonPayload(request);
    return json(await run(payload, request.signal));
  } catch (error) {
    return json({ error: errorMessage(error) }, { status: errorStatus(error) });
  }
}

export async function streamPost(request: Request, run: StreamRunner, fallbackError: string): Promise<Response> {
  try {
    const payload = await readJsonPayload(request);
    return streamProgressResponse(
      (onProgress: ProgressWriter, options: JobOptions) => run(payload, onProgress, options),
      fallbackError,
      request.signal,
    );
  } catch (error) {
    return json({ error: errorMessage(error) }, { status: errorStatus(error) });
  }
}
