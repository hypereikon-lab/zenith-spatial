import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { selectedComposition, selectedImageTake, selectedPlateCommit } from "../../domain/project.js";
import type { ImageTake, PlateCommit } from "../../domain/schema.js";
import {
  audienceCameraForProjection,
  audienceFromProjectionCamera,
  normalizeAudienceInSpace,
  walkAudienceInSpace,
} from "../../geometry/audience-in-space.js";
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
import { reviewMediaFilesFromList } from "../../media/browser-image-files.js";
import { downloadBlob } from "../../media/canvas-utils.js";
import {
  captureSpatialTileAtlas,
  reconstructSpatialTileAtlas,
  spatialTileOverlapDegrees,
} from "../../media/spatial-tile-workflow.js";
import type { SpatialTileAtlasManifest } from "../../media/spatial-upscale-metadata.js";
import { importReviewMedia } from "../../runtime/browser-workbench-commands.js";
import { chooseImageTake, choosePlateCommit, updateWorkspace } from "../../runtime/workspace-commands.js";
import { useEffectRunner, useWorkbenchSnapshot } from "../runtime-bridge.js";
import { useMediaUrl } from "../use-media-url.js";
import { ProjectionCameraControls } from "../projection-camera-controls.js";
import { AudienceInSpaceControls, AudienceViewportHud } from "../audience-in-space-controls.js";
import { ImmersivePreviewPanel } from "../immersive-preview.js";

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
  const [pixelZoom, setPixelZoom] = useState(50);
  const [showCarrierMask, setShowCarrierMask] = useState(false);
  const [invertCarrierMask, setInvertCarrierMask] = useState(false);
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const [session, setSession] = useState<SourceMapPreviewSession | null>(null);
  const [size, setSize] = useState({ width: 960, height: 720 });
  const [status, setStatus] = useState("Select a Plate Commit or Image Take.");
  const [dropActive, setDropActive] = useState(false);
  const [importing, setImporting] = useState(false);
  const [spatialProcessing, setSpatialProcessing] = useState<"capture" | "reconstruct" | null>(null);
  const [spatialProgress, setSpatialProgress] = useState(0);
  const [spatialStatus, setSpatialStatus] = useState(
    "Capture six neighboring views, upscale the atlas, then bring it back.",
  );
  const [spatialTileSize, setSpatialTileSize] = useState(512);
  const [lastTileManifest, setLastTileManifest] = useState<SpatialTileAtlasManifest | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const mediaInput = useRef<HTMLInputElement>(null);
  const spatialAtlasInput = useRef<HTMLInputElement>(null);
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
  const standaloneMedia = target?.kind === "take" && isStandaloneReviewMedia(target.value);
  const [displayModePreference, setDisplayModePreference] = useState<{
    readonly targetKey: string;
    readonly mode: "spatial" | "pixels";
  } | null>(null);
  const displayMode =
    displayModePreference?.targetKey === targetKey
      ? displayModePreference.mode
      : standaloneMedia
        ? "pixels"
        : "spatial";
  const setDisplayMode = (mode: "spatial" | "pixels") => setDisplayModePreference({ targetKey, mode });
  const mediaUrl = useMediaUrl(asset);
  const spec = target?.value.spatialSpec ?? null;
  const viewMode: PlateEditorViewMode =
    spec && plateEditorViewDisabledReason(snapshot.document.workspace.viewMode, spec.projectionMode)
      ? "source-map"
      : snapshot.document.workspace.viewMode;
  const audience = useMemo(
    () =>
      spec
        ? normalizeAudienceInSpace(snapshot.document.workspace.audience, spec.projectionMode, spec.surface)
        : snapshot.document.workspace.audience,
    [snapshot.document.workspace.audience, spec],
  );
  const camera = useMemo(
    () =>
      viewMode === "audience-space" && spec
        ? audienceCameraForProjection(audience, spec.projectionMode, spec.surface)
        : (snapshot.document.workspace.camera as PlateEditorCamera),
    [audience, snapshot.document.workspace.camera, spec, viewMode],
  );

  const importPreviewFiles = useCallback(
    async (files: ArrayLike<File>) => {
      const mediaFiles = reviewMediaFilesFromList(files);
      if (mediaFiles.length === 0) {
        setStatus("Drop or choose one or more image or MP4 files.");
        return;
      }
      setImporting(true);
      setStatus(`Adding ${mediaFiles.length} media file${mediaFiles.length === 1 ? "" : "s"} to Review…`);
      try {
        for (const file of mediaFiles) await run(importReviewMedia(file));
        setStatus(
          `${mediaFiles.length} preview item${mediaFiles.length === 1 ? "" : "s"} added without changing the Plate.`,
        );
      } catch (error) {
        setStatus(readableError(error));
      } finally {
        setImporting(false);
      }
    },
    [run],
  );

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
    if (!session) return;
    if (!mediaUrl || !spec || displayMode !== "spatial") {
      renderSerial.current += 1;
      session.clearMedia();
      return;
    }
    const serial = ++renderSerial.current;
    void session.renderMedia(
      {
        mediaUrl,
        mediaKind: asset?.kind ?? "image",
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
    asset?.kind,
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
        if (next !== "source-map" && next !== "audience-space") {
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
        if (viewMode === "audience-space" && spec) {
          workspace.audience = audienceFromProjectionCamera(
            next,
            workspace.audience,
            spec.projectionMode,
            spec.surface,
          );
          return;
        }
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

  async function captureSpatialTiles() {
    if (!mediaUrl || !asset || asset.kind !== "image" || !spec || !target) return;
    setSpatialProcessing("capture");
    setSpatialProgress(0);
    try {
      const result = await captureSpatialTileAtlas(
        {
          mediaUrl,
          projectId: snapshot.document.project.id,
          compositionId: composition.id,
          sourceTargetKind: target.kind,
          sourceTargetId: target.value.id,
          sourceMediaAssetId: target.value.mediaAssetId,
          sourceLabel: target.value.label,
          spatialSpec: spec,
          audience,
          tileSize: spatialTileSize,
        },
        (update) => {
          setSpatialProgress(update.progress);
          setSpatialStatus(update.status);
          setStatus(update.status);
        },
      );
      setLastTileManifest(result.manifest);
      downloadBlob(result.atlas, result.filename);
      setSpatialStatus("Atlas downloaded. Upscale the whole PNG without cropping it, then import it below.");
      setStatus("Six overlapping Audience in Space crops exported with portable Zenith metadata.");
    } catch (error) {
      const message = readableError(error);
      setSpatialStatus(message);
      setStatus(message);
    } finally {
      setSpatialProcessing(null);
    }
  }

  async function reconstructSpatialTiles(file: File) {
    setSpatialProcessing("reconstruct");
    setSpatialProgress(0);
    try {
      const result = await reconstructSpatialTileAtlas(file, lastTileManifest, (update) => {
        setSpatialProgress(update.progress);
        setSpatialStatus(update.status);
        setStatus(update.status);
      });
      const reconstructed = new File([result.image], result.filename, {
        type: "image/png",
        lastModified: Date.now(),
      });
      await run(importReviewMedia(reconstructed));
      setSpatialStatus(
        `${result.scale.toFixed(2)}× master added to Review · ${(result.coverage * 100).toFixed(1)}% carrier coverage.`,
      );
      setStatus("Spatial master reconstructed with exposure compensation and Laplacian pyramid blending.");
    } catch (error) {
      const message = readableError(error);
      setSpatialStatus(message);
      setStatus(message);
    } finally {
      setSpatialProcessing(null);
    }
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
    if (next.kind === "take") {
      void run(chooseImageTake(next.value.id));
    } else void run(choosePlateCommit(next.value.id));
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
        <div className="panel-actions stacked review-media-intake">
          <button
            className="button full"
            type="button"
            disabled={importing}
            onClick={() => mediaInput.current?.click()}
          >
            Add preview media
          </button>
          <input
            ref={mediaInput}
            className="visually-hidden"
            type="file"
            accept="image/*,video/mp4,.mp4"
            multiple
            onChange={(event) => {
              void importPreviewFiles(event.currentTarget.files ?? []);
              event.currentTarget.value = "";
            }}
          />
          <p className="technical-note">Drop completed fulldome images or MP4 video directly on the preview.</p>
        </div>
        <div className="panel-section flush">
          <h3>Media &amp; Image Takes</h3>
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
                <span>
                  {take.kind === "generated"
                    ? "GEN"
                    : take.spatialUpscale
                      ? "SUP"
                      : snapshot.document.project.assets[take.mediaAssetId]?.kind === "video"
                        ? "VID"
                        : isStandaloneReviewMedia(take)
                          ? "MED"
                          : "IMP"}
                </span>
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
          <h3>Original media</h3>
          <button
            className="button ghost full"
            type="button"
            disabled={!mediaUrl || !asset}
            onClick={() => {
              if (!mediaUrl || !asset) return;
              const link = document.createElement("a");
              link.href = mediaUrl;
              link.download = asset.filename;
              link.click();
            }}
          >
            Download original file
          </button>
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
        <div
          ref={stage}
          className={`${displayMode === "pixels" ? "viewport-stage pixel-inspection" : "viewport-stage"}${dropActive ? " is-drop-target" : ""}`}
          onDragEnter={(event) => {
            if (event.dataTransfer.types.includes("Files")) {
              event.preventDefault();
              setDropActive(true);
            }
          }}
          onDragOver={(event) => {
            if (event.dataTransfer.types.includes("Files")) event.preventDefault();
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropActive(false);
          }}
          onDrop={(event) => {
            event.preventDefault();
            setDropActive(false);
            void importPreviewFiles(event.dataTransfer.files);
          }}
        >
          {displayMode === "spatial" ? (
            <>
              <canvas
                ref={setCanvas}
                className="review-canvas"
                aria-label="WebGPU spatial media review"
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
                  if (viewMode === "audience-space" && spec) {
                    const distanceMeters = Math.max(-1.5, Math.min(1.5, (-event.deltaY / 120) * 0.4));
                    void run(
                      updateWorkspace((workspace) => {
                        workspace.audience = walkAudienceInSpace(
                          workspace.audience,
                          distanceMeters,
                          spec.projectionMode,
                          spec.surface,
                        );
                      }),
                    );
                    return;
                  }
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
              {viewMode === "audience-space" && spec ? (
                <AudienceViewportHud audience={audience} projectionMode={spec.projectionMode} surface={spec.surface} />
              ) : null}
            </>
          ) : mediaUrl && asset ? (
            <div className="pixel-scroll">
              {asset.kind === "video" ? (
                <video
                  src={mediaUrl}
                  aria-label={`${target?.value.label ?? "Video"} exact source frames`}
                  width={asset.width}
                  height={asset.height}
                  style={{ width: `${pixelZoom}%`, maxWidth: "none" }}
                  controls
                  loop
                  playsInline
                  preload="metadata"
                />
              ) : (
                <img
                  src={mediaUrl}
                  alt={`${target?.value.label ?? "Image"} exact source pixels`}
                  width={asset.width}
                  height={asset.height}
                  style={{ width: `${pixelZoom}%`, maxWidth: "none" }}
                />
              )}
            </div>
          ) : (
            <div className="empty-viewport">
              <strong>No review media</strong>
              <span>Use Add media for direct viewing, or commit a Plate Draft.</span>
            </div>
          )}
        </div>
        <div className="viewport-status">
          <span className="status-dot" aria-hidden="true" />
          <output>
            {displayMode === "pixels"
              ? asset?.kind === "video"
                ? "Original MP4 frames and audio — no normalization or rewrite is applied in Review."
                : "Exact source pixels — no normalization or rewrite is applied in Review."
              : status}
          </output>
          <span>
            {displayMode === "pixels"
              ? `${pixelZoom}% display scale`
              : viewMode === "source-map"
                ? "Carrier map"
                : viewMode === "audience-space"
                  ? "Drag to look · wheel walks · position is measured in meters"
                  : "Drag to orbit · wheel to dolly"}
          </span>
        </div>
      </div>

      <aside className="panel inspector">
        <header className="panel-heading">
          <div>
            <span className="eyebrow">Spatial spec</span>
            <h2>
              {standaloneMedia
                ? asset?.kind === "video"
                  ? "Video"
                  : "Media"
                : target?.kind === "take" && target.value.spatialUpscale
                  ? "Spatial master"
                  : target?.kind === "take"
                    ? "Image Take"
                    : "Plate Commit"}
            </h2>
          </div>
          <strong>
            {standaloneMedia
              ? asset?.kind === "video"
                ? "VID"
                : "MED"
              : target?.kind === "take" && target.value.spatialUpscale
                ? "SUP"
                : target?.kind === "take"
                  ? "IMG"
                  : "PLT"}
          </strong>
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
                {spec ? (
                  viewMode === "audience-space" ? (
                    <>
                      <AudienceInSpaceControls
                        audience={audience}
                        projectionMode={spec.projectionMode}
                        surface={spec.surface}
                        onChange={(next) =>
                          void run(
                            updateWorkspace((workspace) => {
                              workspace.audience = next;
                            }),
                          )
                        }
                      />
                      <div className="spatial-upscale-panel" aria-label="Spatial tile upscale">
                        <div className="spatial-upscale-heading">
                          <div>
                            <span className="eyebrow">LOCAL / NO PAID CALL</span>
                            <h3>Spatial upscale</h3>
                          </div>
                          <strong>6×</strong>
                        </div>
                        <p>
                          Captures six overlapping views from this exact audience position. Adjacent views overlap by
                          {spatialTileOverlapDegrees()}°. On angular domes, the forward crop begins exactly at the
                          visible rim and a spare polar face preserves its seam coverage.
                        </p>
                        <label className="field-stack">
                          <span>Crop resolution</span>
                          <select
                            value={spatialTileSize}
                            disabled={spatialProcessing !== null}
                            onChange={(event) => setSpatialTileSize(Number(event.currentTarget.value))}
                          >
                            <option value={512}>512 × 512 · balanced</option>
                            <option value={768}>768 × 768 · detailed</option>
                            <option value={1024}>1024 × 1024 · heavy</option>
                          </select>
                        </label>
                        <button
                          className="button full"
                          type="button"
                          disabled={!asset || asset.kind !== "image" || spatialProcessing !== null}
                          onClick={() => void captureSpatialTiles()}
                        >
                          {spatialProcessing === "capture" ? "Capturing spatial crops…" : "1 · Export crop atlas"}
                        </button>
                        <button
                          className="button ghost full"
                          type="button"
                          disabled={spatialProcessing !== null}
                          onClick={() => spatialAtlasInput.current?.click()}
                        >
                          {spatialProcessing === "reconstruct" ? "Stitching master…" : "2 · Import upscaled atlas"}
                        </button>
                        <input
                          ref={spatialAtlasInput}
                          className="visually-hidden"
                          type="file"
                          accept="image/png,.png"
                          onChange={(event) => {
                            const file = event.currentTarget.files?.[0];
                            if (file) void reconstructSpatialTiles(file);
                            event.currentTarget.value = "";
                          }}
                        />
                        {spatialProcessing ? (
                          <progress max={1} value={spatialProgress} aria-label="Spatial upscale progress" />
                        ) : null}
                        <output>{spatialStatus}</output>
                        <small>
                          Keep the 3×2 atlas intact. Zenith restores the original projection with exposure matching and
                          Laplacian pyramid blending.
                        </small>
                      </div>
                    </>
                  ) : (
                    <ProjectionCameraControls
                      viewMode={viewMode}
                      camera={camera}
                      projectionMode={spec.projectionMode}
                      surface={spec.surface}
                      onChange={setCamera}
                    />
                  )
                ) : null}
              </div>
            </>
          )}
          <ImmersivePreviewPanel
            mediaUrl={mediaUrl}
            mediaKind={asset?.kind ?? "image"}
            spec={spec}
            audience={audience}
            label={target?.value.label ?? "Spatial media"}
            contentKey={`${snapshot.document.project.id}:${composition.id}:${target?.kind ?? "none"}:${target?.value.id ?? "none"}:${target?.value.mediaAssetId ?? "none"}`}
          />
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
                    <dd>{target.value.plateCommitId ?? "None — standalone media"}</dd>
                  </div>
                ) : (
                  <div>
                    <dt>Draft digest</dt>
                    <dd>{target.value.provenance.draftFingerprint.slice(0, 24)}…</dd>
                  </div>
                )}
                {target.kind === "take" && target.value.spatialUpscale ? (
                  <>
                    <div>
                      <dt>Spatial source</dt>
                      <dd>{target.value.spatialUpscale.sourceTargetId}</dd>
                    </div>
                    <div>
                      <dt>Upscale</dt>
                      <dd>
                        {target.value.spatialUpscale.scale.toFixed(2)}× · {target.value.spatialUpscale.tileCount} tiles
                      </dd>
                    </div>
                    <div>
                      <dt>Stitch</dt>
                      <dd>{target.value.spatialUpscale.blend}</dd>
                    </div>
                  </>
                ) : null}
              </dl>
            </div>
          ) : null}
        </div>
      </aside>
    </section>
  );
}

function isStandaloneReviewMedia(take: ImageTake | null | undefined): boolean {
  return take?.kind === "imported" && take.plateCommitId === null && !take.provenance && !take.spatialUpscale;
}

function viewLabel(mode: PlateEditorViewMode): string {
  if (mode === "source-map") return "Plate Map";
  if (mode === "dome-orbit") return "Dome Stage";
  if (mode === "dome-pov") return "Audience POV";
  if (mode === "audience-space") return "Audience in Space";
  return "Volume Room";
}

function readableError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error && typeof error.message === "string")
    return error.message;
  return "Preview media could not be imported.";
}
