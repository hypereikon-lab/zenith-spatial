import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";

import { prepareChatGptImageHandoff, finalizeChatGptImageHandoff } from "./chatgpt-image-handoff.mjs";
import { normalizeFulldomeComposeJob } from "./fulldome-headless-renderer.mjs";
import { prepareRunwayImageRequest, finalizeRunwayImageReceipt } from "./runway-image-receipt.mjs";
import { startFulldomeComposeApi } from "../fulldome-compose-api.mjs";

const MANIFEST_SCHEMA = "zenith.image-campaign.v1";
const LEDGER_SCHEMA = "zenith.image-campaign-ledger.v1";

export function loadImageCampaign(path) {
  const manifestPath = resolve(path);
  const bytes = readFileSync(manifestPath);
  const raw = JSON.parse(bytes.toString("utf8"));
  if (raw?.schema !== MANIFEST_SCHEMA) throw new TypeError(`Expected ${MANIFEST_SCHEMA}.`);
  const campaignId = requiredString(raw.campaignId, "campaignId");
  if (!Array.isArray(raw.states) || raw.states.length === 0) {
    throw new RangeError("states must contain at least one campaign state.");
  }
  const base = dirname(manifestPath);
  const seen = new Set();
  const states = raw.states.map((state, index) => {
    const id = requiredString(state?.id, `states[${index}].id`);
    if (seen.has(id)) throw new Error(`Duplicate campaign state id: ${id}`);
    seen.add(id);
    return {
      id,
      runwayJob: campaignPath(state.runwayJob, base, `states[${index}].runwayJob`),
      composeJob: campaignPath(state.composeJob, base, `states[${index}].composeJob`),
      chatgptJob: campaignPath(state.chatgptJob, base, `states[${index}].chatgptJob`),
    };
  });
  return {
    schema: raw.schema,
    campaignId,
    manifestPath,
    manifestSha256: sha256(bytes),
    ledgerPath: campaignPath(raw.ledger || "campaign-ledger.json", base, "ledger"),
    states,
  };
}

export function inspectImageCampaign(campaign) {
  const ledger = loadLedger(campaign, { create: false });
  const states = campaign.states.map((state) => inspectState(campaign, state, ledger));
  return {
    schema: "zenith.image-campaign-status.v1",
    campaignId: campaign.campaignId,
    manifestSha256: campaign.manifestSha256,
    ledgerPath: campaign.ledgerPath,
    counts: countPhases(states),
    openAttempts: (ledger?.attempts || []).filter(({ status }) => status === "open"),
    states,
  };
}

