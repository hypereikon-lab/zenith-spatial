import type { PlateSketchPreviewInput } from "../plates/plate-sketch-preview-session.js";
import type { PlateSketchImage } from "../plates/plate-sketch-sources.js";
import type { DomeScene } from "./dome-scene.js";

export type DomeSceneEditorSession = ReturnType<typeof createDomeSceneEditorSession>;

export function createDomeSceneEditorSession() {
  return {
    plateRuntime: createDomeScenePlateRuntimeStore(),
    plateSourceSync: createPlateSourceSyncState(),
  };
}

function createDomeScenePlateRuntimeStore() {
  const images = new Map<string, PlateSketchImage>();
  return {
    syncFromPreviewInput(scene: DomeScene, input: PlateSketchPreviewInput): void {
      const liveIds = new Set(scene.frame0.plateLayers.map((layer) => layer.id));
      for (const id of images.keys()) if (!liveIds.has(id)) images.delete(id);
      scene.frame0.plateLayers.forEach((layer, index) => {
        const plate = input.plates[index];
        if (plate?.canvas) images.set(layer.id, plate);
      });
    },
    set(layerId: string, image: PlateSketchImage): void {
      images.set(layerId, image);
    },
    get(layerId: string): PlateSketchImage | null {
      return images.get(layerId) || null;
    },
    clear(): void {
      images.clear();
    },
    size(): number {
      return images.size;
    },
  };
}

function createPlateSourceSyncState() {
  let signature: string | null = null;
  return {
    lastAutoSignature: () => signature,
    setLastAutoSignature(value: string | null): void {
      signature = value;
    },
    reset(): void {
      signature = null;
    },
  };
}
