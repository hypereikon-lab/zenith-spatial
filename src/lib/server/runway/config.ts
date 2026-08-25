import { join } from "node:path";
import { env as privateEnv } from "$env/dynamic/private";

export const API_BASE = privateEnv.RUNWAY_API_BASE || "https://api.dev.runwayml.com";
export const API_VERSION = privateEnv.RUNWAY_API_VERSION || "2024-11-06";
export const MAX_JSON_BYTES = 128 * 1024 * 1024;
export const POLL_INTERVAL_MS = 2500;
export const POLL_TIMEOUT_MS = 8 * 60 * 1000;
export const INPAINT_MODEL = "gpt_image_2";
export const ZENITH_JOB_STORE_DIR = privateEnv.ZENITH_JOB_STORE_DIR || join(process.cwd(), ".zenith-runtime", "jobs");
export const ZENITH_JOB_RETENTION_MS = positiveNumberFromEnv("ZENITH_JOB_RETENTION_DAYS", 30) * 24 * 60 * 60 * 1000;
export const ZENITH_JOB_MAX_RECORDS = positiveNumberFromEnv("ZENITH_JOB_MAX_RECORDS", 250);

export const INPAINT_MODEL_CONFIG = { ratio: "1920:1920", maxPrompt: 32000, maxReferences: 16 } as const;

export function getRunwayApiKey(): string {
  return privateEnv.RUNWAYML_API_SECRET || "";
}

function positiveNumberFromEnv(name: string, fallback: number): number {
  const value = Number(privateEnv[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
