import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { ZENITH_JOB_STORE_DIR } from "$lib/server/runway/config";
import type { RunwayOutput, RunwayOutputSink, RunwayOutputSinkInput } from "$lib/server/runway/types";

const SAFE_ID = /^[a-zA-Z0-9_-]{1,160}$/;
const OUTPUT_METADATA_VERSION = 1;

export type StoredJobOutput = {
  id: string;
  path: string;
  contentType: string;
  byteLength: number;
  name: string;
  sha256: string;
};

type StoredJobOutputMetadata = Omit<StoredJobOutput, "path"> & {
  version: typeof OUTPUT_METADATA_VERSION;
  extension: string;
};

export interface JobOutputStore {
  outputSink(jobId: string): RunwayOutputSink;
  store(jobId: string, input: RunwayOutputSinkInput): Promise<RunwayOutput>;
  get(jobId: string, outputId: string): Promise<StoredJobOutput | null>;
}

export function createFileJobOutputStore({ rootDir }: { rootDir: string }): JobOutputStore {
  function outputSink(jobId: string): RunwayOutputSink {
    return (input) => store(jobId, input);
  }

  async function store(jobId: string, input: RunwayOutputSinkInput): Promise<RunwayOutput> {
    assertSafeId(jobId, "job");
    const contentType = normalizeContentType(input.contentType);
    const directory = outputDirectory(rootDir, jobId);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temporary = join(
      directory,
      `.output-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`,
    );
    const { sha256, byteLength } = await writeStreamToFile(temporary, input.body);
    if (input.contentLength !== undefined && byteLength !== input.contentLength) {
      await rm(temporary, { force: true });
      throw new Error(`Provider output ended at ${byteLength} bytes; expected ${input.contentLength}.`);
    }
    const extension = extensionForContentType(contentType);
    const id = `output-${input.index + 1}-${sha256.slice(0, 16)}-${extension}`;
    const name = `zenith-${id}.${extension}`;
    const metadata: StoredJobOutputMetadata = {
      version: OUTPUT_METADATA_VERSION,
      id,
      contentType,
      byteLength,
      name,
      sha256,
      extension,
    };
    await installContentAddressedFile(temporary, mediaPath(directory, id, extension));
    await atomicWriteBytes(metadataPath(directory, id), new TextEncoder().encode(`${JSON.stringify(metadata)}\n`));
    return {
      url: `/api/jobs/${encodeURIComponent(jobId)}/outputs/${encodeURIComponent(id)}`,
      contentType,
      name,
    };
  }

  async function get(jobId: string, outputId: string): Promise<StoredJobOutput | null> {
    assertSafeId(jobId, "job");
    assertSafeId(outputId, "output");
    const directory = outputDirectory(rootDir, jobId);
    let value: unknown;
    try {
      value = JSON.parse(await readFile(metadataPath(directory, outputId), "utf8")) as unknown;
    } catch (error) {
      if (isMissingFile(error)) return null;
      throw error;
    }
    const metadata = parseMetadata(value, outputId);
    const path = mediaPath(directory, metadata.id, metadata.extension);
    try {
      const file = await stat(path);
      if (!file.isFile() || file.size !== metadata.byteLength) {
        throw new Error(`Stored job output ${outputId} does not match its metadata.`);
      }
    } catch (error) {
      if (isMissingFile(error)) return null;
      throw error;
    }
    return {
      id: metadata.id,
      path,
      contentType: metadata.contentType,
      byteLength: metadata.byteLength,
      name: metadata.name,
      sha256: metadata.sha256,
    };
  }

  return { outputSink, store, get };
}

async function writeStreamToFile(
  path: string,
  body: ReadableStream<Uint8Array>,
): Promise<{ sha256: string; byteLength: number }> {
  const handle = await open(path, "wx", 0o600);
  const hash = createHash("sha256");
  const reader = body.getReader();
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      await handle.write(value);
      hash.update(value);
      byteLength += value.byteLength;
    }
    await handle.sync();
  } catch (error) {
    await reader.cancel(error).catch((): void => undefined);
    await handle.close();
    await rm(path, { force: true });
    throw error;
  }
  await handle.close();
  return { sha256: hash.digest("hex"), byteLength };
}

async function installContentAddressedFile(temporary: string, destination: string): Promise<void> {
  try {
    await access(destination, constants.F_OK);
    await rm(temporary, { force: true });
    return;
  } catch {
    // Install the newly streamed content below.
  }
  try {
    await rename(temporary, destination);
  } catch (error) {
    await rm(temporary, { force: true });
    if (!isDestinationExists(error)) throw error;
  }
}

async function atomicWriteBytes(path: string, bytes: Uint8Array): Promise<void> {
  try {
    await access(path, constants.F_OK);
    return;
  } catch {
    // The content-addressed output does not exist yet.
  }
  const temporary = `${path}.${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    if (!isDestinationExists(error)) throw error;
  }
}

function parseMetadata(value: unknown, expectedId: string): StoredJobOutputMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Stored job output metadata is invalid.");
  const item = value as Record<string, unknown>;
  if (
    item.version !== OUTPUT_METADATA_VERSION ||
    item.id !== expectedId ||
    typeof item.contentType !== "string" ||
    typeof item.byteLength !== "number" ||
    !Number.isSafeInteger(item.byteLength) ||
    item.byteLength < 0 ||
    typeof item.name !== "string" ||
    typeof item.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(item.sha256) ||
    typeof item.extension !== "string" ||
    !/^[a-z0-9]{1,8}$/.test(item.extension)
  ) {
    throw new Error("Stored job output metadata is invalid.");
  }
  return item as StoredJobOutputMetadata;
}

function outputDirectory(rootDir: string, jobId: string): string {
  return join(rootDir, jobId, "outputs");
}

function mediaPath(directory: string, id: string, extension: string): string {
  return join(directory, `${id}.${extension}`);
}

function metadataPath(directory: string, id: string): string {
  return join(directory, `${id}.json`);
}

function normalizeContentType(value: string): string {
  const contentType = value.split(";")[0].trim().toLowerCase();
  return /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(contentType) ? contentType : "application/octet-stream";
}

function extensionForContentType(contentType: string): string {
  switch (contentType) {
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "image/webp":
      return "webp";
    default:
      return "bin";
  }
}

function assertSafeId(value: string, label: string): void {
  if (!SAFE_ID.test(value)) throw new Error(`Unsafe ${label} output id.`);
}

function isMissingFile(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === "ENOENT";
}

function isDestinationExists(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === "EEXIST";
}

export const serverJobOutputStore = createFileJobOutputStore({
  rootDir: ZENITH_JOB_STORE_DIR,
});
