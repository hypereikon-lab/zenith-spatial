import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const DEFAULT_BROWSER = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const DEFAULT_URL = "https://chatgpt.com/images";
const DEFAULT_AGENT_BROWSER = "agent-browser@0.36.0";

function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  const jobIndex = argv.indexOf("--job");
  if (jobIndex < 0 || !argv[jobIndex + 1]) {
    fail("Usage: node scripts/chatgpt-image-bridge.mjs --job /absolute/job.json [--send] [--dry-run]");
  }

  return {
    jobPath: resolve(argv[jobIndex + 1]),
    send: argv.includes("--send"),
    dryRun: argv.includes("--dry-run"),
  };
}

function absoluteFile(value, label) {
  if (typeof value !== "string" || value.length === 0) fail(`${label} must be a file path.`);
  const path = resolve(value);
  if (!existsSync(path)) fail(`${label} does not exist: ${path}`);
  return path;
}

function readJob(path) {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  const plateSketch = absoluteFile(raw.plateSketch, "plateSketch");
  const references = Array.isArray(raw.references)
    ? raw.references.map((value, index) => absoluteFile(value, `references[${index}]`))
    : fail("references must be an array of file paths.");

  if (references.length === 0) fail("references must contain at least one file.");

  const promptFile = raw.promptFile ? absoluteFile(raw.promptFile, "promptFile") : undefined;
  const output = raw.output ? resolve(raw.output) : undefined;
  if (output && !existsSync(dirname(output))) fail(`output directory does not exist: ${dirname(output)}`);

  const browserExecutable = resolve(raw.browserExecutable || DEFAULT_BROWSER);
  if (!existsSync(browserExecutable)) fail(`browserExecutable does not exist: ${browserExecutable}`);

  return {
    session: raw.session || "zenith-chatgpt-image",
    browserProfile: raw.browserProfile || "Profile 2",
    browserExecutable,
    url: raw.url || DEFAULT_URL,
    plateSketch,
    references,
    promptFile,
    expectedPromptSha256: raw.expectedPromptSha256,
    output,
    timeoutMs: raw.timeoutMs || 900_000,
  };
}

