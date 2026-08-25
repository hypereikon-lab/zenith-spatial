import { ZENITH_JOB_MAX_RECORDS, ZENITH_JOB_RETENTION_MS, ZENITH_JOB_STORE_DIR } from "$lib/server/runway/config";
import { createFileJobRepository } from "./file-job-repository";
import { createInMemoryJobStore } from "./in-memory-job-store";
import type { JobStore } from "./job-store";

let runtimeStore: JobStore | undefined;

function getRuntimeStore(): JobStore {
  if (runtimeStore) return runtimeStore;
  const durableRepository =
    process.env.NODE_ENV === "test" ? undefined : createFileJobRepository({ rootDir: ZENITH_JOB_STORE_DIR });
  runtimeStore = createInMemoryJobStore({
    repository: durableRepository,
    maxJobs: ZENITH_JOB_MAX_RECORDS,
    terminalRetentionMs: ZENITH_JOB_RETENTION_MS,
  });
  return runtimeStore;
}

/**
 * Lazily delegates to the process-wide runtime store. Importing server routes during
 * SvelteKit build analysis must not read or mutate the operator's durable job data.
 */
export const serverJobStore: JobStore = new Proxy({} as JobStore, {
  get(_target, property) {
    const store = getRuntimeStore();
    const value = Reflect.get(store, property, store);
    return typeof value === "function" ? value.bind(store) : value;
  },
});
