import { lazy, Suspense, useRef, useState } from "react";

import { compositionReadiness, selectedComposition } from "../domain/project.js";
import { downloadBlob } from "../media/canvas-utils.js";
import { importReviewMedia } from "../runtime/browser-workbench-commands.js";
import { addComposition, chooseComposition, chooseRoom, removeComposition } from "../runtime/workspace-commands.js";
import { loadProjectArchive, saveProjectArchive } from "../runtime/project-persistence.js";
import type { Workspace } from "../domain/schema.js";
import { useEffectRunner, useRuntime, useWorkbenchSnapshot } from "./runtime-bridge.js";
import { CloudProjectControl } from "./cloud-project-control.js";

const ComposeRoom = lazy(() => import("./rooms/compose-room.js").then((module) => ({ default: module.ComposeRoom })));
const GenerateRoom = lazy(() =>
  import("./rooms/generate-room.js").then((module) => ({ default: module.GenerateRoom })),
);
const ReviewRoom = lazy(() => import("./rooms/review-room.js").then((module) => ({ default: module.ReviewRoom })));

const rooms: ReadonlyArray<{
  readonly id: Workspace["room"];
  readonly number: string;
  readonly label: string;
  readonly noun: string;
}> = [
  { id: "compose", number: "01", label: "Compose", noun: "Plate Draft" },
  { id: "generate", number: "02", label: "Generate", noun: "Image Takes" },
  { id: "review", number: "03", label: "Review", noun: "Spatial Output" },
];

