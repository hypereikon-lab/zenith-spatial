import { json } from "@sveltejs/kit";
import { parsePaidConfirmationGrantRequest } from "$lib/shared/contracts/jobs";
import { serverPaidConfirmationGrantStore } from "$lib/server/jobs/paid-confirmation-grants";
import { errorMessage, errorStatus } from "$lib/server/runway/errors";
import { readJsonPayload } from "$lib/server/runway/route-response";
import type { RequestHandler } from "./$types";

export const POST: RequestHandler = async ({ params, request }) => {
  try {
    const payload = parsePaidConfirmationGrantRequest(await readJsonPayload(request));
    return json(
      serverPaidConfirmationGrantStore.issue({
        projectId: params.projectId,
        operatorId: payload.operatorId,
        inputDigest: payload.inputDigest,
      }),
      { status: 201 },
    );
  } catch (error) {
    return json({ error: errorMessage(error) }, { status: errorStatus(error) });
  }
};