export async function advanceImageCampaignLocal(campaign, { now = () => new Date().toISOString() } = {}) {
  return withLedgerLock(campaign, async () => {
    const ledger = loadLedger(campaign, { create: true, now });
    reconcileExistingClaims(campaign, ledger, now);
    const actions = [];
    const errors = [];

    for (const state of campaign.states) {
      try {
        const runwayJob = readJson(state.runwayJob);
        const taskIds = stringArray(runwayJob.providerTaskIds);
        const outputPaths = runwayOutputPaths(runwayJob, state.id);
        const requestPath = resolveJobPath(runwayJob.requestReceipt, state.runwayJob, "runway-request.json");
        const prepared = ensurePreparedRequest(
          requestPath,
          (createdAt) => prepareRunwayImageRequest(runwayJob, { createdAt }),
          `Runway ${state.id}`,
          { allowRefresh: taskIds.length === 0 && outputPaths.every((path) => !existsSync(path)) },
        );
        if (prepared.created) actions.push({ stateId: state.id, action: "prepared-runway" });
        if (prepared.refreshed) actions.push({ stateId: state.id, action: "refreshed-unsubmitted-runway" });

        const generationPath = resolveJobPath(runwayJob.generationReceipt, state.runwayJob, "runway-generation.json");
        if (taskIds.length === 2 && outputPaths.every(existsSync) && !existsSync(generationPath)) {
          atomicWriteJson(generationPath, finalizeRunwayImageReceipt(runwayJob, prepared.value));
          actions.push({ stateId: state.id, action: "finalized-runway" });
        }
      } catch (error) {
        errors.push(localAdvanceError(state.id, "runway", error));
      }
    }

    const composeQueue = [];
    for (const state of campaign.states) {
      try {
        const runwayJob = readJson(state.runwayJob);
        const generationPath = resolveJobPath(runwayJob.generationReceipt, state.runwayJob, "runway-generation.json");
        if (!existsSync(generationPath)) continue;
        const composeRaw = readJson(state.composeJob);
        const output = resolve(requiredString(composeRaw.output, `${state.id} compose output`));
        const manifest = `${output}.manifest.json`;
        if (existsSync(output) !== existsSync(manifest)) {
          throw new Error(
            `${state.id} has an ambiguous Plate: PNG and manifest must either both exist or both be absent.`,
          );
        }
        if (!existsSync(output)) composeQueue.push({ state, raw: composeRaw, output, manifest });
      } catch (error) {
        errors.push(localAdvanceError(state.id, "compose-inspection", error));
      }
    }

    if (composeQueue.length > 0) {
      const api = await startFulldomeComposeApi();
      try {
        for (const item of composeQueue) {
          try {
            const job = normalizeFulldomeComposeJob(item.raw);
            const response = await fetch(`${api.url}/api/fulldome/compose`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(job),
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || `Plate composition failed for ${item.state.id}.`);
            mkdirSync(dirname(item.output), { recursive: true });
            atomicWrite(item.output, Buffer.from(result.pngBase64, "base64"));
            atomicWriteJson(item.manifest, result.manifest);
            actions.push({ stateId: item.state.id, action: "composed-plate" });
          } catch (error) {
            errors.push(localAdvanceError(item.state.id, "compose", error));
          }
        }
      } finally {
        await api.close();
      }
    }

    for (const state of campaign.states) {
      try {
        const chatgptJob = readJson(state.chatgptJob);
        if (!existsSync(resolve(chatgptJob.plateSketch))) continue;
        const conversationUrl = cleanString(chatgptJob.conversationUrl);
        const output = resolve(requiredString(chatgptJob.output, `${state.id} ChatGPT output`));
        const requestPath = resolveJobPath(chatgptJob.requestReceipt, state.chatgptJob, "chatgpt-request.json");
        const prepared = ensurePreparedRequest(
          requestPath,
          (createdAt) => prepareChatGptImageHandoff(chatgptJob, { createdAt }),
          `ChatGPT ${state.id}`,
          { allowRefresh: !conversationUrl && !existsSync(output) },
        );
        if (prepared.created) actions.push({ stateId: state.id, action: "prepared-chatgpt" });
        if (prepared.refreshed) actions.push({ stateId: state.id, action: "refreshed-unsubmitted-chatgpt" });

        const generationPath = resolveJobPath(
          chatgptJob.generationReceipt,
          state.chatgptJob,
          "chatgpt-generation.json",
        );
        if (conversationUrl && existsSync(output) && !existsSync(generationPath)) {
          atomicWriteJson(generationPath, finalizeChatGptImageHandoff(chatgptJob, prepared.value));
          actions.push({ stateId: state.id, action: "finalized-chatgpt" });
        }
      } catch (error) {
        errors.push(localAdvanceError(state.id, "chatgpt", error));
      }
    }

    for (const action of actions) ledgerEvent(ledger, action.stateId, action.action, {}, now);
    ledger.updatedAt = now();
    atomicWriteJson(campaign.ledgerPath, ledger);
    return { actions, errors, status: inspectImageCampaign(campaign) };
  });
}

