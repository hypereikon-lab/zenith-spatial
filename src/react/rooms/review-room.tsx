import { useEffect, useMemo, useRef, useState } from "react";

import { selectedComposition, selectedImageTake, selectedPlateCommit } from "../../domain/project.js";
import type { ImageTake, PlateCommit } from "../../domain/schema.js";
import {
  beginProjectionCameraDrag,
  projectionCameraPointerModifiers,
  updateProjectionCameraDrag,
  updateProjectionCameraWheel,
  type ProjectionCameraDragState,
} from "../../geometry/projection-camera-controller.js";
import {
  createSourceMapPreviewSession,
  type SourceMapPreviewSession,
} from "../../graphics/source-map-preview-session.js";
import {
  defaultPlateEditorCamera,
  plateEditorViewDisabledReason,
  PLATE_EDITOR_VIEW_MODES,
  type PlateEditorCamera,
  type PlateEditorViewMode,
} from "../../plates/plate-editor-view.js";
import { sourceProjectionLabel } from "../../geometry/source-projection.js";
import { chooseImageTake, choosePlateCommit, updateWorkspace } from "../../runtime/workspace-commands.js";
import { useEffectRunner, useWorkbenchSnapshot } from "../runtime-bridge.js";
import { useMediaUrl } from "../use-media-url.js";

type ReviewTarget =
  | { readonly kind: "commit"; readonly value: PlateCommit }
  | { readonly kind: "take"; readonly value: ImageTake };

