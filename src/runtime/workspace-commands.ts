import { Clock, Effect } from "effect";

import {
  createComposition,
  deleteComposition,
  selectComposition,
  selectImageTake,
  selectPlateCommit,
  setGenerationDirection,
  setRoom,
  updateDocument,
} from "../domain/project.js";
import type { Workspace } from "../domain/schema.js";
import { IdGenerator } from "./id-service.js";
import { MediaRepository } from "./media-repository.js";
import { WorkbenchService } from "./workbench-service.js";

export function updateWorkspace(transform: (workspace: Workspace) => void) {
  return Effect.gen(function* () {
    const workbench = yield* WorkbenchService;
    return yield* workbench.updateDocument((document) =>
      updateDocument(document, (next) => {
        transform(next.workspace);
      }),
    );
  });
}

export function chooseRoom(room: Workspace["room"]) {
  return Effect.gen(function* () {
    const workbench = yield* WorkbenchService;
    return yield* workbench.updateDocument((document) => setRoom(document, room));
  });
}

export function chooseComposition(compositionId: string) {
  return Effect.gen(function* () {
    const workbench = yield* WorkbenchService;
    return yield* workbench.updateDocument((document) => selectComposition(document, compositionId));
  });
}

export function choosePlateCommit(commitId: string) {
  return Effect.gen(function* () {
    const workbench = yield* WorkbenchService;
    return yield* workbench.updateDocument((document) => selectPlateCommit(document, commitId));
  });
}

export function chooseImageTake(takeId: string) {
  return Effect.gen(function* () {
    const workbench = yield* WorkbenchService;
    return yield* workbench.updateDocument((document) => selectImageTake(document, takeId));
  });
}

export function addComposition(duplicateSelected: boolean) {
  return Effect.gen(function* () {
    const workbench = yield* WorkbenchService;
    const ids = yield* IdGenerator;
    const id = yield* ids.next("composition");
    const now = new Date(yield* Clock.currentTimeMillis).toISOString();
    return yield* workbench.updateDocument((document) => createComposition(document, { id, now, duplicateSelected }));
  });
}

export function removeComposition(compositionId: string) {
  return Effect.gen(function* () {
    const workbench = yield* WorkbenchService;
    const repository = yield* MediaRepository;
    const document = yield* workbench.updateDocument((current) => deleteComposition(current, compositionId));
    const runtimeIds = yield* repository.ids;
    yield* Effect.forEach(
      runtimeIds.filter((assetId) => !document.project.assets[assetId]),
      (assetId) => repository.remove(assetId),
      { discard: true },
    );
    return document;
  });
}

export function changeGenerationDirection(direction: string, strategy: "integrated" | "strict") {
  return Effect.gen(function* () {
    const workbench = yield* WorkbenchService;
    return yield* workbench.updateDocument((document) => setGenerationDirection(document, direction, strategy));
  });
}