export function reserveImageCampaignDispatch(campaign, provider, { now = () => new Date().toISOString() } = {}) {
  return withLedgerLockSync(campaign, () => {
    if (provider !== "runway" && provider !== "chatgpt") {
      throw new RangeError("provider must be runway or chatgpt.");
    }
    const ledger = loadLedger(campaign, { create: true, now });
    reconcileExistingClaims(campaign, ledger, now);
    const open = ledger.attempts.find((attempt) => attempt.provider === provider && attempt.status === "open");
    if (open) {
      throw new Error(
        `Unresolved ${provider} dispatch ${open.id}. Reconcile it with the provider before reserving another batch.`,
      );
    }
    const status = inspectImageCampaign(campaign);
    const items = status.states
      .filter((state) => state.nextRemote === provider)
      .map((state) => dispatchItem(campaign, state, provider));
    if (items.length === 0) return { attempt: null, dispatch: dispatchDocument(campaign, provider, null, []) };
    const attempt = {
      id: randomUUID(),
      provider,
      status: "open",
      createdAt: now(),
      items: items.map(({ stateId, requestDigest }) => ({ stateId, requestDigest })),
    };
    ledger.attempts.push(attempt);
    ledger.updatedAt = now();
    atomicWriteJson(campaign.ledgerPath, ledger);
    return { attempt, dispatch: dispatchDocument(campaign, provider, attempt.id, items) };
  });
}

export function claimImageCampaignDispatch(campaign, provider, result, { now = () => new Date().toISOString() } = {}) {
  return withLedgerLockSync(campaign, () => {
    const ledger = loadLedger(campaign, { create: true, now });
    const attemptId = requiredString(result?.attemptId, "attemptId");
    const attempt = ledger.attempts.find(({ id }) => id === attemptId);
    if (!attempt || attempt.provider !== provider)
      throw new Error(`Unknown ${provider} dispatch attempt: ${attemptId}`);
    if (attempt.status === "claimed") return { idempotent: true, attempt };
    if (attempt.status !== "open") throw new Error(`Dispatch attempt ${attemptId} is not open.`);
    if (!Array.isArray(result.items)) throw new TypeError("result.items must be an array.");
    const byState = new Map(result.items.map((item) => [item?.stateId, item]));
    for (const reserved of attempt.items) {
      const item = byState.get(reserved.stateId);
      if (!item) throw new Error(`Dispatch result is missing ${reserved.stateId}.`);
      if (item.requestDigest !== reserved.requestDigest) {
        throw new Error(`Request digest mismatch for ${reserved.stateId}.`);
      }
      const state = campaign.states.find(({ id }) => id === reserved.stateId);
      const jobPath = provider === "runway" ? state.runwayJob : state.chatgptJob;
      const job = readJson(jobPath);
      if (provider === "runway") {
        const ids = stringArray(item.providerTaskIds);
        if (ids.length !== 2 || new Set(ids).size !== 2) {
          throw new RangeError(`${state.id} must claim exactly two distinct Runway task ids.`);
        }
        const existing = stringArray(job.providerTaskIds);
        if (existing.length > 0 && canonicalJson(existing) !== canonicalJson(ids)) {
          throw new Error(`${state.id} already records different Runway task ids.`);
        }
        job.providerTaskIds = ids;
        atomicWriteJson(jobPath, job);
        ledgerState(ledger, state.id).runway = {
          requestDigest: reserved.requestDigest,
          providerTaskIds: ids,
          submittedAt: cleanString(item.submittedAt) || now(),
        };
      } else {
        const url = chatGptConversationUrl(item.conversationUrl);
        const existing = cleanString(job.conversationUrl);
        if (existing && existing !== url) throw new Error(`${state.id} already records a different ChatGPT URL.`);
        job.conversationUrl = url;
        atomicWriteJson(jobPath, job);
        ledgerState(ledger, state.id).chatgpt = {
          requestDigest: reserved.requestDigest,
          conversationUrl: url,
          submittedAt: cleanString(item.submittedAt) || now(),
        };
      }
      ledgerEvent(ledger, state.id, `claimed-${provider}`, { attemptId }, now);
    }
    attempt.status = "claimed";
    attempt.claimedAt = now();
    ledger.updatedAt = now();
    atomicWriteJson(campaign.ledgerPath, ledger);
    return { idempotent: false, attempt };
  });
}

