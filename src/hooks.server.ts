import type { Handle } from "@sveltejs/kit";
import { ensureServerJobRecovery } from "$lib/server/jobs/server-job-recovery";

export const handle: Handle = async ({ event, resolve }) => {
  ensureServerJobRecovery();
  return resolve(event);
};
