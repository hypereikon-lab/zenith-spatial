import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { createInitialZenithDocument, setRoom } from "../domain/project.js";
import { WorkbenchService } from "./workbench-service.js";

describe("WorkbenchService", () => {
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
