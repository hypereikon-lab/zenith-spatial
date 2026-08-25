import {
  activeArtifactMediaRegistry,
  createArtifactMediaRegistry,
  type ArtifactMediaRegistry,
} from "./artifact-media-handles.js";
import { createInitialWorkbenchState, type WorkbenchState } from "./workbench-defaults.js";
import { createDomeSceneEditorSession, type DomeSceneEditorSession } from "../scene/dome-scene-editor-session.js";
import {
  createCompositionSourceMediaRegistry,
  type CompositionSourceMediaRegistry,
} from "../sequence/composition-source-media-handles.js";

export type WorkbenchRuntime = {
  state: WorkbenchState;
  media: ArtifactMediaRegistry;
  compositionSourceMedia: CompositionSourceMediaRegistry;
  editor: DomeSceneEditorSession;
  revisions: { document: number; render: number };
  touch(options?: { render?: boolean }): void;
  destroy(): void;
};

export function createWorkbenchRuntime({
  initialState = createInitialWorkbenchState(),
  media = createArtifactMediaRegistry(),
  editor = createDomeSceneEditorSession(),
  compositionSourceMedia = createCompositionSourceMediaRegistry(),
}: {
  initialState?: WorkbenchState;
  media?: ArtifactMediaRegistry;
  editor?: DomeSceneEditorSession;
  compositionSourceMedia?: CompositionSourceMediaRegistry;
} = {}): WorkbenchRuntime {
  const state = $state(initialState);
  const revisions = $state({ document: 0, render: 0 });
  return {
    state,
    media,
    compositionSourceMedia,
    editor,
    revisions,
    touch({ render = false } = {}): void {
      revisions.document += 1;
      if (render) revisions.render += 1;
    },
    destroy(): void {
      media.clear();
      editor.plateRuntime.clear();
      editor.plateSourceSync.reset();
      compositionSourceMedia.clear();
    },
  };
}

export const activeWorkbenchRuntime = createWorkbenchRuntime({ media: activeArtifactMediaRegistry });
