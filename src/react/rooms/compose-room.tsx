import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { selectedComposition } from "../../domain/project.js";
import type { PlateDraft } from "../../domain/schema.js";
import {
  beginProjectionCameraDrag,
  projectionCameraPointerModifiers,
  updateProjectionCameraDrag,
  updateProjectionCameraWheel,
  type ProjectionCameraDragState,
} from "../../geometry/projection-camera-controller.js";
import { sourceProjectionLabel } from "../../geometry/source-projection.js";
import {
  GENERATION_ASPECT_PRESETS,
  carrierRasterForAspect,
  projectionSurfaceSummary,
  type GenerationAspectPreset,
  type ProjectionSurface,
} from "../../lib/shared/contracts/projection-authoring.js";
import { SOURCE_PROJECTION_MODES, type SourceProjectionMode } from "../../lib/shared/contracts/projection-profile.js";
import { downloadBlob } from "../../media/canvas-utils.js";
import { arrangePlateSketchDefaults, defaultPlateSketchPlacement } from "../../plates/plate-sketch-arrangement.js";
import {
  beginPlateSketchEditorDrag,
  hitTestPlateSketchEditor,
  updatePlateSketchEditorDrag,
  type PlateSketchEditorDrag,
} from "../../plates/plate-sketch-editor-controller.js";
import { renderPlateSketchEditorOverlay } from "../../plates/plate-sketch-editor-overlay.js";
import { createPlateEditorProjectionAdapter } from "../../plates/plate-editor-projection-adapter.js";
import {
  defaultPlateEditorCamera,
  plateEditorViewDisabledReason,
  PLATE_EDITOR_VIEW_MODES,
  type PlateEditorCamera,
  type PlateEditorViewMode,
} from "../../plates/plate-editor-view.js";
import { buildPlateSketchEditorViewModel } from "../../plates/plate-sketch-editor-view-model.js";
import {
  createPlateSketchPreviewSession,
  type PlateSketchPreviewInput,
  type PlateSketchPreviewSession,
} from "../../plates/plate-sketch-preview-session.js";
import { MAX_PLATE_SCALE, MIN_PLATE_SCALE, normalizePlatePlacement } from "../../plates/plate-placement.js";
import type { Point2D } from "../../projection.js";
import {
  changeProjection,
  commitPlate,
  importPlateSources,
  loadSelectedCompositionPlates,
  removePlateSource,
  replacePlateDraft,
  type LoadedCompositionPlate,
} from "../../runtime/browser-workbench-commands.js";
import { updateWorkspace } from "../../runtime/workspace-commands.js";
import { useEffectRunner, useRuntime, useWorkbenchSnapshot } from "../runtime-bridge.js";

const HANDLE_RADIUS = 26;
const HIT_PAD = 0.014;

type ActiveGesture =
  | { readonly kind: "plate"; drag: PlateSketchEditorDrag }
  | { readonly kind: "camera"; drag: ProjectionCameraDragState };

