import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";

const AGENT_BROWSER_PACKAGE = "agent-browser@0.36.0";

export function normalizeFulldomeComposeJob(raw) {
  if (!raw || typeof raw !== "object") throw new TypeError("The compose request must be a JSON object.");
  if (!Array.isArray(raw.sources) || (raw.sources.length !== 2 && raw.sources.length !== 3)) {
    throw new RangeError("sources must contain exactly 2 or 3 direct source images.");
  }

  const sources = raw.sources.map((source, index) => {
    if (!source || typeof source !== "object") throw new TypeError(`sources[${index}] must be an object.`);
    const path = existingFile(source.path, `sources[${index}].path`);
    const directReferences = Array.isArray(source.directReferences)
      ? source.directReferences.map((reference, referenceIndex) => {
          const referencePath = existingFile(
            typeof reference === "string" ? reference : reference?.path,
            `sources[${index}].directReferences[${referenceIndex}]`,
          );
          return { path: referencePath };
        })
      : [];
    return { path, directReferences };
  });
  const zenithSourceIndex = raw.zenithSourceIndex ?? sources.length - 1;
  if (!Number.isInteger(zenithSourceIndex) || zenithSourceIndex < 0 || zenithSourceIndex >= sources.length) {
    throw new RangeError(`zenithSourceIndex ${zenithSourceIndex} is outside this ${sources.length}-source bundle.`);
  }
  const orientation = raw.orientation ?? "profile";
  if (orientation !== "profile" && orientation !== "mirrored") {
    throw new RangeError('orientation must be "profile" or "mirrored".');
  }

  return {
    schema: "zenith.fulldome-compose.request.v1",
    sources,
    zenithSourceIndex,
    orientation,
    projectId: nonEmptyString(raw.projectId) || "project-headless",
    compositionId: nonEmptyString(raw.compositionId) || `composition-${randomUUID()}`,
    createdAt: nonEmptyString(raw.createdAt) || new Date().toISOString(),
  };
}

export class FulldomeHeadlessRenderer {
  #pageUrl;
  #session;
  #started = false;
  #queue = Promise.resolve();

  constructor({ pageUrl, session = `zenith-fulldome-${randomUUID()}` }) {
    this.#pageUrl = pageUrl;
    this.#session = session;
  }

  render(rawJob) {
    const task = this.#queue.then(() => this.#render(normalizeFulldomeComposeJob(rawJob)));
    this.#queue = task.catch(() => undefined);
    return task;
  }

  async close() {
    if (!this.#started) return;
    await runAgentBrowser(this.#session, ["close"], 30_000, { tolerateFailure: true });
    this.#started = false;
  }

  async #render(job) {
    await this.#start();
    const directReferencesBySource = job.sources.map(({ directReferences }) =>
      deduplicateByHash(
        directReferences.map(({ path }) => ({
          filename: basename(path),
          mime: mimeForPath(path),
          sha256: sha256File(path),
          source: path,
        })),
      ),
    );
    await runAgentBrowser(
      this.#session,
      ["upload", "#zenith-fulldome-sources", ...job.sources.map(({ path }) => path)],
      60_000,
    );
    const options = {
      zenithSourceIndex: job.zenithSourceIndex,
      orientation: job.orientation,
      projectId: job.projectId,
      compositionId: job.compositionId,
      createdAt: job.createdAt,
      directReferencesBySource,
    };
    const result = parseJson(
      await runAgentBrowser(
        this.#session,
        [
          "eval",
          "-b",
          Buffer.from(
            `(async () => await window.zenithFulldomeCompose(${JSON.stringify(options)}))()`,
            "utf8",
          ).toString("base64"),
        ],
        180_000,
      ),
    );
    const temporaryDirectory = mkdtempSync(join(tmpdir(), "zenith-fulldome-render-"));
    const temporaryOutput = join(temporaryDirectory, result.filename);
    try {
      await runAgentBrowser(this.#session, ["download", "#zenith-fulldome-download", temporaryOutput], 60_000);
      if (!existsSync(temporaryOutput)) throw new Error("The browser completed without producing a PNG.");
      return {
        schema: "zenith.fulldome-compose.response.v1",
        pngBase64: readFileSync(temporaryOutput).toString("base64"),
        manifest: result.manifest,
      };
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  }

  async #start() {
    if (this.#started) return;
    await runAgentBrowser(this.#session, ["--webgpu", "--pin-tab", "open", this.#pageUrl], 60_000);
    await runAgentBrowser(this.#session, ["wait", "--fn", "window.zenithFulldomeComposeReady === true"], 60_000);
    this.#started = true;
  }
}

function runAgentBrowser(session, args, timeout, { tolerateFailure = false } = {}) {
  const command = ["--yes", AGENT_BROWSER_PACKAGE, "--session", session, ...args];
  return new Promise((resolvePromise, reject) => {
    const child = spawn("npx", command, { stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeout);

    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.once("error", (error) => {
      clearTimeout(timer);
      if (tolerateFailure) resolvePromise("");
      else reject(new Error(`agent-browser could not start (${args.join(" ")}): ${error.message}`));
    });
    child.once("close", (status) => {
      clearTimeout(timer);
      const output = Buffer.concat(stdout).toString("utf8").trim();
      const errors = Buffer.concat(stderr).toString("utf8").trim();
      if (timedOut && !tolerateFailure) {
        reject(new Error(`agent-browser timed out after ${timeout}ms (${args.join(" ")}).`));
      } else if (status !== 0 && !tolerateFailure) {
        reject(new Error(`agent-browser failed (${args.join(" ")}):\n${errors || output}`));
      } else {
        resolvePromise(output);
      }
    });
  });
}

function parseJson(output) {
  try {
    return JSON.parse(output);
  } catch {
    throw new Error(`The headless browser returned an invalid response:\n${output}`);
  }
}

function existingFile(value, label) {
  if (typeof value !== "string" || value.length === 0) throw new TypeError(`${label} must be a file path.`);
  const path = resolve(value);
  if (!existsSync(path)) throw new Error(`${label} does not exist: ${path}`);
  return path;
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function deduplicateByHash(references) {
  const seen = new Set();
  return references.filter((reference) => {
    if (seen.has(reference.sha256)) return false;
    seen.add(reference.sha256);
    return true;
  });
}

function mimeForPath(path) {
  const extension = extname(path).toLowerCase();
  if (extension === ".png") return "image/png";
  if (extension === ".webp") return "image/webp";
  if (extension === ".gif") return "image/gif";
  return "image/jpeg";
}
