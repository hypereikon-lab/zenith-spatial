import { canvasToBlob } from "../media/canvas-utils.js";
import { buildPlateSketchCommitPayload, type PlateSketchCommitInput } from "./plate-sketch-commit.js";
import type { PlateSketchPreviewInput, PlateSketchPreviewSession } from "./plate-sketch-preview-session.js";

export type PlateSketchCommitHandoffInput = Omit<PlateSketchCommitInput, "dataUrl">;

export type PlateSketchCommitHandoffOptions = {
  session: Pick<PlateSketchPreviewSession, "renderHandoffCanvas">;
  previewInput: PlateSketchPreviewInput;
  commitInput: PlateSketchCommitHandoffInput;
};

export type PlateSketchDownloadHandoffOptions = {
  session: Pick<PlateSketchPreviewSession, "renderHandoffCanvas">;
  previewInput: PlateSketchPreviewInput;
  width: number;
  height: number;
  now?: () => number;
};

export async function createPlateSketchCommitHandoff({
  session,
  previewInput,
  commitInput,
}: PlateSketchCommitHandoffOptions) {
  if (commitInput.commitWidth !== commitInput.raster.width || commitInput.commitHeight !== commitInput.raster.height) {
    throw new Error(
      `Plate Sketch commit raster ${commitInput.commitWidth}×${commitInput.commitHeight} does not match its pinned carrier ${commitInput.raster.width}×${commitInput.raster.height}.`,
    );
  }
  const handoff = await session.renderHandoffCanvas(previewInput, {
    width: commitInput.commitWidth,
    height: commitInput.commitHeight,
  });
  assertHandoffCanvasDimensions(handoff, commitInput.commitWidth, commitInput.commitHeight);
  const commit = buildPlateSketchCommitPayload({
    ...commitInput,
    dataUrl: handoff.toDataURL("image/png"),
  });

  return { handoff, commit };
}

export async function createPlateSketchDownloadHandoff({
  session,
  previewInput,
  width,
  height,
  now = () => Date.now(),
}: PlateSketchDownloadHandoffOptions) {
  const handoff = await session.renderHandoffCanvas(previewInput, { width, height });
  assertHandoffCanvasDimensions(handoff, width, height);
  const blob = await canvasToBlob(handoff, "image/png");

  return {
    handoff,
    blob,
    filename: `zenith-plate-sketch-${width}x${height}-${now()}.png`,
    status: `${width} × ${height} Plate Sketch PNG downloaded.`,
  };
}

function assertHandoffCanvasDimensions(canvas: HTMLCanvasElement, width: number, height: number): void {
  if (canvas.width !== width || canvas.height !== height) {
    throw new Error(
      `Plate Sketch renderer returned ${canvas.width}×${canvas.height}; expected the exact ${width}×${height} carrier raster.`,
    );
  }
}
