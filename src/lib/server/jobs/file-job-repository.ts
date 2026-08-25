import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { parseJob, parseJobEvent, type JobEventV1, type JobV1 } from "$lib/shared/contracts/jobs";
import type { JobRepository, JobRepositoryRecord } from "./job-store";

const SAFE_JOB_ID = /^[a-zA-Z0-9_-]{1,160}$/;
const EVENT_FILE = /^(\d{12})\.json$/;

export type FileJobRepositoryOptions = {
  rootDir: string;
  onLoadError?: (jobId: string, error: unknown) => void;
};

export function createFileJobRepository({
  rootDir,
  onLoadError = defaultLoadError,
}: FileJobRepositoryOptions): JobRepository {
  function load(): JobRepositoryRecord[] {
    if (!existsSync(rootDir)) return [];
    const records: JobRepositoryRecord[] = [];
    for (const entry of readdirSync(rootDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || !SAFE_JOB_ID.test(entry.name)) continue;
      try {
        records.push(readRecord(entry.name));
      } catch (error) {
        onLoadError(entry.name, error);
      }
    }
    return records;
  }

  function create(job: JobV1): void {
    const parsed = parseJob(job);
    assertSafeJobId(parsed.id);
    if (parsed.status !== "queued") throw new Error("Durable job metadata must begin in queued state.");
    const directory = jobDirectory(parsed.id);
    if (existsSync(directory)) throw new Error(`Durable job ${parsed.id} already exists.`);
    mkdirSync(eventDirectory(parsed.id), { recursive: true, mode: 0o700 });
    try {
      atomicWriteJson(metadataPath(parsed.id), parsed);
    } catch (error) {
      rmSync(directory, { recursive: true, force: true });
      throw error;
    }
  }

  function appendEvent(event: JobEventV1): void {
    const parsed = parseJobEvent(event);
    assertSafeJobId(parsed.jobId);
    if (!existsSync(metadataPath(parsed.jobId))) {
      throw new Error(`Durable job ${parsed.jobId} metadata does not exist.`);
    }
    const path = eventPath(parsed.jobId, parsed.sequence);
    if (existsSync(path)) throw new Error(`Durable job ${parsed.jobId} event ${parsed.sequence} already exists.`);
    atomicWriteJson(path, parsed);
  }

  function deleteJob(jobId: string): void {
    assertSafeJobId(jobId);
    rmSync(jobDirectory(jobId), { recursive: true, force: true });
  }

  function readRecord(jobId: string): JobRepositoryRecord {
    const job = parseJob(readJson(metadataPath(jobId)));
    if (job.id !== jobId) throw new Error(`Durable job directory ${jobId} contains metadata for ${job.id}.`);
    const events: JobEventV1[] = [];
    const directory = eventDirectory(jobId);
    if (!existsSync(directory)) throw new Error(`Durable job ${jobId} has no event journal.`);
    const files = readdirSync(directory)
      .filter((name) => EVENT_FILE.test(name))
      .sort();
    for (const [index, name] of files.entries()) {
      const match = EVENT_FILE.exec(name);
      const expectedSequence = index + 1;
      if (!match || Number(match[1]) !== expectedSequence) {
        throw new Error(`Durable job ${jobId} event journal is not contiguous.`);
      }
      const event = parseJobEvent(readJson(join(directory, name)));
      if (event.jobId !== jobId || event.sequence !== expectedSequence) {
        throw new Error(`Durable job ${jobId} event ${name} has mismatched identity.`);
      }
      events.push(event);
    }
    if (!events.length || events[0].type !== "queued") {
      throw new Error(`Durable job ${jobId} has no queued event.`);
    }
    return { job, events };
  }

  function jobDirectory(jobId: string): string {
    return join(rootDir, jobId);
  }

  function metadataPath(jobId: string): string {
    return join(jobDirectory(jobId), "metadata.json");
  }

  function eventDirectory(jobId: string): string {
    return join(jobDirectory(jobId), "events");
  }

  function eventPath(jobId: string, sequence: number): string {
    return join(eventDirectory(jobId), `${String(sequence).padStart(12, "0")}.json`);
  }

  return { load, create, appendEvent, delete: deleteJob };
}

function atomicWriteJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`;
  let descriptor: number | null = null;
  try {
    descriptor = openSync(temporary, "wx", 0o600);
    writeFileSync(descriptor, `${JSON.stringify(value)}\n`, "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = null;
    renameSync(temporary, path);
    syncDirectory(dirname(path));
  } catch (error) {
    if (descriptor !== null) closeSync(descriptor);
    rmSync(temporary, { force: true });
    throw error;
  }
}

function syncDirectory(path: string): void {
  let descriptor: number | null = null;
  try {
    descriptor = openSync(path, "r");
    fsyncSync(descriptor);
  } catch {
    // Some filesystems do not permit fsync on directories; file data is still fsynced before rename.
  } finally {
    if (descriptor !== null) closeSync(descriptor);
  }
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function assertSafeJobId(jobId: string): void {
  if (!SAFE_JOB_ID.test(jobId)) throw new Error(`Unsafe durable job id ${jobId}.`);
}

function defaultLoadError(jobId: string, error: unknown): void {
  console.error(`Zenith skipped corrupt durable job ${jobId}.`, error);
}