export function supersedeImageCampaignDispatch(
  campaign,
  provider,
  result,
  { now = () => new Date().toISOString() } = {},
) {
  return withLedgerLockSync(campaign, () => {
    const ledger = loadLedger(campaign, { create: true, now });
    const attemptId = requiredString(result?.attemptId, "attemptId");
    const reason = requiredString(result?.reason, "reason");
    const attempt = ledger.attempts.find(({ id }) => id === attemptId);
    if (!attempt || attempt.provider !== provider)
      throw new Error(`Unknown ${provider} dispatch attempt: ${attemptId}`);
    if (attempt.status === "superseded") return { idempotent: true, attempt };
    if (attempt.status !== "open") throw new Error(`Dispatch attempt ${attemptId} is not open.`);
    if (!Array.isArray(result.items)) throw new TypeError("result.items must be an array.");
    const byState = new Map(result.items.map((item) => [item?.stateId, item]));
    const settlements = attempt.items.map((reserved) => {
      const item = byState.get(reserved.stateId);
      if (!item) throw new Error(`Supersede result is missing ${reserved.stateId}.`);
      if (item.requestDigest !== reserved.requestDigest) {
        throw new Error(`Request digest mismatch for ${reserved.stateId}.`);
      }
      const outcome = requiredString(item.outcome, `${reserved.stateId}.outcome`);
      if (!["not-submitted", "submitted-quarantined", "unknown"].includes(outcome)) {
        throw new RangeError(`${reserved.stateId}.outcome is invalid.`);
      }
      const providerTaskIds = stringArray(item.providerTaskIds);
      if (outcome === "not-submitted" && providerTaskIds.length > 0) {
        throw new RangeError(`${reserved.stateId} cannot be not-submitted while recording provider task ids.`);
      }
      if (outcome === "submitted-quarantined" && providerTaskIds.length === 0) {
        throw new RangeError(`${reserved.stateId} needs at least one provider task id when quarantined.`);
      }
      const settlement = {
        stateId: reserved.stateId,
        requestDigest: reserved.requestDigest,
        outcome,
        providerTaskIds,
        ...(cleanString(item.providerStatus) ? { providerStatus: item.providerStatus.trim() } : {}),
        ...(cleanString(item.note) ? { note: item.note.trim() } : {}),
      };
      ledgerEvent(
        ledger,
        reserved.stateId,
        `superseded-${provider}-dispatch`,
        { attemptId, outcome, providerTaskIds },
        now,
      );
      return settlement;
    });
    attempt.status = "superseded";
    attempt.supersededAt = now();
    attempt.reason = reason;
    attempt.settlements = settlements;
    ledger.updatedAt = now();
    atomicWriteJson(campaign.ledgerPath, ledger);
    return { idempotent: false, attempt };
  });
}

