import {
  createPlateSketchCommitHandoff,
  type PlateSketchCommitHandoffInput,
} from "./plate-sketch-handoff.js";
import type { PlateSketchCommitPayload } from "./plate-sketch-commit.js";
import type { PlateSketchPreviewInput, PlateSketchPreviewSession } from "./plate-sketch-preview-session.js";

export type ActivePlateSketchCommitSource = {
  session: Pick<PlateSketchPreviewSession, "renderHandoffCanvas">;
  previewInput: PlateSketchPreviewInput;
  commitInput: PlateSketchCommitHandoffInput;
  canCommit: boolean;
  notReadyStatus?: string;
  committingStatus?: string;
  setStatus?: (status: string) => void;
};

export type PlateSketchCommitServiceResult = {
  source: ActivePlateSketchCommitSource;
  handoff: HTMLCanvasElement;
  commit: PlateSketchCommitPayload;
};

let activePlateSketchCommitSource: ActivePlateSketchCommitSource | null = null;
let lastPlateSketchPreviewInput: PlateSketchPreviewInput | null = null;

export function setActivePlateSketchCommitSource(source: ActivePlateSketchCommitSource | null): void {
  activePlateSketchCommitSource = source;
  if (source?.previewInput) {
    lastPlateSketchPreviewInput = source.previewInput;
  }
}

export function clearActivePlateSketchCommitSource(source?: ActivePlateSketchCommitSource | null): void {
  if (!source || activePlateSketchCommitSource === source) {
    activePlateSketchCommitSource = null;
  }
}

export function hasActivePlateSketchCommitSource(): boolean {
  return activePlateSketchCommitSource !== null;
}

export function getActivePlateSketchCommitSource(): ActivePlateSketchCommitSource | null {
  return activePlateSketchCommitSource;
}

export function getLastPlateSketchPreviewInput(): PlateSketchPreviewInput | null {
  return activePlateSketchCommitSource?.previewInput || lastPlateSketchPreviewInput;
}

export function clearLastPlateSketchPreviewInput(): void {
  lastPlateSketchPreviewInput = null;
}

export async function commitActivePlateSketchSource(): Promise<PlateSketchCommitServiceResult | null> {
  const source = activePlateSketchCommitSource;
  if (!source) return null;
  if (!source.canCommit) {
    source.setStatus?.(source.notReadyStatus || "Load at least one plate before committing.");
    return null;
  }

  source.setStatus?.(source.committingStatus || "Committing Plate Sketch handoff...");
  const { handoff, commit } = await createPlateSketchCommitHandoff({
    session: source.session,
    previewInput: source.previewInput,
    commitInput: source.commitInput,
  });
  return {
    source,
    handoff,
    commit,
  };
}
