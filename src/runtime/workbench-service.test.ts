import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";

import { createInitialZenithDocument, setRoom } from "../domain/project.js";
import { IdGenerator } from "./id-service.js";
import { WorkbenchService } from "./workbench-service.js";

describe("WorkbenchService", () => {
  it("starts a live browser workspace with standalone demo media ready for Review", async () => {
    const layer = WorkbenchService.Live.pipe(Layer.provide(IdGenerator.deterministic(["project-demo"])));
    const snapshot = await Effect.runPromise(
      Effect.gen(function* () {
        return (yield* WorkbenchService).getSnapshot();
      }).pipe(Effect.provide(layer)),
    );
    const composition = snapshot.document.project.compositions[0]!;

    expect(composition.imageTakes).toHaveLength(1);
    expect(composition.imageTakes[0]).toMatchObject({
      label: "Demo · Forest Domemaster 180°",
      plateCommitId: null,
    });
    expect(composition.selectedImageTakeId).toBe(composition.imageTakes[0]!.id);
  });

  it("publishes validated document snapshots through an explicit external-store bridge", async () => {
    const initial = createInitialZenithDocument({
      now: "2026-01-01T00:00:00.000Z",
      projectId: "project-test",
    });
    let notifications = 0;

    await Effect.runPromise(
      Effect.gen(function* () {
        const workbench = yield* WorkbenchService;
        const unsubscribe = workbench.subscribe(() => notifications++);
        expect(workbench.getSnapshot().document.workspace.room).toBe("compose");

        yield* workbench.updateDocument((document) => setRoom(document, "review"));

        expect(workbench.getSnapshot().document.workspace.room).toBe("review");
        expect(workbench.getSnapshot().revision).toBe(1);
        unsubscribe();
      }).pipe(Effect.provide(WorkbenchService.fromDocument(initial))),
    );

    expect(notifications).toBe(1);
  });
});