function inspectState(campaign, state, ledger) {
  try {
    const runwayJob = readJson(state.runwayJob);
    const runwayRequestPath = resolveJobPath(runwayJob.requestReceipt, state.runwayJob, "runway-request.json");
    const runwayGenerationPath = resolveJobPath(runwayJob.generationReceipt, state.runwayJob, "runway-generation.json");
    const runwayPrepared = existsSync(runwayRequestPath) ? readJson(runwayRequestPath) : null;
    if (runwayPrepared) {
      assertPreparedMatches(
        runwayPrepared,
        (createdAt) => prepareRunwayImageRequest(runwayJob, { createdAt }),
        `Runway ${state.id}`,
      );
    } else {
      prepareRunwayImageRequest(runwayJob, { createdAt: "1970-01-01T00:00:00.000Z" });
    }
    const taskIds = stringArray(runwayJob.providerTaskIds);
    if (taskIds.length !== 0 && taskIds.length !== 2) throw new Error("Runway task id count must be 0 or 2.");
    const runwayOutputs = runwayOutputPaths(runwayJob, state.id);
    const runwayOutputCount = runwayOutputs.filter(existsSync).length;
    if (runwayOutputCount > 0 && taskIds.length === 0)
      throw new Error("Runway outputs exist without claimed task ids.");
    if (runwayOutputCount !== 0 && runwayOutputCount !== 2)
      throw new Error("Runway outputs are only partially present.");

    const composeJob = readJson(state.composeJob);
    const plate = resolve(requiredString(composeJob.output, `${state.id} compose output`));
    const plateManifest = `${plate}.manifest.json`;
    if (existsSync(plate) !== existsSync(plateManifest)) throw new Error("Plate PNG and manifest disagree.");

    const chatgptJob = readJson(state.chatgptJob);
    const chatgptRequestPath = resolveJobPath(chatgptJob.requestReceipt, state.chatgptJob, "chatgpt-request.json");
    const chatgptGenerationPath = resolveJobPath(
      chatgptJob.generationReceipt,
      state.chatgptJob,
      "chatgpt-generation.json",
    );
    const chatgptPrepared = existsSync(chatgptRequestPath) ? readJson(chatgptRequestPath) : null;
    if (chatgptPrepared) {
      assertPreparedMatches(
        chatgptPrepared,
        (createdAt) => prepareChatGptImageHandoff(chatgptJob, { createdAt }),
        `ChatGPT ${state.id}`,
      );
    } else if (existsSync(plate)) {
      prepareChatGptImageHandoff(chatgptJob, { createdAt: "1970-01-01T00:00:00.000Z" });
    }
    const conversationUrl = cleanString(chatgptJob.conversationUrl);
    const chatgptOutput = resolve(requiredString(chatgptJob.output, `${state.id} ChatGPT output`));
    if (existsSync(chatgptOutput) && !conversationUrl)
      throw new Error("ChatGPT output exists without a claimed conversation URL.");

    assertLedgerClaims(state.id, ledger, taskIds, conversationUrl);

    const facts = {
      runwayPrepared: Boolean(runwayPrepared),
      runwayTaskIds: taskIds,
      runwayOutputCount,
      runwayFinalized: existsSync(runwayGenerationPath),
      plateReady: existsSync(plate),
      chatgptPrepared: Boolean(chatgptPrepared),
      chatgptConversationUrl: conversationUrl,
      chatgptOutputReady: existsSync(chatgptOutput),
      chatgptFinalized: existsSync(chatgptGenerationPath),
    };
    const phase = phaseFor(facts);
    return {
      id: state.id,
      phase,
      nextRemote: phase === "runway-ready" ? "runway" : phase === "chatgpt-ready" ? "chatgpt" : null,
      paths: { ...state, runwayRequest: runwayRequestPath, chatgptRequest: chatgptRequestPath },
      ...facts,
    };
  } catch (error) {
    return { id: state.id, phase: "blocked", nextRemote: null, paths: state, error: error.message };
  }
}

function dispatchItem(campaign, stateStatus, provider) {
  const path = provider === "runway" ? stateStatus.paths.runwayRequest : stateStatus.paths.chatgptRequest;
  const request = readJson(path);
  if (provider === "runway") {
    return {
      stateId: stateStatus.id,
      requestDigest: request.requestDigest,
      requestPath: path,
      recipeId: request.recipeId,
      model: request.model,
      ratio: request.ratio,
      count: request.count,
      prompt: request.prompt,
      references: request.references.map(({ filename, mime, bytes, sha256: digest }) => ({
        filename,
        mime,
        bytes,
        sha256: digest,
      })),
    };
  }
  return {
    stateId: stateStatus.id,
    requestDigest: request.requestDigest,
    requestPath: path,
    recipeId: request.recipeId,
    url: request.url,
    prompt: request.prompt,
    promptUiCanonicalSha256: request.promptUiCanonicalSha256,
    attachments: request.attachments.map(({ imageIndex, role, filename, mime, bytes, sha256: digest }) => ({
      imageIndex,
      role,
      filename,
      mime,
      bytes,
      sha256: digest,
    })),
  };
}

