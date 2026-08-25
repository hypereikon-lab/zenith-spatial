import {
  addArtifactResult,
  finishJob,
  getArtifact,
  recordWorkbenchError,
  replaceArtifactMedia,
  selectArtifact,
  updateArtifact,
  workbench,
} from "../artifacts/artifact-store.svelte.js";
import {
  commitActivePlateSketchSource,
  hasActivePlateSketchCommitSource,
} from "../plates/plate-sketch-commit-service.js";
import type { OperatorId } from "../artifacts/artifact-types.js";
import { disabledReasonForOperator, getOperator, operatorExecutionMode } from "./operator-registry.js";
import { refreshOperatorPreflightStatus } from "./operator-preflight.js";

export async function executeOperator(operatorId: OperatorId): Promise<void> {
  await executeOperatorInternal(operatorId, false);
}

async function executeOperatorInternal(operatorId: OperatorId, confirmed: boolean): Promise<void> {
  const operator = getOperator(operatorId);
  if (operator.preflight?.services?.includes("runway") && workbench.operatorEnvironment.runwayConfigured === null) {
    await refreshOperatorPreflightStatus();
  }
  if (operatorExecutionMode(operator) !== "command") {
    recordWorkbenchError(operator.controlHint || operator.label + " uses a dedicated control.", operatorId);
    return;
  }
  const disabledReason = disabledReasonForOperator(operator);
  if (disabledReason) {
    recordWorkbenchError(disabledReason, operatorId);
    return;
  }
  if (operator.kind === "paid-api" && operator.requiresConfirmation && !confirmed) {
    workbench.pendingPaidAction = {
      operatorId,
      label: operator.label,
      body:
        operator.confirmationBody ||
        "This sends the committed Plate Sketch and visible prompt to a paid image endpoint.",
    };
    return;
  }
  try {
    if (operator.kind === "paid-api") {
      await (await import("./paid-operator-execution.js")).executePaidOperator(operatorId);
    } else {
      await executeLocalOperator(operatorId);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Action failed.";
    if (/cancelled|canceled/i.test(message)) {
      finishJob(operatorId, "Cancelled");
      return;
    }
    recordWorkbenchError(message, operatorId);
    finishJob(operatorId, "Failed");
  }
}

export async function confirmPendingPaidAction(): Promise<void> {
  const pending = workbench.pendingPaidAction;
  if (!pending) return;
  workbench.pendingPaidAction = null;
  await executeOperatorInternal(pending.operatorId, true);
}

export function cancelPendingPaidAction(): void {
  workbench.pendingPaidAction = null;
}

export async function commitActivePlateSketchSourceToWorkbench(): Promise<boolean> {
  const committed = await commitActivePlateSketchSource();
  if (committed) {
    const captureSelectedPlateSketch = (await import("./workbench-sequence-commands.js")).captureSelectedPlateSketch;
    let revision;
    try {
      revision = await captureSelectedPlateSketch({
        artifact: committed.commit.artifactPatch,
        handle: { canvas: committed.handoff },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Plate Sketch revision could not be committed.";
      committed.source.setStatus?.(message);
      recordWorkbenchError(message, "commit-plates");
      return false;
    }
    if (!revision) {
      const message = "Plate Sketch revision could not be committed.";
      committed.source.setStatus?.(message);
      recordWorkbenchError(message, "commit-plates");
      return false;
    }
    replaceArtifactMedia("plate-sketch", {
      patch: committed.commit.artifactPatch,
      handle: { canvas: committed.handoff },
      result: committed.commit.result,
    });
    selectArtifact("plate-sketch");
    committed.source.setStatus?.(committed.commit.status);
    return true;
  }
  return hasActivePlateSketchCommitSource();
}

async function executeLocalOperator(operatorId: OperatorId): Promise<void> {
  switch (operatorId) {
    case "commit-plates":
      if (await commitActivePlateSketchSourceToWorkbench()) return;
      updateArtifact("plate-sketch", {
        status: "ready",
        stale: false,
        summary: "Plate Sketch committed as the image-model handoff.",
        operatorId,
      });
      addArtifactResult("plate-sketch", {
        label: "Committed Plate Sketch",
        media: getArtifact("plate-sketch").media,
        operatorId,
      });
      await (await import("./workbench-sequence-commands.js")).captureSelectedPlateSketch();
      selectArtifact("plate-sketch");
      return;
    case "save-project":
      await (await import("./project-persistence.js")).downloadProjectSnapshot();
      return;
    case "import-plate-sketch":
    case "import-source":
    case "choose-projection":
    case "load-project":
      throw new Error("Action " + operatorId + " is handled by a dedicated control.");
  }
}
