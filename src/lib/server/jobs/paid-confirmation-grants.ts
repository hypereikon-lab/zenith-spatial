import { createHash, randomBytes } from "node:crypto";
import {
  canonicalPaidConfirmationPayload,
  type PaidConfirmationDigestInput,
} from "$lib/shared/contracts/paid-confirmation";
import type { JobOperatorIdV1 } from "$lib/shared/contracts/jobs";
import { httpError } from "$lib/server/runway/errors";

const GRANT_TTL_MS = 5 * 60 * 1000;
const MAX_GRANTS = 256;

type PaidConfirmationGrantRecord = {
  projectId: string;
  operatorId: JobOperatorIdV1;
  inputDigest: string;
  expiresAt: number;
};

export type PaidConfirmationGrant = {
  confirmationGrant: string;
  expiresAt: string;
};

export type PaidConfirmationGrantStore = {
  issue(input: { projectId: string; operatorId: JobOperatorIdV1; inputDigest: string }): PaidConfirmationGrant;
  consume(input: {
    projectId: string;
    operatorId: JobOperatorIdV1;
    inputDigest: string;
    confirmationGrant: string;
  }): void;
};

export class InMemoryPaidConfirmationGrantStore implements PaidConfirmationGrantStore {
  #grants = new Map<string, PaidConfirmationGrantRecord>();

  issue({
    projectId,
    operatorId,
    inputDigest,
  }: {
    projectId: string;
    operatorId: JobOperatorIdV1;
    inputDigest: string;
  }): PaidConfirmationGrant {
    this.prune();
    if (this.#grants.size >= MAX_GRANTS) {
      const oldestGrant = this.#grants.keys().next().value;
      if (oldestGrant) this.#grants.delete(oldestGrant);
    }

    const confirmationGrant = randomBytes(32).toString("base64url");
    const expiresAt = Date.now() + GRANT_TTL_MS;
    this.#grants.set(confirmationGrant, { projectId, operatorId, inputDigest, expiresAt });
    return { confirmationGrant, expiresAt: new Date(expiresAt).toISOString() };
  }

  consume({
    projectId,
    operatorId,
    inputDigest,
    confirmationGrant,
  }: {
    projectId: string;
    operatorId: JobOperatorIdV1;
    inputDigest: string;
    confirmationGrant: string;
  }): void {
    this.prune();
    const grant = this.#grants.get(confirmationGrant);
    if (!grant) throw httpError(403, "A fresh confirmation is required before this paid job can start.");
    if (grant.projectId !== projectId || grant.operatorId !== operatorId || grant.inputDigest !== inputDigest) {
      throw httpError(403, "This confirmation does not match the paid job request.");
    }
    this.#grants.delete(confirmationGrant);
  }

  clear(): void {
    this.#grants.clear();
  }

  private prune(now = Date.now()): void {
    for (const [grant, record] of this.#grants) {
      if (record.expiresAt <= now) this.#grants.delete(grant);
    }
  }
}

export function serverPaidConfirmationInputDigest(input: PaidConfirmationDigestInput): string {
  return createHash("sha256").update(canonicalPaidConfirmationPayload(input)).digest("hex");
}

export const serverPaidConfirmationGrantStore = new InMemoryPaidConfirmationGrantStore();