function dispatchDocument(campaign, provider, attemptId, items) {
  return {
    schema: `zenith.${provider}-campaign-dispatch.v1`,
    campaignId: campaign.campaignId,
    manifestSha256: campaign.manifestSha256,
    attemptId,
    provider,
    items,
  };
}

function phaseFor(facts) {
  if (facts.chatgptFinalized) return "complete";
  if (facts.chatgptConversationUrl && facts.chatgptOutputReady) return "chatgpt-output-ready";
  if (facts.chatgptConversationUrl) return "chatgpt-submitted";
  if (facts.chatgptPrepared) return "chatgpt-ready";
  if (facts.plateReady) return "plate-ready";
  if (facts.runwayFinalized) return "runway-finalized";
  if (facts.runwayOutputCount === 2) return "runway-output-ready";
  if (facts.runwayTaskIds.length === 2) return "runway-submitted";
  if (facts.runwayPrepared) return "runway-ready";
  return "planned";
}

function ensurePreparedRequest(path, factory, label, { allowRefresh = false } = {}) {
  if (existsSync(path)) {
    const value = readJson(path);
    const expected = factory(value.createdAt);
    if (value.requestDigest !== expected.requestDigest) {
      if (!allowRefresh) throw new Error(`${label} job drifted after request preparation.`);
      atomicWriteJson(path, expected);
      return { value: expected, created: false, refreshed: true };
    }
    return { value, created: false };
  }
  const value = factory(undefined);
  atomicWriteJson(path, value);
  return { value, created: true };
}

function assertPreparedMatches(prepared, factory, label) {
  const expected = factory(prepared.createdAt);
  if (prepared.requestDigest !== expected.requestDigest) {
    throw new Error(`${label} job drifted after request preparation.`);
  }
}

function reconcileExistingClaims(campaign, ledger, now) {
  for (const state of campaign.states) {
    const runwayJob = readJson(state.runwayJob);
    const taskIds = stringArray(runwayJob.providerTaskIds);
    const stateLedger = ledgerState(ledger, state.id);
    if (taskIds.length === 2 && !stateLedger.runway) {
      const request = readJson(resolveJobPath(runwayJob.requestReceipt, state.runwayJob, "runway-request.json"));
      stateLedger.runway = {
        requestDigest: request.requestDigest,
        providerTaskIds: taskIds,
        submittedAt: request.createdAt,
        imported: true,
      };
      ledgerEvent(ledger, state.id, "imported-runway-claim", {}, now);
    }
    const chatgptJob = readJson(state.chatgptJob);
    const conversationUrl = cleanString(chatgptJob.conversationUrl);
    if (conversationUrl && !stateLedger.chatgpt) {
      const request = readJson(resolveJobPath(chatgptJob.requestReceipt, state.chatgptJob, "chatgpt-request.json"));
      stateLedger.chatgpt = {
        requestDigest: request.requestDigest,
        conversationUrl: chatGptConversationUrl(conversationUrl),
        submittedAt: request.createdAt,
        imported: true,
      };
      ledgerEvent(ledger, state.id, "imported-chatgpt-claim", {}, now);
    }
  }
}

function assertLedgerClaims(stateId, ledger, taskIds, conversationUrl) {
  const state = ledger?.states?.[stateId];
  if (state?.runway && canonicalJson(state.runway.providerTaskIds) !== canonicalJson(taskIds)) {
    throw new Error("Runway job and campaign ledger claim different task ids.");
  }
  if (state?.chatgpt && state.chatgpt.conversationUrl !== conversationUrl) {
    throw new Error("ChatGPT job and campaign ledger claim different conversation URLs.");
  }
}

