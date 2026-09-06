import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";

export function loadChatGptImageHandoff(path) {
  const requestPath = resolve(path);
  if (!existsSync(requestPath)) throw new Error(`Prepared handoff does not exist: ${requestPath}`);
  const request = JSON.parse(readFileSync(requestPath, "utf8"));
  if (request.schema !== "zenith.chatgpt-image-handoff.v1") {
    throw new TypeError("Expected a zenith.chatgpt-image-handoff.v1 receipt.");
  }
  if (!Array.isArray(request.attachments) || request.attachments.length < 2) {
    throw new RangeError("The prepared handoff must contain Image1 and at least one reference.");
  }
  if (request.attachments[0]?.imageIndex !== 1 || request.attachments[0]?.role !== "plate_sketch") {
    throw new Error("The prepared handoff does not pin the Plate Sketch as Image1.");
  }

  for (const [index, attachment] of request.attachments.entries()) {
    if (attachment.imageIndex !== index + 1) throw new Error("Attachment imageIndex values must be contiguous.");
    if (!existsSync(attachment.source)) throw new Error(`Attachment does not exist: ${attachment.source}`);
    const digest = sha256(readFileSync(attachment.source));
    if (digest !== attachment.sha256) {
      throw new Error(`Attachment changed after preparation: ${attachment.source}`);
    }
  }
  return request;
}

export function loadChatGptImageCampaignDispatch(path) {
  const dispatchPath = resolve(path);
  if (!existsSync(dispatchPath)) throw new Error(`Campaign dispatch does not exist: ${dispatchPath}`);
  const dispatch = JSON.parse(readFileSync(dispatchPath, "utf8"));
  if (dispatch.schema !== "zenith.chatgpt-campaign-dispatch.v1") {
    throw new TypeError("Expected a zenith.chatgpt-campaign-dispatch.v1 document.");
  }
  if (!dispatch.attemptId || !Array.isArray(dispatch.items) || dispatch.items.length === 0) {
    throw new RangeError("Campaign dispatch must contain an attemptId and at least one item.");
  }
  const seen = new Set();
  const items = dispatch.items.map((item, index) => {
    const stateId = requiredString(item?.stateId, `items[${index}].stateId`);
    if (seen.has(stateId)) throw new Error(`Duplicate campaign state id: ${stateId}`);
    seen.add(stateId);
    const request = loadChatGptImageHandoff(item.requestPath);
    if (request.requestDigest !== item.requestDigest) {
      throw new Error(`${stateId} request differs from its reserved campaign dispatch.`);
    }
    return { stateId, request };
  });
  return { ...dispatch, dispatchPath, items };
}

export async function startChatGptImageHandoffServer(request, { host = "127.0.0.1", port = 0 } = {}) {
  const server = createServer((incoming, response) => {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Cache-Control", "no-store");

    const url = new URL(incoming.url || "/", `http://${host}`);
    if (incoming.method !== "GET") return send(response, 405, "text/plain; charset=utf-8", "Method not allowed\n");
    if (url.pathname === "/health") {
      return send(
        response,
        200,
        "application/json",
        JSON.stringify({ ok: true, schema: request.schema, requestDigest: request.requestDigest }),
      );
    }
    if (url.pathname === "/prompt.txt") {
      return send(response, 200, "text/plain; charset=utf-8", request.prompt);
    }
    if (url.pathname === "/request.json") {
      return send(response, 200, "application/json", JSON.stringify(request));
    }

    const match = url.pathname.match(/^\/attachments\/(\d+)$/);
    if (!match) return send(response, 404, "text/plain; charset=utf-8", "Not found\n");
    const attachment = request.attachments.find(({ imageIndex }) => imageIndex === Number(match[1]));
    if (!attachment) return send(response, 404, "text/plain; charset=utf-8", "Unknown attachment\n");
    const bytes = readFileSync(attachment.source);
    response.statusCode = 200;
    response.setHeader("Content-Type", attachment.mime);
    response.setHeader("Content-Length", bytes.byteLength);
    response.setHeader("Content-Disposition", `inline; filename="${safeFilename(attachment.filename)}"`);
    response.setHeader("X-Zenith-Sha256", attachment.sha256);
    response.end(bytes);
  });

  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolvePromise);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not resolve the handoff server address.");
  return { server, url: `http://${host}:${address.port}` };
}

export async function startChatGptImageCampaignHandoffServer(dispatch, { host = "127.0.0.1", port = 0 } = {}) {
  const byState = new Map(dispatch.items.map((item) => [item.stateId, item.request]));
  const server = createServer((incoming, response) => {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Cache-Control", "no-store");
    const url = new URL(incoming.url || "/", `http://${host}`);
    if (incoming.method !== "GET") return send(response, 405, "text/plain; charset=utf-8", "Method not allowed\n");
    if (url.pathname === "/health") {
      return send(
        response,
        200,
        "application/json",
        JSON.stringify({
          ok: true,
          schema: dispatch.schema,
          campaignId: dispatch.campaignId,
          attemptId: dispatch.attemptId,
          stateCount: dispatch.items.length,
        }),
      );
    }
    if (url.pathname === "/campaign.json") {
      return send(
        response,
        200,
        "application/json",
        JSON.stringify({
          schema: dispatch.schema,
          campaignId: dispatch.campaignId,
          attemptId: dispatch.attemptId,
          items: dispatch.items.map(({ stateId, request }) => ({
            stateId,
            requestDigest: request.requestDigest,
            attachmentCount: request.attachments.length,
            prompt: `/states/${encodeURIComponent(stateId)}/prompt.txt`,
            request: `/states/${encodeURIComponent(stateId)}/request.json`,
          })),
        }),
      );
    }

    const match = url.pathname.match(/^\/states\/([^/]+)\/(prompt\.txt|request\.json|attachments\/(\d+))$/);
    if (!match) return send(response, 404, "text/plain; charset=utf-8", "Not found\n");
    const stateId = decodeURIComponent(match[1]);
    const request = byState.get(stateId);
    if (!request) return send(response, 404, "text/plain; charset=utf-8", "Unknown state\n");
    if (match[2] === "prompt.txt") return send(response, 200, "text/plain; charset=utf-8", request.prompt);
    if (match[2] === "request.json") return send(response, 200, "application/json", JSON.stringify(request));
    return sendAttachment(response, request, Number(match[3]));
  });
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolvePromise);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not resolve the campaign server address.");
  return { server, url: `http://${host}:${address.port}` };
}

function send(response, status, mime, body) {
  response.statusCode = status;
  response.setHeader("Content-Type", mime);
  response.end(body);
}

function safeFilename(value) {
  return basename(value).replace(/["\\\r\n]/g, "_");
}

function sendAttachment(response, request, imageIndex) {
  const attachment = request.attachments.find((candidate) => candidate.imageIndex === imageIndex);
  if (!attachment) return send(response, 404, "text/plain; charset=utf-8", "Unknown attachment\n");
  const bytes = readFileSync(attachment.source);
  response.statusCode = 200;
  response.setHeader("Content-Type", attachment.mime);
  response.setHeader("Content-Length", bytes.byteLength);
  response.setHeader("Content-Disposition", `inline; filename="${safeFilename(attachment.filename)}"`);
  response.setHeader("X-Zenith-Sha256", attachment.sha256);
  response.end(bytes);
}

function requiredString(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${label} must be a non-empty string.`);
  return value.trim();
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
