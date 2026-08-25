import type { ProjectArtifactSlotId } from "./artifact-topology.js";

export const DOME_SCENE_EDITOR_MODE_IDS = ["compose", "inpaint", "project"] as const;

export type DomeSceneEditorModeId = (typeof DOME_SCENE_EDITOR_MODE_IDS)[number];

export type DomeSceneEditorMode = {
  id: DomeSceneEditorModeId;
  number: string;
  label: string;
  shortLabel: string;
  summary: string;
  primaryArtifactId: ProjectArtifactSlotId;
  artifactIds: readonly ProjectArtifactSlotId[];
};

export const DOME_SCENE_EDITOR_MODES: readonly DomeSceneEditorMode[] = [
  {
    id: "compose",
    number: "01",
    label: "Plate Composition",
    shortLabel: "Compose",
    summary: "Arrange source images and commit the exact projection-aware Plate Sketch.",
    primaryArtifactId: "plate-sketch",
    artifactIds: ["plate-sketch"],
  },
  {
    id: "inpaint",
    number: "02",
    label: "Image Generation",
    shortLabel: "Inpaint",
    summary: "Direct the image model and create an integrated spatial image from the committed Plate Sketch.",
    primaryArtifactId: "finished-image",
    artifactIds: ["plate-sketch", "finished-image"],
  },
  {
    id: "project",
    number: "03",
    label: "Spatial Review",
    shortLabel: "Project",
    summary: "Compare the Plate Sketch and generated image in their source map, dome, or volume.",
    primaryArtifactId: "finished-image",
    artifactIds: ["plate-sketch", "finished-image"],
  },
] as const;

export function domeSceneEditorModeForId(id: DomeSceneEditorModeId | string): DomeSceneEditorMode {
  return DOME_SCENE_EDITOR_MODES.find((mode) => mode.id === id) || DOME_SCENE_EDITOR_MODES[0];
}

export function domeSceneEditorModeIdForArtifact(artifactId: ProjectArtifactSlotId): DomeSceneEditorModeId {
  return artifactId === "plate-sketch" ? "compose" : "project";
}