function loadLedger(campaign, { create, now = () => new Date().toISOString() }) {
  if (!existsSync(campaign.ledgerPath)) {
    if (!create) return null;
    return {
      schema: LEDGER_SCHEMA,
      campaignId: campaign.campaignId,
      manifestSha256: campaign.manifestSha256,
      createdAt: now(),
      updatedAt: now(),
      states: {},
      attempts: [],
      events: [],
    };
  }
  const ledger = readJson(campaign.ledgerPath);
  if (ledger.schema !== LEDGER_SCHEMA) throw new TypeError(`Expected ${LEDGER_SCHEMA}.`);
  if (ledger.campaignId !== campaign.campaignId || ledger.manifestSha256 !== campaign.manifestSha256) {
    throw new Error("Campaign manifest changed after the ledger was created; explicit migration is required.");
  }
  ledger.states ||= {};
  ledger.attempts ||= [];
  ledger.events ||= [];
  return ledger;
}

function ledgerState(ledger, stateId) {
  ledger.states[stateId] ||= {};
  return ledger.states[stateId];
}

function ledgerEvent(ledger, stateId, action, details, now) {
  ledger.events.push({ at: now(), stateId, action, ...details });
}

function runwayOutputPaths(job, stateId) {
  if (!Array.isArray(job.outputs) || job.outputs.length !== 2) {
    throw new RangeError(`${stateId} must reserve exactly two Runway outputs.`);
  }
  return job.outputs.map((item, index) => resolve(requiredString(item?.path, `${stateId} outputs[${index}].path`)));
}

function resolveJobPath(value, jobPath, fallback) {
  return value ? resolve(value) : resolve(dirname(jobPath), fallback);
}

function countPhases(states) {
  return Object.fromEntries(
    [...new Set(states.map(({ phase }) => phase))]
      .sort()
      .map((phase) => [phase, states.filter((s) => s.phase === phase).length]),
  );
}

function localAdvanceError(stateId, stage, error) {
  return {
    stateId,
    stage,
    error: error instanceof Error ? error.message : String(error),
  };
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function atomicWriteJson(path, value) {
  atomicWrite(path, Buffer.from(`${JSON.stringify(value, null, 2)}\n`));
}

function atomicWrite(path, bytes) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
  writeFileSync(temporary, bytes);
  renameSync(temporary, path);
}

async function withLedgerLock(campaign, operation) {
  const release = acquireLock(campaign.ledgerPath);
  try {
    return await operation();
  } finally {
    release();
  }
}

function withLedgerLockSync(campaign, operation) {
  const release = acquireLock(campaign.ledgerPath);
  try {
    return operation();
  } finally {
    release();
  }
}

function acquireLock(ledgerPath) {
  const lock = `${ledgerPath}.lock`;
  mkdirSync(dirname(lock), { recursive: true });
  let descriptor;
  try {
    descriptor = openSync(lock, "wx");
    writeFileSync(descriptor, `${JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })}\n`);
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error(`Campaign is already locked: ${lock}`, { cause: error });
    throw error;
  }
  return () => {
    closeSync(descriptor);
    unlinkSync(lock);
  };
}

function campaignPath(value, base, label) {
  return resolve(base, requiredString(value, label));
}

function stringArray(value) {
  return Array.isArray(value) ? value.map(cleanString).filter(Boolean) : [];
}

function requiredString(value, label) {
  const result = cleanString(value);
  if (!result) throw new TypeError(`${label} must be a non-empty string.`);
  return result;
}

function cleanString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function chatGptConversationUrl(value) {
  const url = new URL(requiredString(value, "conversationUrl"));
  if (url.protocol !== "https:" || url.hostname !== "chatgpt.com" || !url.pathname.startsWith("/c/")) {
    throw new TypeError("conversationUrl must be an https://chatgpt.com/c/... URL.");
  }
  return url.toString().replace(/\/$/, "");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value) {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortKeys(value[key])]),
  );
}