function command(job, args, timeout = 60_000) {
  const result = spawnSync("npx", ["--yes", DEFAULT_AGENT_BROWSER, "--session", job.session, ...args], {
    encoding: "utf8",
    timeout,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    fail(`agent-browser failed (${args.join(" ")}):\n${result.stderr || result.stdout}`);
  }

  return result.stdout.trim();
}

function evalJson(job, source) {
  const output = command(job, ["eval", source]);
  try {
    return JSON.parse(output);
  } catch {
    fail(`Could not parse browser result as JSON:\n${output}`);
  }
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function sleep(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function browserState(job) {
  return evalJson(
    job,
    `(() => {
      const editor = document.querySelector('#prompt-textarea')
        ?? [...document.querySelectorAll('[contenteditable="true"], textarea')]
          .find((node) => /ChatGPT|mensaje|message/i.test(
            node.getAttribute('aria-label') ?? node.getAttribute('data-placeholder') ?? ''
          ));
      const prompt = editor
        ? ('value' in editor ? editor.value : editor.innerText ?? editor.textContent ?? '')
        : '';
      const pending = [...document.querySelectorAll('button[aria-label^="Eliminar archivo"]')]
        .map((button) => button.getAttribute('aria-label'));
      return {
        authenticated: document.body.innerText.includes('Pro')
          && !document.body.innerText.includes('Iniciar sesión'),
        beta: document.body.innerText.includes('Imágenes ACTUALIZADA'),
        prompt,
        pending,
        url: location.href,
      };
    })()`,
  );
}

function attachmentNames(job) {
  return evalJson(
    job,
    `(() => [...document.querySelectorAll('button[aria-label^="Eliminar archivo"]')]
      .map((button) => (button.getAttribute('aria-label') ?? '')
        .replace(/^Eliminar archivo:?\\s*/i, '')))()`,
  );
}

async function waitForGeneration(job, previousImageCount) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < job.timeoutMs) {
    const state = evalJson(
      job,
      `(() => {
        const images = [...document.images].filter((image) =>
          (image.alt ?? '').startsWith('Imagen generada:')
        );
        const stopping = [...document.querySelectorAll('button')].some((button) =>
          /Detener respuesta|Stop generating/i.test(button.getAttribute('aria-label') ?? button.textContent ?? '')
        );
        const image = images.at(-1);
        return {
          count: images.length,
          stopping,
          alt: image?.alt ?? null,
          width: image?.naturalWidth ?? null,
          height: image?.naturalHeight ?? null,
          url: location.href,
        };
      })()`,
    );

    if (state.count > previousImageCount && !state.stopping && state.width > 0) return state;
    await sleep(5_000);
  }

  fail(`Generation did not finish within ${job.timeoutMs} ms.`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const job = readJob(args.jobPath);
  const orderedFiles = [job.plateSketch, ...job.references];

  if (args.send && !job.output) fail("output is required when --send is used.");

  if (args.dryRun) {
    console.log(
      JSON.stringify(
        {
          mode: "dry-run",
          session: job.session,
          order: orderedFiles.map((path) => basename(path)),
          prompt: job.promptFile ? `file:${job.promptFile}` : "preserve-existing",
          send: args.send,
          output: job.output,
        },
        null,
        2,
      ),
    );
    return;
  }

  command(job, [
    "--profile",
    job.browserProfile,
    "--executable-path",
    job.browserExecutable,
    "--headed",
    "open",
    job.url,
  ]);
  command(job, ["wait", "1500"]);

  let state = browserState(job);
  if (!state.authenticated) fail("The selected Chrome profile is not authenticated in ChatGPT.");
  if (!state.beta) fail("ChatGPT Images 2.5 beta was not detected in the selected profile.");
  if (state.pending.length > 0) {
    fail("The composer already contains attachments. Start from a clean Images composer and retry.");
  }

  if (job.promptFile) {
    const prompt = readFileSync(job.promptFile, "utf8").trim();
    command(job, ["fill", "#prompt-textarea", prompt]);
    state = browserState(job);
  }

  const prompt = state.prompt.trim();
  if (!prompt) fail("The ChatGPT Images composer has no prompt and no promptFile was supplied.");

  const promptHash = sha256(prompt);
  if (job.expectedPromptSha256 && promptHash !== job.expectedPromptSha256) {
    fail(`Prompt hash mismatch: expected ${job.expectedPromptSha256}, received ${promptHash}.`);
  }

  // Uploading the guide separately makes Image1 deterministic. The browser protocol
  // assigns File objects directly to the hidden input; Finder is never opened.
  command(job, ["upload", 'input[aria-label="Adjuntar imágenes"]', job.plateSketch]);
  command(job, ["wait", "700"]);
  command(job, ["upload", 'input[aria-label="Adjuntar imágenes"]', ...job.references]);
  command(job, ["wait", "1200"]);

  const received = attachmentNames(job);
  const expected = orderedFiles.map((path) => basename(path));
  if (JSON.stringify(received) !== JSON.stringify(expected)) {
    fail(`Attachment order mismatch.\nExpected: ${expected.join(", ")}\nReceived: ${received.join(", ")}`);
  }

  if (!args.send) {
    console.log(JSON.stringify({ mode: "prepared", order: received, promptSha256: promptHash }, null, 2));
    return;
  }

  const previousImageCount = evalJson(
    job,
    `(() => [...document.images].filter((image) =>
      (image.alt ?? '').startsWith('Imagen generada:')
    ).length)()`,
  );
  const sendButton = evalJson(
    job,
    `(() => {
      const button = [...document.querySelectorAll('button')].find((candidate) =>
        /^(Enviar prompt|Send prompt)$/.test(
          (candidate.getAttribute('aria-label') ?? candidate.textContent ?? '').trim()
        )
      );
      if (!button || button.disabled) return { found: false };
      button.id = 'zenith-chatgpt-image-send';
      return { found: true };
    })()`,
  );
  if (!sendButton.found) fail("The ChatGPT Images send button is missing or disabled.");
  command(job, ["click", "#zenith-chatgpt-image-send"]);

  const generated = await waitForGeneration(job, previousImageCount);
  evalJson(
    job,
    `(() => {
      const image = [...document.images].filter((candidate) =>
        (candidate.alt ?? '').startsWith('Imagen generada:')
      ).at(-1);
      const button = image?.closest('button');
      if (!button) return { opened: false };
      button.click();
      return { opened: true };
    })()`,
  );
  command(job, ["wait", "700"]);
  const save = evalJson(
    job,
    `(() => {
      const button = [...document.querySelectorAll('button')]
        .find((candidate) => /^(Guardar|Save)$/.test((candidate.textContent ?? '').trim()));
      if (!button) return { found: false };
      button.id = 'zenith-chatgpt-image-save';
      return { found: true };
    })()`,
  );
  if (!save.found) fail("The generated image opened, but its Save button was not found.");

  command(job, ["download", "#zenith-chatgpt-image-save", job.output], job.timeoutMs);
  if (!existsSync(job.output)) fail(`ChatGPT reported a download, but no file exists at ${job.output}.`);

  const receiptPath = `${job.output}.manifest.json`;
  writeFileSync(
    receiptPath,
    `${JSON.stringify(
      {
        schema: "zenith.chatgpt-image-run.v1",
        createdAt: new Date().toISOString(),
        conversationUrl: generated.url,
        prompt,
        promptSha256: promptHash,
        plateSketch: job.plateSketch,
        references: job.references,
        attachmentOrder: received,
        output: job.output,
        image: { alt: generated.alt, width: generated.width, height: generated.height },
      },
      null,
      2,
    )}\n`,
  );

  console.log(
    JSON.stringify(
      {
        mode: "completed",
        conversationUrl: generated.url,
        output: job.output,
        receipt: receiptPath,
        promptSha256: promptHash,
        attachmentCount: received.length,
        image: { width: generated.width, height: generated.height },
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