export function ComposeRoom() {
  const snapshot = useWorkbenchSnapshot();
  const { workbench } = useRuntime();
  const run = useEffectRunner();
  const composition = selectedComposition(snapshot.document);
  const draft = composition.plateDraft;
  const visibleLayers = useMemo(
    () => draft.frame.plateLayers.filter((layer) => layer.visible),
    [draft.frame.plateLayers],
  );
  const activeLayerId = snapshot.document.workspace.selectedLayerId ?? draft.frame.activeLayerId;
  const activeIndex = Math.max(
    0,
    visibleLayers.findIndex((layer) => layer.id === activeLayerId),
  );
  const [plates, setPlates] = useState<LoadedCompositionPlate[]>([]);
  const [renderCanvas, setRenderCanvas] = useState<HTMLCanvasElement | null>(null);
  const [overlayCanvas, setOverlayCanvas] = useState<HTMLCanvasElement | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 768, height: 768 });
  const [session, setSession] = useState<PlateSketchPreviewSession | null>(null);
  const [status, setStatus] = useState("Loading projection sources…");
  const [plateEditMode, setPlateEditMode] = useState<"scale" | "warp">("scale");
  const [showCarrierMask, setShowCarrierMask] = useState(false);
  const [invertCarrierMask, setInvertCarrierMask] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const [committing, setCommitting] = useState(false);
  const canvasStack = useRef<HTMLDivElement>(null);
  const plateInput = useRef<HTMLInputElement>(null);
  const gesture = useRef<ActiveGesture | null>(null);
  const renderSerial = useRef(0);
  const sourceKey = draft.frame.plateLayers
    .map((layer) => `${layer.id}:${layer.source.assetId ?? "missing"}:${layer.visible}`)
    .join("|");
  const viewMode: PlateEditorViewMode = plateEditorViewDisabledReason(
    snapshot.document.workspace.viewMode,
    draft.projectionMode,
  )
    ? "source-map"
    : snapshot.document.workspace.viewMode;
  const camera = snapshot.document.workspace.camera as PlateEditorCamera;

  const reportError = useCallback(
    (error: unknown, scope = "compose") => {
      const message = readableError(error);
      setStatus(message);
      void run(workbench.notice("error", message, scope)).catch(() => undefined);
    },
    [run, workbench],
  );

  useEffect(() => {
    let active = true;
    setStatus("Loading composition media…");
    void run(loadSelectedCompositionPlates)
      .then((loaded) => {
        if (!active) return;
        setPlates(loaded);
        setStatus(
          loaded.length > 0
            ? `${loaded.length} source layer${loaded.length === 1 ? "" : "s"} ready for WebGPU composition.`
            : "Import an image source to begin this Plate Draft.",
        );
      })
      .catch((error: unknown) => {
        if (active) reportError(error, "source-load");
      });
    return () => {
      active = false;
    };
  }, [reportError, run, sourceKey]);

  useEffect(() => {
    if (!renderCanvas) return;
    const next = createPlateSketchPreviewSession(renderCanvas);
    setSession(next);
    return () => {
      next.destroy();
      setSession((current) => (current === next ? null : current));
    };
  }, [renderCanvas]);

  useEffect(() => {
    const element = canvasStack.current;
    if (!element) return;
    const update = () => {
      const rect = element.getBoundingClientRect();
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      setCanvasSize({
        width: Math.max(1, Math.round(rect.width * pixelRatio)),
        height: Math.max(1, Math.round(rect.height * pixelRatio)),
      });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const previewInput = useMemo<PlateSketchPreviewInput | null>(() => {
    if (plates.length === 0 || visibleLayers.length !== plates.length) return null;
    return {
      plates,
      placements: visibleLayers.map((layer) => normalizePlatePlacement(layer.placement)),
      canvasWidth: canvasSize.width,
      canvasHeight: canvasSize.height,
      plateFit: draft.frame.plateFit,
      plateFeather: draft.frame.plateFeather,
      domeGuideSemanticSplit: draft.guideSplit,
      domeGuideHorizonSplit: draft.horizonSplit,
      sourceProjectionMode: draft.projectionMode,
      projectionSurface: draft.surface,
      viewerMode: snapshot.document.workspace.viewerMode,
      projectionViewMode: viewMode,
      projectionCamera: camera,
      showCaveMask: showCarrierMask,
      invertCaveMask: invertCarrierMask,
    };
  }, [
    camera,
    canvasSize,
    draft,
    plates,
    showCarrierMask,
    snapshot.document.workspace.viewerMode,
    viewMode,
    visibleLayers,
  ]);

  const drawOverlay = useCallback(() => {
    if (!overlayCanvas || !previewInput) return;
    overlayCanvas.width = canvasSize.width;
    overlayCanvas.height = canvasSize.height;
    const context = overlayCanvas.getContext("2d");
    if (!context) return;
    const adapter = createPlateEditorProjectionAdapter({
      mode: viewMode,
      sourceProjectionMode: draft.projectionMode,
      camera,
      rect: { x: 0, y: 0, width: canvasSize.width, height: canvasSize.height },
      domeGuideSemanticSplit: draft.guideSplit,
      domeGuideHorizonSplit: draft.horizonSplit,
      showCaveMask: showCarrierMask,
      projectionSurface: draft.surface,
    });
    const viewModel = buildPlateSketchEditorViewModel({
      placements: previewInput.placements,
      plates,
      activeIndex,
      sourceProjectionMode: draft.projectionMode,
      innerGuideSplit: draft.guideSplit,
      carrierHorizonRadius: draft.horizonSplit,
      projectionSurface: draft.surface,
      plateFit: draft.frame.plateFit,
      adapter,
    });
    renderPlateSketchEditorOverlay({
      context,
      viewModel,
      canvasWidth: canvasSize.width,
      canvasHeight: canvasSize.height,
      previewWidth: canvasSize.width,
      previewHeight: canvasSize.height,
      activeIndex,
      plateEditMode,
      coordinateSpace: "canvas",
    });
  }, [
    activeIndex,
    camera,
    canvasSize,
    draft,
    overlayCanvas,
    plateEditMode,
    plates,
    previewInput,
    showCarrierMask,
    viewMode,
  ]);

  useEffect(() => {
    if (!session || !previewInput) {
      drawOverlay();
      return;
    }
    const serial = ++renderSerial.current;
    session.scheduleRenderPreview(() => {
      void session
        .renderPreview(previewInput, { shouldRender: () => serial === renderSerial.current })
        .then((nextStatus) => {
          if (serial !== renderSerial.current) return;
          drawOverlay();
          if (nextStatus) setStatus(nextStatus);
        })
        .catch((error: unknown) => {
          if (serial === renderSerial.current) reportError(error, "webgpu-preview");
        });
    });
  }, [drawOverlay, previewInput, reportError, session]);

  useEffect(() => {
    function deleteSelected(event: KeyboardEvent) {
      if ((event.key !== "Delete" && event.key !== "Backspace") || event.repeat || isEditingTarget(event.target))
        return;
      const active = visibleLayers[activeIndex];
      if (!active?.source.assetId) return;
      event.preventDefault();
      void run(removePlateSource(active.source.assetId)).catch((error: unknown) => reportError(error, "source-remove"));
    }
    window.addEventListener("keydown", deleteSelected);
    return () => window.removeEventListener("keydown", deleteSelected);
  }, [activeIndex, reportError, run, visibleLayers]);

  function currentAdapter() {
    return createPlateEditorProjectionAdapter({
      mode: viewMode,
      sourceProjectionMode: draft.projectionMode,
      camera,
      rect: { x: 0, y: 0, width: canvasSize.width, height: canvasSize.height },
      domeGuideSemanticSplit: draft.guideSplit,
      domeGuideHorizonSplit: draft.horizonSplit,
      showCaveMask: showCarrierMask,
      projectionSurface: draft.surface,
    });
  }

  function editorViewModel() {
    return buildPlateSketchEditorViewModel({
      placements: previewInput?.placements ?? [],
      plates,
      activeIndex,
      sourceProjectionMode: draft.projectionMode,
      innerGuideSplit: draft.guideSplit,
      carrierHorizonRadius: draft.horizonSplit,
      projectionSurface: draft.surface,
      plateFit: draft.frame.plateFit,
      adapter: currentAdapter(),
    });
  }

  function pointFromPointer(event: { clientX: number; clientY: number }): Point2D | null {
    if (!overlayCanvas) return null;
    const rect = overlayCanvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvasSize.width,
      y: ((event.clientY - rect.top) / rect.height) * canvasSize.height,
    };
  }

  function selectLayer(layerId: string) {
    mutateDraft((next) => {
      next.frame.activeLayerId = layerId;
    });
    void run(
      updateWorkspace((workspace) => {
        workspace.selectedLayerId = layerId;
      }),
    ).catch((error: unknown) => reportError(error));
  }

  function handlePointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!previewInput || plates.length === 0) return;
    event.currentTarget.focus({ preventScroll: true });
    const point = pointFromPointer(event);
    if (!point) return;
    const adapter = currentAdapter();
    const viewModel = editorViewModel();
    const hit = hitTestPlateSketchEditor({
      point,
      direction: adapter.sourceDirectionAt(point),
      activeIndex,
      geometries: viewModel.geometries,
      placements: previewInput.placements,
      plates,
      sourceProjectionMode: draft.projectionMode,
      innerGuideSplit: draft.guideSplit,
      carrierHorizonRadius: draft.horizonSplit,
      projectionSurface: draft.surface,
      plateFit: draft.frame.plateFit,
      handleRadius: HANDLE_RADIUS * Math.min(window.devicePixelRatio || 1, 2),
      hitLocalPad: HIT_PAD,
      preferActiveBody: true,
    });
    if (hit) {
      const layer = visibleLayers[hit.index];
      if (!layer || layer.locked) return;
      selectLayer(layer.id);
      const drag = beginPlateSketchEditorDrag({
        pointerId: event.pointerId,
        point,
        hit,
        geometry: viewModel.geometries.find((geometry) => geometry.index === hit.index) ?? null,
        placement: previewInput.placements[hit.index],
        plate: plates[hit.index],
        adapter,
        sourceProjectionMode: draft.projectionMode,
        innerGuideSplit: draft.guideSplit,
        carrierHorizonRadius: draft.horizonSplit,
        projectionSurface: draft.surface,
        plateEditMode,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
      });
      if (drag) gesture.current = { kind: "plate", drag };
    } else if (viewMode !== "source-map" && overlayCanvas) {
      gesture.current = {
        kind: "camera",
        drag: beginProjectionCameraDrag({
          pointerId: event.pointerId,
          clientPoint: event,
          rect: overlayCanvas.getBoundingClientRect(),
          viewport: canvasSize,
          camera,
          modifiers: projectionCameraPointerModifiers(event),
          clampToViewport: true,
        }),
      };
    }
    if (gesture.current) event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    const active = gesture.current;
    if (!active) return;
    if (active.kind === "camera") {
      if (!overlayCanvas) return;
      const update = updateProjectionCameraDrag({
        drag: active.drag,
        pointerId: event.pointerId,
        clientPoint: event,
        rect: overlayCanvas.getBoundingClientRect(),
        viewport: canvasSize,
        viewMode,
        clampToViewport: true,
      });
      active.drag = update.drag;
      if (update.kind === "updated") setCamera(update.camera as PlateEditorCamera);
      return;
    }
    const layerIndex = visibleLayers.findIndex((layer) => layer.id === activeLayerId);
    const layer = visibleLayers[layerIndex];
    const plate = plates[layerIndex];
    if (!layer || !plate) return;
    const update = updatePlateSketchEditorDrag({
      drag: active.drag,
      pointerId: event.pointerId,
      point: pointFromPointer(event),
      placement: layer.placement,
      plate,
      adapter: currentAdapter(),
      sourceProjectionMode: draft.projectionMode,
      innerGuideSplit: draft.guideSplit,
      carrierHorizonRadius: draft.horizonSplit,
      projectionSurface: draft.surface,
      minScale: MIN_PLATE_SCALE,
      maxScale: MAX_PLATE_SCALE,
    });
    if (update.kind === "ignored") return;
    active.drag = update.drag;
    mutateDraft((next) => {
      const target = next.frame.plateLayers.find((candidate) => candidate.id === layer.id);
      if (target) target.placement = update.placement;
    });
  }

  function endPointer(event: React.PointerEvent<HTMLCanvasElement>) {
    gesture.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function handleWheel(event: React.WheelEvent<HTMLCanvasElement>) {
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
    ).catch((error: unknown) => reportError(error));
  }

  function setViewMode(next: PlateEditorViewMode) {
    if (plateEditorViewDisabledReason(next, draft.projectionMode)) return;
    void run(
      updateWorkspace((workspace) => {
        workspace.viewMode = next;
        if (next !== "source-map") {
          const reset = defaultPlateEditorCamera(draft.projectionMode, draft.surface);
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
    ).catch((error: unknown) => reportError(error));
  }

  function mutateDraft(update: (next: PlateDraft) => void) {
    const current = structuredClone(selectedComposition(workbench.getSnapshot().document).plateDraft);
    update(current);
    void run(replacePlateDraft(current)).catch((error: unknown) => reportError(error, "plate-draft"));
  }

  async function importFiles(files: ReadonlyArray<File>) {
    setStatus(`Importing ${files.length} image source${files.length === 1 ? "" : "s"}…`);
    try {
      const imported = await run(importPlateSources(files));
      setStatus(`${imported.length} source layer${imported.length === 1 ? "" : "s"} added.`);
    } catch (error) {
      reportError(error, "source-import");
    }
  }

  async function commitCurrentPlate() {
    if (!session || !previewInput) return;
    setCommitting(true);
    setStatus(`Rendering exact ${draft.raster.width} × ${draft.raster.height} Plate Sketch…`);
    try {
      const committed = await run(commitPlate(session, previewInput));
      setStatus(`${committed.label} pinned at ${draft.raster.width} × ${draft.raster.height}.`);
    } catch (error) {
      reportError(error, "plate-commit");
    } finally {
      setCommitting(false);
    }
  }

  async function downloadCurrentPlate() {
    if (!session || !previewInput) return;
    try {
      const handoff = await session.renderHandoffCanvas(previewInput, draft.raster);
      const blob = await new Promise<Blob>((resolve, reject) =>
        handoff.toBlob((result) => (result ? resolve(result) : reject(new Error("PNG encoding failed."))), "image/png"),
      );
      downloadBlob(blob, `zenith-plate-sketch-${draft.raster.width}x${draft.raster.height}.png`);
      setStatus("Exact Plate Sketch PNG downloaded.");
    } catch (error) {
      reportError(error, "plate-download");
    }
  }

  const activeLayer = visibleLayers[activeIndex] ?? null;
  const activePlate = plates[activeIndex] ?? null;

  return (
    <section className="workstation compose-room" aria-label="Compose Plate Draft">
      <aside className="panel tool-rail">
        <PanelHeading eyebrow="Sources" title="Plate layers" value={`${draft.frame.plateLayers.length}`} />
        <div className="layer-list" role="listbox" aria-label="Ordered source layers">
          {[...draft.frame.plateLayers].reverse().map((layer, reverseIndex) => {
            const index = draft.frame.plateLayers.length - reverseIndex - 1;
            const selected = layer.id === activeLayerId;
            return (
              <div key={layer.id} className={selected ? "layer-row is-selected" : "layer-row"}>
                <button type="button" className="layer-main" onClick={() => selectLayer(layer.id)}>
                  <span className="layer-index">{String(index + 1).padStart(2, "0")}</span>
                  <span>
                    <strong>{layer.name}</strong>
                    <small>
                      {Math.round(layer.placement.azimuth)}° · r {layer.placement.radius.toFixed(2)}
                    </small>
                  </span>
                </button>
                <button
                  type="button"
                  className={layer.visible ? "mini-toggle is-on" : "mini-toggle"}
                  aria-label={`${layer.visible ? "Hide" : "Show"} ${layer.name}`}
                  onClick={() =>
                    mutateDraft((next) => {
                      const target = next.frame.plateLayers.find((candidate) => candidate.id === layer.id);
                      if (target) target.visible = !target.visible;
                    })
                  }
                >
                  ◉
                </button>
                <button
                  type="button"
                  className={layer.locked ? "mini-toggle is-on" : "mini-toggle"}
                  aria-label={`${layer.locked ? "Unlock" : "Lock"} ${layer.name}`}
                  onClick={() =>
                    mutateDraft((next) => {
                      const target = next.frame.plateLayers.find((candidate) => candidate.id === layer.id);
                      if (target) target.locked = !target.locked;
                    })
                  }
                >
                  {layer.locked ? "▣" : "□"}
                </button>
              </div>
            );
          })}
        </div>
        <div className="panel-actions stacked">
          <button className="button full" type="button" onClick={() => plateInput.current?.click()}>
            Import sources
          </button>
          <input
            ref={plateInput}
            className="visually-hidden"
            type="file"
            accept="image/*"
            multiple
            onChange={(event) => {
              void importFiles(Array.from(event.currentTarget.files ?? []));
              event.currentTarget.value = "";
            }}
          />
          <button
            className="button ghost full"
            type="button"
            disabled={!activeLayer?.source.assetId}
            onClick={() => {
              if (activeLayer?.source.assetId)
                void run(removePlateSource(activeLayer.source.assetId)).catch((error: unknown) => reportError(error));
            }}
          >
            Remove selected
          </button>
        </div>

        <div className="panel-section">
          <h3>Projection view</h3>
          <div className="segmented vertical">
            {PLATE_EDITOR_VIEW_MODES.map((mode) => {
              const disabled = Boolean(plateEditorViewDisabledReason(mode, draft.projectionMode));
              return (
                <button
                  type="button"
                  key={mode}
                  disabled={disabled}
                  className={viewMode === mode ? "is-active" : ""}
                  onClick={() => setViewMode(mode)}
                >
                  {viewLabel(mode)}
                </button>
              );
            })}
          </div>
          {viewMode !== "source-map" ? (
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
          ) : null}
        </div>
      </aside>

      <div className="viewport-column">
        <div className="viewport-toolbar">
          <div>
            <span className="eyebrow">COMPOSE / PLATE DRAFT</span>
            <h1>Dome Canvas</h1>
          </div>
          <div className="segmented compact" aria-label="Editor transform mode">
            <button
              className={plateEditMode === "scale" ? "is-active" : ""}
              type="button"
              onClick={() => setPlateEditMode("scale")}
            >
              Transform
            </button>
            <button
              className={plateEditMode === "warp" ? "is-active" : ""}
              type="button"
              onClick={() => setPlateEditMode("warp")}
            >
              Corner warp
            </button>
          </div>
          <span className="viewport-readout">
            {draft.raster.width} × {draft.raster.height} · {sourceProjectionLabel(draft.projectionMode)}
          </span>
        </div>
        <div
          className={dropActive ? "viewport-stage is-drop-target" : "viewport-stage"}
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
            void importFiles(Array.from(event.dataTransfer.files));
          }}
        >
          <div
            ref={canvasStack}
            className="canvas-stack"
            style={{ aspectRatio: `${draft.raster.width} / ${draft.raster.height}` }}
          >
            <canvas ref={setRenderCanvas} className="render-canvas" aria-hidden="true" />
            <canvas
              ref={setOverlayCanvas}
              className="overlay-canvas"
              tabIndex={0}
              aria-label="Interactive spatial plate canvas"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={endPointer}
              onPointerCancel={endPointer}
              onWheel={handleWheel}
            />
            {plates.length === 0 ? (
              <button className="empty-viewport" type="button" onClick={() => plateInput.current?.click()}>
                <strong>Drop source images</strong>
                <span>or choose files to begin a spatial Plate Draft</span>
              </button>
            ) : null}
            {dropActive ? <div className="drop-overlay">ADD SOURCE LAYERS</div> : null}
          </div>
        </div>
        <div className="viewport-status">
          <span className="status-dot" aria-hidden="true" />
          <output>{status}</output>
          <span>
            {viewMode === "source-map"
              ? "Drag plates · handles scale/warp · top handle rotates"
              : "Drag empty space to orbit · wheel to dolly"}
          </span>
        </div>
      </div>

      <aside className="panel inspector">
        <PanelHeading
          eyebrow="Inspector"
          title={activeLayer?.name ?? "No layer"}
          value={activeLayer ? `L${activeIndex + 1}` : "—"}
        />
        {activeLayer && activePlate ? (
          <div className="inspector-scroll">
            <div className="panel-section">
              <h3>Placement</h3>
              <NumberField
                label="Azimuth"
                value={activeLayer.placement.azimuth}
                suffix="°"
                min={-360}
                max={360}
                step={1}
                onChange={(value) => patchActivePlacement({ azimuth: value })}
              />
              <NumberField
                label="Radius"
                value={activeLayer.placement.radius}
                min={0}
                max={1}
                step={0.01}
                onChange={(value) => patchActivePlacement({ radius: value })}
              />
              <NumberField
                label="Scale"
                value={activeLayer.placement.scale}
                min={MIN_PLATE_SCALE}
                max={MAX_PLATE_SCALE}
                step={0.01}
                onChange={(value) => patchActivePlacement({ scale: value })}
              />
              <NumberField
                label="Rotation"
                value={activeLayer.placement.spin}
                suffix="°"
                min={-360}
                max={360}
                step={1}
                onChange={(value) => patchActivePlacement({ spin: value })}
              />
              <NumberField
                label="Opacity"
                value={activeLayer.placement.opacity}
                min={0}
                max={1}
                step={0.01}
                onChange={(value) => patchActivePlacement({ opacity: value })}
              />
              <div className="check-grid">
                <label>
                  <input
                    type="checkbox"
                    checked={activeLayer.placement.flipX}
                    onChange={(event) => patchActivePlacement({ flipX: event.currentTarget.checked })}
                  />{" "}
                  Flip X
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={activeLayer.placement.flipY}
                    onChange={(event) => patchActivePlacement({ flipY: event.currentTarget.checked })}
                  />{" "}
                  Flip Y
                </label>
              </div>
              <div className="inline-actions">
                <button
                  className="tool-button"
                  type="button"
                  onClick={() =>
                    patchActivePlacement(
                      normalizePlatePlacement(
                        defaultPlateSketchPlacement(activeIndex, plates.length, activePlate),
                        activePlate,
                      ),
                    )
                  }
                >
                  Reset
                </button>
                <button
                  className="tool-button"
                  type="button"
                  onClick={() => patchActivePlacement({ cornerOffsets: zeroCorners() })}
                >
                  Clear warp
                </button>
              </div>
            </div>

            <div className="panel-section">
              <h3>Composite</h3>
              <label className="field-row">
                <span>Fit</span>
                <select
                  value={draft.frame.plateFit}
                  onChange={(event) =>
                    mutateDraft((next) => {
                      next.frame.plateFit = event.currentTarget.value as PlateDraft["frame"]["plateFit"];
                    })
                  }
                >
                  <option value="contain">Contain</option>
                  <option value="cover">Cover</option>
                  <option value="stretch">Stretch</option>
                </select>
              </label>
              <NumberField
                label="Feather"
                value={draft.frame.plateFeather}
                min={0}
                max={0.25}
                step={0.005}
                onChange={(value) =>
                  mutateDraft((next) => {
                    next.frame.plateFeather = value;
                  })
                }
              />
              <button
                className="button ghost full"
                type="button"
                onClick={() => {
                  const arrangement = arrangePlateSketchDefaults(plates);
                  mutateDraft((next) => {
                    visibleLayers.forEach((layer, index) => {
                      const target = next.frame.plateLayers.find((candidate) => candidate.id === layer.id);
                      if (target && arrangement.placements[index]) target.placement = arrangement.placements[index];
                    });
                  });
                }}
              >
                Auto arrange layers
              </button>
            </div>

            <div className="panel-section">
              <h3>Carrier</h3>
              <label className="field-stack">
                <span>Projection contract</span>
                <select
                  value={draft.projectionMode}
                  onChange={(event) =>
                    void run(changeProjection(event.currentTarget.value as SourceProjectionMode)).catch(
                      (error: unknown) => reportError(error, "projection"),
                    )
                  }
                >
                  {SOURCE_PROJECTION_MODES.map((mode) => (
                    <option key={mode} value={mode}>
                      {sourceProjectionLabel(mode)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field-row">
                <span>Output raster</span>
                <select
                  value={draft.raster.aspectPreset}
                  disabled={draft.projectionMode === "cylinder-wall"}
                  onChange={(event) =>
                    mutateDraft((next) => {
                      next.raster = carrierRasterForAspect(event.currentTarget.value as GenerationAspectPreset);
                    })
                  }
                >
                  {GENERATION_ASPECT_PRESETS.map((preset) => (
                    <option key={preset} value={preset}>
                      {preset}
                    </option>
                  ))}
                </select>
              </label>
              <p className="technical-note">{projectionSurfaceSummary(draft.surface)}</p>
              <SurfaceFields
                surface={draft.surface}
                onChange={(surface) =>
                  mutateDraft((next) => {
                    next.surface = surface;
                  })
                }
              />
              <NumberField
                label="Semantic split"
                value={draft.guideSplit}
                min={0}
                max={1}
                step={0.01}
                onChange={(value) =>
                  mutateDraft((next) => {
                    next.guideSplit = value;
                  })
                }
              />
              <NumberField
                label="Horizon split"
                value={draft.horizonSplit}
                min={0}
                max={1}
                step={0.01}
                onChange={(value) =>
                  mutateDraft((next) => {
                    next.horizonSplit = value;
                  })
                }
              />
            </div>
          </div>
        ) : (
          <p className="empty-copy">Select or import a source layer.</p>
        )}
        <div className="commit-block">
          <button
            className="button primary full"
            type="button"
            disabled={!previewInput || committing}
            onClick={() => void commitCurrentPlate()}
          >
            {committing ? "Committing pixels…" : "Commit Plate"}
          </button>
          <button
            className="button ghost full"
            type="button"
            disabled={!previewInput || committing}
            onClick={() => void downloadCurrentPlate()}
          >
            Download exact PNG
          </button>
          <small>Commit is immutable and pins draft, carrier, source identities, and exact raster.</small>
        </div>
      </aside>
    </section>
  );

  function patchActivePlacement(patch: Partial<typeof activeLayer.placement>) {
    if (!activeLayer || !activePlate) return;
    mutateDraft((next) => {
      const target = next.frame.plateLayers.find((candidate) => candidate.id === activeLayer.id);
      if (target) target.placement = normalizePlatePlacement({ ...target.placement, ...patch }, activePlate);
    });
  }
}

function PanelHeading({ eyebrow, title, value }: { eyebrow: string; title: string; value: string }) {
  return (
    <header className="panel-heading">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h2>{title}</h2>
      </div>
      <strong>{value}</strong>
    </header>
  );
}

function NumberField({
  label,
  value,
  suffix,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  suffix?: string;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="field-row">
      <span>{label}</span>
      <span className="number-input">
        <input
          type="number"
          value={round(value)}
          min={min}
          max={max}
          step={step}
          onChange={(event) => {
            const next = Number(event.currentTarget.value);
            if (Number.isFinite(next)) onChange(next);
          }}
        />
        {suffix ? <i>{suffix}</i> : null}
      </span>
    </label>
  );
}

function SurfaceFields({
  surface,
  onChange,
}: {
  surface: ProjectionSurface;
  onChange: (surface: ProjectionSurface) => void;
}) {
  if (surface.kind === "angular") {
    const anchors = surface.anchors ?? { semanticElevationDegrees: 45, horizonElevationDegrees: 0 };
    return (
      <>
        <NumberField
          label="Semantic elevation"
          value={anchors.semanticElevationDegrees}
          suffix="°"
          min={-89.9}
          max={89.9}
          step={0.5}
          onChange={(value) => onChange({ ...surface, anchors: { ...anchors, semanticElevationDegrees: value } })}
        />
        <NumberField
          label="Horizon elevation"
          value={anchors.horizonElevationDegrees}
          suffix="°"
          min={-89.9}
          max={89.9}
          step={0.5}
          onChange={(value) => onChange({ ...surface, anchors: { ...anchors, horizonElevationDegrees: value } })}
        />
      </>
    );
  }
  if (surface.kind === "cylinder") {
    return (
      <>
        <NumberField
          label="Radius"
          value={surface.radius}
          suffix="m"
          min={0.1}
          step={0.1}
          onChange={(value) => onChange({ ...surface, radius: value })}
        />
        <NumberField
          label="Height"
          value={surface.height}
          suffix="m"
          min={0.2}
          step={0.1}
          onChange={(value) => onChange({ ...surface, height: value })}
        />
        <NumberField
          label="Observer Y"
          value={surface.eyeHeight}
          suffix="m"
          min={0.01}
          max={surface.height - 0.01}
          step={0.05}
          onChange={(value) => onChange({ ...surface, eyeHeight: value })}
        />
      </>
    );
  }
  if (surface.kind === "box-room") {
    return (
      <>
        <NumberField
          label="Width"
          value={surface.width}
          suffix="m"
          min={0.2}
          step={0.1}
          onChange={(value) => onChange({ ...surface, width: value })}
        />
        <NumberField
          label="Depth"
          value={surface.depth}
          suffix="m"
          min={0.2}
          step={0.1}
          onChange={(value) => onChange({ ...surface, depth: value })}
        />
        <NumberField
          label="Height"
          value={surface.height}
          suffix="m"
          min={0.2}
          step={0.1}
          onChange={(value) => onChange({ ...surface, height: value })}
        />
        <NumberField
          label="Observer Y"
          value={surface.eyeHeight}
          suffix="m"
          min={0.01}
          max={surface.height - 0.01}
          step={0.05}
          onChange={(value) => onChange({ ...surface, eyeHeight: value })}
        />
        <NumberField
          label="Observer X"
          value={surface.eyeX}
          suffix="m"
          step={0.05}
          onChange={(value) => onChange({ ...surface, eyeX: value })}
        />
        <NumberField
          label="Observer Z"
          value={surface.eyeZ}
          suffix="m"
          step={0.05}
          onChange={(value) => onChange({ ...surface, eyeZ: value })}
        />
      </>
    );
  }
  return (
    <>
      <NumberField
        label="Length"
        value={surface.length}
        suffix="m"
        min={1}
        step={0.1}
        onChange={(value) => onChange({ ...surface, length: value })}
      />
      <NumberField
        label="Width"
        value={surface.width}
        suffix="m"
        min={1}
        step={0.1}
        onChange={(value) => onChange({ ...surface, width: value })}
      />
      <NumberField
        label="Observer Y"
        value={surface.eyeHeight}
        suffix="m"
        min={0.1}
        step={0.05}
        onChange={(value) => onChange({ ...surface, eyeHeight: value })}
      />
      <NumberField
        label="Observer X"
        value={surface.eyeX}
        suffix="m"
        step={0.05}
        onChange={(value) => onChange({ ...surface, eyeX: value })}
      />
      <NumberField
        label="Observer Z"
        value={surface.eyeZ}
        suffix="m"
        step={0.05}
        onChange={(value) => onChange({ ...surface, eyeZ: value })}
      />
    </>
  );
}

function zeroCorners() {
  return { nw: { x: 0, y: 0 }, ne: { x: 0, y: 0 }, se: { x: 0, y: 0 }, sw: { x: 0, y: 0 } };
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function viewLabel(mode: PlateEditorViewMode): string {
  if (mode === "source-map") return "Plate Map";
  if (mode === "dome-orbit") return "Dome Stage";
  if (mode === "dome-pov") return "Audience POV";
  return "Volume Room";
}

function isEditingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

function readableError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error && typeof error.message === "string")
    return error.message;
  return "Compose operation failed.";
}