export function ReviewRoom() {
  const snapshot = useWorkbenchSnapshot();
  const run = useEffectRunner();
  const composition = selectedComposition(snapshot.document);
  const selectedTake = selectedImageTake(composition);
  const selectedCommit = selectedPlateCommit(composition);
  const defaultTargetKey = selectedTake
    ? `take:${selectedTake.id}`
    : selectedCommit
      ? `commit:${selectedCommit.id}`
      : "none";
  const [targetKey, setTargetKey] = useState(defaultTargetKey);
  const [displayMode, setDisplayMode] = useState<"spatial" | "pixels">("spatial");
  const [pixelZoom, setPixelZoom] = useState(50);
  const [showCarrierMask, setShowCarrierMask] = useState(false);
  const [invertCarrierMask, setInvertCarrierMask] = useState(false);
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const [session, setSession] = useState<SourceMapPreviewSession | null>(null);
  const [size, setSize] = useState({ width: 960, height: 720 });
  const [status, setStatus] = useState("Select a Plate Commit or Image Take.");
  const stage = useRef<HTMLDivElement>(null);
  const cameraDrag = useRef<ProjectionCameraDragState | null>(null);
  const renderSerial = useRef(0);

  useEffect(() => setTargetKey(defaultTargetKey), [composition.id, defaultTargetKey]);

  const target = useMemo<ReviewTarget | null>(() => {
    const [kind, id] = targetKey.split(":", 2);
    if (kind === "take") {
      const value = composition.imageTakes.find((candidate) => candidate.id === id);
      return value ? { kind: "take", value } : null;
    }
    if (kind === "commit") {
      const value = composition.plateCommits.find((candidate) => candidate.id === id);
      return value ? { kind: "commit", value } : null;
    }
    return selectedTake
      ? { kind: "take", value: selectedTake }
      : selectedCommit
        ? { kind: "commit", value: selectedCommit }
        : null;
  }, [composition.imageTakes, composition.plateCommits, selectedCommit, selectedTake, targetKey]);
  const asset = target ? snapshot.document.project.assets[target.value.mediaAssetId] : null;
  const mediaUrl = useMediaUrl(asset);
  const spec = target?.value.spatialSpec ?? null;
  const viewMode: PlateEditorViewMode =
    spec && plateEditorViewDisabledReason(snapshot.document.workspace.viewMode, spec.projectionMode)
      ? "source-map"
      : snapshot.document.workspace.viewMode;
  const camera = snapshot.document.workspace.camera as PlateEditorCamera;

  useEffect(() => {
    if (!canvas) return;
    const next = createSourceMapPreviewSession(canvas);
    setSession(next);
    return () => {
      next.destroy();
      setSession((current) => (current === next ? null : current));
    };
  }, [canvas]);

  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const update = () => {
      const rect = element.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      setSize({
        width: Math.max(1, Math.round(rect.width * ratio)),
        height: Math.max(1, Math.round(rect.height * ratio)),
      });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!session || !mediaUrl || !spec || displayMode !== "spatial") return;
    const serial = ++renderSerial.current;
    void session.renderMedia(
      {
        mediaUrl,
        mediaKind: "image",
        projectionProfile: spec.projectionMode,
        viewerMode: snapshot.document.workspace.viewerMode,
        selectedViewMode: viewMode,
        camera,
        domeGuideSemanticSplit: spec.guideSplit,
        domeGuideHorizonSplit: spec.horizonSplit,
        showCaveMask: showCarrierMask,
        invertCaveMask: invertCarrierMask,
        width: size.width,
        height: size.height,
        label: target?.value.label ?? "Spatial image",
        projectionSurface: spec.surface,
      },
      (update) => {
        if (serial === renderSerial.current && update.status) setStatus(update.status);
      },
    );
  }, [
    camera,
    displayMode,
    invertCarrierMask,
    mediaUrl,
    session,
    showCarrierMask,
    size,
    snapshot.document.workspace.viewerMode,
    spec,
    target,
    viewMode,
  ]);

  function setViewMode(next: PlateEditorViewMode) {
    if (!spec || plateEditorViewDisabledReason(next, spec.projectionMode)) return;
    void run(
      updateWorkspace((workspace) => {
        workspace.viewMode = next;
        if (next !== "source-map") {
          const reset = defaultPlateEditorCamera(spec.projectionMode, spec.surface);
          workspace.camera = {
            position: [...reset.position],
            orientation: [...reset.orientation],
            pivot: reset.pivot ? [...reset.pivot] : null,
            fovDegrees: reset.fovDegrees,
            nearMeters: reset.nearMeters ?? 0.01,
            farMeters: reset.farMeters ?? 80,
            mode: reset.mode,
          };
        }
      }),
    );
  }

  function setCamera(next: PlateEditorCamera) {
    void run(
      updateWorkspace((workspace) => {
        workspace.camera = {
          position: [...next.position],
          orientation: [...next.orientation],
          pivot: next.pivot ? [...next.pivot] : null,
          fovDegrees: next.fovDegrees,
          nearMeters: next.nearMeters ?? 0.01,
          farMeters: next.farMeters ?? 80,
          mode: next.mode,
        };
      }),
    );
  }

  function pointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    if (viewMode === "source-map") return;
    cameraDrag.current = beginProjectionCameraDrag({
      pointerId: event.pointerId,
      clientPoint: event,
      rect: event.currentTarget.getBoundingClientRect(),
      viewport: size,
      camera,
      modifiers: projectionCameraPointerModifiers(event),
      clampToViewport: true,
    });
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function pointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!cameraDrag.current) return;
    const update = updateProjectionCameraDrag({
      drag: cameraDrag.current,
      pointerId: event.pointerId,
      clientPoint: event,
      rect: event.currentTarget.getBoundingClientRect(),
      viewport: size,
      viewMode,
      clampToViewport: true,
    });
    cameraDrag.current = update.drag;
    if (update.kind === "updated") setCamera(update.camera as PlateEditorCamera);
  }

  function selectTarget(next: ReviewTarget) {
    setTargetKey(`${next.kind}:${next.value.id}`);
    if (next.kind === "take") void run(chooseImageTake(next.value.id));
    else void run(choosePlateCommit(next.value.id));
  }

  return (
    <section className="workstation review-room" aria-label="Spatial Review">
      <aside className="panel tool-rail">
        <header className="panel-heading">
          <div>
            <span className="eyebrow">Media</span>
            <h2>Review sources</h2>
          </div>
          <strong>{composition.plateCommits.length + composition.imageTakes.length}</strong>
        </header>
        <div className="panel-section flush">
          <h3>Image Takes</h3>
          <div className="revision-list">
            {[...composition.imageTakes].reverse().map((take) => (
              <button
                key={take.id}
                type="button"
                className={
                  target?.kind === "take" && target.value.id === take.id ? "revision-row is-selected" : "revision-row"
                }
                onClick={() => selectTarget({ kind: "take", value: take })}
              >
                <span>{take.kind === "generated" ? "GEN" : "IMP"}</span>
                <strong>{take.label}</strong>
                <small>
                  {take.spatialSpec.targetWidth} × {take.spatialSpec.targetHeight}
                </small>
              </button>
            ))}
          </div>
        </div>
        <div className="panel-section flush">
          <h3>Plate Commits</h3>
          <div className="revision-list">
            {[...composition.plateCommits].reverse().map((commit) => (
              <button
                key={commit.id}
                type="button"
                className={
                  target?.kind === "commit" && target.value.id === commit.id
                    ? "revision-row is-selected"
                    : "revision-row"
                }
                onClick={() => selectTarget({ kind: "commit", value: commit })}
              >
                <span>PLT</span>
                <strong>{commit.label}</strong>
                <small>
                  {commit.draft.raster.width} × {commit.draft.raster.height}
                </small>
              </button>
            ))}
          </div>
        </div>
        <div className="panel-section">
          <h3>Inspection mode</h3>
          <div className="segmented vertical">
            <button
              type="button"
              className={displayMode === "spatial" ? "is-active" : ""}
              onClick={() => setDisplayMode("spatial")}
            >
              Spatial projection
            </button>
            <button
              type="button"
              className={displayMode === "pixels" ? "is-active" : ""}
              onClick={() => setDisplayMode("pixels")}
            >
              Exact pixels
            </button>
          </div>
        </div>
      </aside>

      <div className="viewport-column">
        <div className="viewport-toolbar">
          <div>
            <span className="eyebrow">REVIEW / NON-DESTRUCTIVE</span>
            <h1>{target?.value.label ?? "Spatial Output"}</h1>
          </div>
          <div className="segmented compact">
            {(["domemaster", "dome-check", "rim-check"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                className={snapshot.document.workspace.viewerMode === mode ? "is-active" : ""}
                onClick={() =>
                  void run(
                    updateWorkspace((workspace) => {
                      workspace.viewerMode = mode;
                    }),
                  )
                }
              >
                {mode === "domemaster" ? "Clean" : mode === "dome-check" ? "Guides" : "Edge"}
              </button>
            ))}
          </div>
          <span className="viewport-readout">
            {asset ? `${asset.width} × ${asset.height}` : "NO MEDIA"} ·{" "}
            {spec ? sourceProjectionLabel(spec.projectionMode) : "—"}
          </span>
        </div>
        <div ref={stage} className={displayMode === "pixels" ? "viewport-stage pixel-inspection" : "viewport-stage"}>
          {displayMode === "spatial" ? (
            <canvas
              ref={setCanvas}
              className="review-canvas"
              aria-label="WebGPU spatial image review"
              tabIndex={0}
              onPointerDown={pointerDown}
              onPointerMove={pointerMove}
              onPointerUp={(event) => {
                cameraDrag.current = null;
                if (event.currentTarget.hasPointerCapture(event.pointerId))
                  event.currentTarget.releasePointerCapture(event.pointerId);
              }}
              onPointerCancel={() => {
                cameraDrag.current = null;
              }}
              onWheel={(event) => {
                if (viewMode === "source-map") return;
                event.preventDefault();
                setCamera(
                  updateProjectionCameraWheel({
                    viewMode,
                    camera,
                    deltaY: event.deltaY,
                    modifiers: projectionCameraPointerModifiers(event),
                  }) as PlateEditorCamera,
                );
              }}
            />
          ) : mediaUrl && asset ? (
            <div className="pixel-scroll">
              <img
                src={mediaUrl}
                alt={`${target?.value.label ?? "Image"} exact source pixels`}
                width={asset.width}
                height={asset.height}
                style={{ width: `${pixelZoom}%`, maxWidth: "none" }}
              />
            </div>
          ) : (
            <div className="empty-viewport">
              <strong>No review media</strong>
              <span>Commit a Plate Draft or import an Image Take.</span>
            </div>
          )}
        </div>
        <div className="viewport-status">
          <span className="status-dot" aria-hidden="true" />
          <output>
            {displayMode === "pixels"
              ? "Exact source pixels — no normalization or rewrite is applied in Review."
              : status}
          </output>
          <span>
            {displayMode === "pixels"
              ? `${pixelZoom}% display scale`
              : viewMode === "source-map"
                ? "Carrier map"
                : "Drag to orbit · wheel to dolly"}
          </span>
        </div>
      </div>

      <aside className="panel inspector">
        <header className="panel-heading">
          <div>
            <span className="eyebrow">Spatial spec</span>
            <h2>{target?.kind === "take" ? "Image Take" : "Plate Commit"}</h2>
          </div>
          <strong>{target?.kind === "take" ? "IMG" : "PLT"}</strong>
        </header>
        <div className="inspector-scroll">
          {displayMode === "pixels" ? (
            <div className="panel-section">
              <h3>Pixel zoom</h3>
              <label className="field-stack">
                <span>{pixelZoom}%</span>
                <input
                  type="range"
                  min={10}
                  max={200}
                  step={5}
                  value={pixelZoom}
                  onChange={(event) => setPixelZoom(Number(event.currentTarget.value))}
                />
              </label>
              <button className="button ghost full" type="button" onClick={() => setPixelZoom(100)}>
                Inspect at 100%
              </button>
            </div>
          ) : (
            <>
              <div className="panel-section">
                <h3>Projection view</h3>
                <div className="segmented vertical">
                  {PLATE_EDITOR_VIEW_MODES.map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      disabled={!spec || Boolean(plateEditorViewDisabledReason(mode, spec.projectionMode))}
                      className={viewMode === mode ? "is-active" : ""}
                      onClick={() => setViewMode(mode)}
                    >
                      {viewLabel(mode)}
                    </button>
                  ))}
                </div>
                <div className="check-grid">
                  <label>
                    <input
                      type="checkbox"
                      checked={showCarrierMask}
                      onChange={(event) => setShowCarrierMask(event.currentTarget.checked)}
                    />{" "}
                    Carrier mask
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={invertCarrierMask}
                      onChange={(event) => setInvertCarrierMask(event.currentTarget.checked)}
                    />{" "}
                    Invert mask
                  </label>
                </div>
              </div>
            </>
          )}
          {target && spec ? (
            <div className="panel-section">
              <h3>Pinned metadata</h3>
              <dl className="metadata-list">
                <div>
                  <dt>Identity</dt>
                  <dd>{target.value.id}</dd>
                </div>
                <div>
                  <dt>Projection</dt>
                  <dd>{sourceProjectionLabel(spec.projectionMode)}</dd>
                </div>
                <div>
                  <dt>Target</dt>
                  <dd>
                    {spec.targetWidth} × {spec.targetHeight}
                  </dd>
                </div>
                <div>
                  <dt>Source</dt>
                  <dd>
                    {spec.sourceWidth ?? "?"} × {spec.sourceHeight ?? "?"}
                  </dd>
                </div>
                <div>
                  <dt>Fit</dt>
                  <dd>{spec.fit}</dd>
                </div>
                <div>
                  <dt>Exterior</dt>
                  <dd>{spec.exterior}</dd>
                </div>
                <div>
                  <dt>Created</dt>
                  <dd>{new Date(target.value.createdAt).toLocaleString()}</dd>
                </div>
                {target.kind === "take" ? (
                  <div>
                    <dt>Plate Commit</dt>
                    <dd>{target.value.plateCommitId ?? "Imported without commit"}</dd>
                  </div>
                ) : (
                  <div>
                    <dt>Draft digest</dt>
                    <dd>{target.value.provenance.draftFingerprint.slice(0, 24)}…</dd>
                  </div>
                )}
              </dl>
            </div>
          ) : null}
        </div>
      </aside>
    </section>
  );
}

function viewLabel(mode: PlateEditorViewMode): string {
  if (mode === "source-map") return "Plate Map";
  if (mode === "dome-orbit") return "Dome Stage";
  if (mode === "dome-pov") return "Audience POV";
  return "Volume Room";
}