export function WorkbenchApp() {
  const snapshot = useWorkbenchSnapshot();
  const { workbench } = useRuntime();
  const run = useEffectRunner();
  const composition = selectedComposition(snapshot.document);
  const readiness = compositionReadiness(composition);
  const fileInput = useRef<HTMLInputElement>(null);
  const mediaInput = useRef<HTMLInputElement>(null);
  const [projectStatus, setProjectStatus] = useState("Local project · unsaved changes remain in this browser session");
  const [busy, setBusy] = useState(false);

  async function execute<A>(program: Parameters<typeof run<A, unknown>>[0], scope: string): Promise<A | null> {
    try {
      return await run(program);
    } catch (error) {
      const message = readableError(error);
      await run(workbench.notice("error", message, scope)).catch(() => undefined);
      setProjectStatus(message);
      return null;
    }
  }

  async function saveProject() {
    setBusy(true);
    const archive = await execute(saveProjectArchive, "project-save");
    if (archive) {
      downloadBlob(archive, `zenith-${slug(snapshot.document.project.metadata.title)}-${Date.now()}.zenith`);
      setProjectStatus(`Saved ${snapshot.document.project.compositions.length} compositions with embedded media.`);
    }
    setBusy(false);
  }

  async function loadProject(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    const restored = await execute(loadProjectArchive(file), "project-load");
    if (restored) {
      setProjectStatus(
        restored.migrated
          ? "Loaded and migrated a Zenith v17 project into the current domain."
          : "Loaded Zenith project and restored its embedded media.",
      );
    }
    setBusy(false);
  }

  async function addMedia(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    const imported = await execute(importReviewMedia(file), "media-import");
    if (imported) setProjectStatus(`${imported.label} added directly to Review without changing the Plate.`);
    setBusy(false);
  }

  return (
    <div className="zenith-app">
      <header className="app-header">
        <div className="brand-lockup" aria-label="Zenith spatial workbench">
          <span className="brand-mark">Z</span>
          <div>
            <strong>ZENITH</strong>
            <small>SPATIAL IMAGE WORKBENCH</small>
          </div>
        </div>

        <nav className="room-nav" aria-label="Product flow">
          {rooms.map((room) => {
            const selected = snapshot.document.workspace.room === room.id;
            const disabled =
              room.id === "generate" ? !readiness.canGenerate : room.id === "review" ? !readiness.canReview : false;
            return (
              <button
                key={room.id}
                type="button"
                className={selected ? "room-tab is-active" : "room-tab"}
                aria-current={selected ? "page" : undefined}
                disabled={disabled}
                title={
                  disabled
                    ? room.id === "generate"
                      ? "Commit the current Plate Draft first."
                      : "Commit or import an image first."
                    : room.noun
                }
                onClick={() => void execute(chooseRoom(room.id), "navigation")}
              >
                <span>{room.number}</span>
                <strong>{room.label}</strong>
                <small>{room.noun}</small>
              </button>
            );
          })}
        </nav>

        <div className="header-actions">
          <span className={snapshot.environment.webgpu ? "engine-state is-ready" : "engine-state"}>
            <i aria-hidden="true" /> {snapshot.environment.webgpu ? "WEBGPU" : "CPU / NO GPU"}
          </span>
          <CloudProjectControl />
          <button className="button" type="button" disabled={busy} onClick={() => mediaInput.current?.click()}>
            Add media
          </button>
          <input
            ref={mediaInput}
            className="visually-hidden"
            type="file"
            accept="image/*"
            onChange={(event) => {
              void addMedia(event.currentTarget.files?.[0]);
              event.currentTarget.value = "";
            }}
          />
          <button className="button ghost" type="button" disabled={busy} onClick={() => fileInput.current?.click()}>
            Open
          </button>
          <button className="button" type="button" disabled={busy} onClick={() => void saveProject()}>
            Save
          </button>
          <input
            ref={fileInput}
            className="visually-hidden"
            type="file"
            accept=".zenith,application/vnd.zenith.project,application/json"
            onChange={(event) => {
              void loadProject(event.currentTarget.files?.[0]);
              event.currentTarget.value = "";
            }}
          />
        </div>
      </header>

      <div className="composition-bar">
        <label>
          <span>Composition</span>
          <select
            value={composition.id}
            onChange={(event) => void execute(chooseComposition(event.currentTarget.value), "composition")}
          >
            {snapshot.document.project.compositions.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.label}
              </option>
            ))}
          </select>
        </label>
        <button
          className="tool-button"
          type="button"
          onClick={() => void execute(addComposition(false), "composition")}
        >
          New
        </button>
        <button className="tool-button" type="button" onClick={() => void execute(addComposition(true), "composition")}>
          Duplicate
        </button>
        <button
          className="tool-button danger"
          type="button"
          disabled={snapshot.document.project.compositions.length <= 1}
          onClick={() => void execute(removeComposition(composition.id), "composition")}
        >
          Delete
        </button>
        <div className="readiness-strip" aria-label="Composition readiness">
          <span className={readiness.plateDirty ? "warning" : readiness.missingPlateCommit ? "muted" : "ready"}>
            {readiness.missingPlateCommit ? "NO COMMIT" : readiness.plateDirty ? "DRAFT CHANGED" : "PLATE PINNED"}
          </span>
          <span className={readiness.missingImageTake ? "muted" : readiness.imageTakeStale ? "warning" : "ready"}>
            {readiness.missingImageTake
              ? "NO MEDIA"
              : readiness.standaloneMediaSelected
                ? "MEDIA READY"
                : readiness.imageTakeStale
                  ? "TAKE FROM EARLIER COMMIT"
                  : "TAKE CURRENT"}
          </span>
        </div>
      </div>

      <main className="room-host">
        <Suspense fallback={<RoomLoading />}>
          {snapshot.document.workspace.room === "compose" ? <ComposeRoom key={composition.id} /> : null}
          {snapshot.document.workspace.room === "generate" ? <GenerateRoom key={composition.id} /> : null}
          {snapshot.document.workspace.room === "review" ? <ReviewRoom key={composition.id} /> : null}
        </Suspense>
      </main>

      <footer className="app-footer">
        <span>{projectStatus}</span>
        <span>
          Schema {snapshot.document.project.schemaVersion} · rev {snapshot.revision}
        </span>
      </footer>

      <div className="notice-stack" aria-live="polite">
        {snapshot.notices.slice(0, 3).map((notice) => (
          <output key={notice.id} className={`notice ${notice.level}`}>
            <strong>{notice.scope}</strong>
            {notice.message}
          </output>
        ))}
      </div>
    </div>
  );
}

function RoomLoading() {
  return (
    <div className="boot-screen" aria-busy="true">
      <span className="boot-mark">Z</span>
      <p>Loading spatial room…</p>
    </div>
  );
}

function readableError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error && typeof error.message === "string")
    return error.message;
  return "The operation could not be completed.";
}

function slug(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "project"
  );
}
