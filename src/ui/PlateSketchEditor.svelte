<script lang="ts">
  import { onMount } from "svelte";
  import { applyPlateSketchFrame0ToDomeScene } from "../app/dome-scene-editor-commands.js";
  import {
    setAngularProjectionSpatialAnchor,
    setProjectionSurfacePhysicalHorizon,
  } from "../app/workbench-view-commands.js";
  import {
    assignSelectedCompositionSourceReferences,
    importSelectedCompositionSourceFiles,
    removeSelectedCompositionSourceAsset,
    selectedCompositionState,
    updateSelectedCompositionPlateDraft,
  } from "../app/workbench-sequence-commands.js";
  import { commitActivePlateSketchSourceToWorkbench } from "../app/workbench-operator-commands.js";
  import { DEFAULT_PLATE_REFERENCES } from "../plates/default-plate-profile.js";
  import { activeWorkbenchRuntime, workbench } from "../artifacts/artifact-store.svelte.js";
  import { eulerDegreesFromQuaternion, lookAtPivot, quaternionFromEulerDegrees } from "../geometry/camera-rig.js";
  import { nudgeProjectionCamera, projectionCameraControlHelp } from "../geometry/projection-camera-controls.js";
  import {
    beginProjectionCameraDrag,
    projectionCameraPointerModifiers,
    projectionCameraViewportPoint,
    updateProjectionCameraDrag,
    updateProjectionCameraWheel,
  } from "../geometry/projection-camera-controller.js";
  import { downloadBlob } from "../media/canvas-utils.js";
  import { arrangePlateSketchDefaults, defaultPlateSketchPlacement } from "../plates/plate-sketch-arrangement.js";
  import { createPlateSketchDownloadHandoff } from "../plates/plate-sketch-handoff.js";
  import {
    clearActivePlateSketchCommitSource,
    setActivePlateSketchCommitSource,
  } from "../plates/plate-sketch-commit-service.js";
  import { createPlateSketchPreviewSession } from "../plates/plate-sketch-preview-session.js";
  import { domeScenePlateSketchPreviewInput } from "../scene/dome-scene-runtime.js";
  import { MAX_PLATE_SCALE, MIN_PLATE_SCALE, normalizePlatePlacement } from "../plates/plate-placement.js";
  import { compensatePlatePlacementsForProjectionGeometryChange } from "../plates/plate-projection-compensation.js";
  import {
    buildProjectedSpatialAnchorGuides,
    projectedSpatialAnchorHandleHit,
    type ProjectedSpatialAnchorGuide,
    type ProjectedSpatialAnchorId,
  } from "../plates/projected-physical-horizon.js";
  import { defaultPlateEditorCamera, plateEditorViewDisabledReason } from "../plates/plate-editor-view.js";
  import {
    cloneCarrierRaster,
    cloneProjectionSurface,
    projectionSurfaceGeometryFingerprint,
  } from "../lib/shared/contracts/projection-authoring.js";
  import { createPlateEditorProjectionAdapter } from "../plates/plate-editor-projection-adapter.js";
  import {
    beginPlateSketchEditorDrag,
    hitTestPlateSketchEditor,
    updatePlateSketchEditorDrag,
  } from "../plates/plate-sketch-editor-controller.js";
  import {
    plateSketchCommitInputFromEditorSnapshot,
    plateSketchPreviewInputFromEditorSnapshot,
    type PlateSketchEditorSnapshot,
  } from "../plates/plate-sketch-editor-state.js";
  import { renderPlateSketchEditorOverlay } from "../plates/plate-sketch-editor-overlay.js";
  import { buildPlateSketchEditorViewModel } from "../plates/plate-sketch-editor-view-model.js";
  import CameraControlsPanel from "./CameraControlsPanel.svelte";
  import DomeSceneWorkbench from "./DomeSceneWorkbench.svelte";
  import { ActionButton } from "./primitives/index.js";
  import PlateSketchInspectorPanel from "./plate-sketch/PlateSketchInspectorPanel.svelte";
  import PlateSketchSourcePanel from "./plate-sketch/PlateSketchSourcePanel.svelte";
  import PlateSketchViewportSurface from "./plate-sketch/PlateSketchViewportSurface.svelte";
  import type { NormalizedPlatePlacement, PlatePlacementInput, PlateLike } from "../plates/plate-placement.js";
  import type { PlateEditorProjectionAdapter } from "../plates/plate-editor-projection-adapter.js";
  import type { PlateSketchEditorDrag, PlateSketchEditorHit } from "../plates/plate-sketch-editor-controller.js";
  import type { PlateSketchEditorViewModel } from "../plates/plate-sketch-editor-view-model.js";
  import type { PlateSketchPreviewInput, PlateSketchPreviewSession } from "../plates/plate-sketch-preview-session.js";
  import type { PlateSketchImage } from "../plates/plate-sketch-sources.js";
  import type { PlateEditorViewMode } from "../plates/plate-editor-view.js";
  import type { ProjectionCameraDragState } from "../geometry/projection-camera-controller.js";
  import type { Point2D, Rect } from "../projection.js";
  import { plateCompositionSnapshot } from "../sequence/composition-sequence.js";

  const PREVIEW_SIZE = 768;
  const HANDLE_RADIUS = 28;
  const PLATE_HIT_LOCAL_PAD = 0.012;

  let renderCanvas = $state<HTMLCanvasElement | null>(null);
  let previewCanvas = $state<HTMLCanvasElement | null>(null);
  let plates = $state<PlateSketchImage[]>([]);
  let placements = $state<NormalizedPlatePlacement[]>([]);
  let activeIndex = $state(0);
  let plateFit = $state("contain");
  let plateFeather = $state(0.02);
  let plateEditMode = $state<"scale" | "warp">("scale");
  let plateProjectionViewMode = $state<PlateEditorViewMode>("source-map");
  let showCaveMask = $state<boolean>(false);
  let invertCaveMask = $state<boolean>(false);
  let canvasWidth = $state(768);
  let canvasHeight = $state(768);
  let viewCamera = $state(
    defaultPlateEditorCamera(workbench.project.scene.projectionMode, workbench.project.scene.surface),
  );
  let renderStatus = $state("Load plates or use the default references.");
  let renderSerial = 0;
  let previewSession = $state.raw<PlateSketchPreviewSession | null>(null);
  let activeDrag: PlateEditorDrag | null = null;
  let previousProjectionProfile = workbench.project.scene.projectionMode;
  let previousViewerMode = workbench.project.workspace.viewerMode;
  let previousDomeGuideSemanticSplit = workbench.project.scene.guideSplit;
  let previousDomeGuideHorizonSplit = workbench.project.scene.horizonSplit;
  let previousSurfaceFingerprint = JSON.stringify(workbench.project.scene.surface);
  let previousSurfaceGeometryFingerprint = projectionSurfaceGeometryFingerprint(workbench.project.scene.surface);
  let previousRasterFingerprint = JSON.stringify(workbench.project.scene.raster);
  let previousProjectionSurface = cloneProjectionSurface(workbench.project.scene.surface);
  let previousCarrierRaster = cloneCarrierRaster(workbench.project.scene.raster);
  let hydratedDocumentKey = selectedCompositionDocumentKey();
  let hydratedSequenceIdentity = workbench.project.sequence;
  let editorMounted = false;
  let hydratingCue = false;
  let dropActive = $state(false);

  let activePlacement = $derived(placements[activeIndex] || null);
  let activePlate = $derived(plates[activeIndex] || null);
  let canCommit = $derived(plates.length > 0 && placements.length >= plates.length);
  let plateSceneSummary = $derived(
    `${plates.length} plate${plates.length === 1 ? "" : "s"} · ${
      activePlate?.name || "no active source"
    } · ${workbench.project.scene.projectionMode} · ${currentPlateProjectionViewMode()}`,
  );
  let projectedGuides = $derived(projectedSpatialAnchorGuides());

  type PlateEditorDrag =
    | PlateSketchEditorDrag
    | {
        action: "camera";
        pointerId: number;
        state: ProjectionCameraDragState;
      }
    | {
        action: "spatial-anchor";
        pointerId: number;
        anchorId: ProjectedSpatialAnchorId;
      };

  let viewCameraEuler = $derived(eulerDegreesFromQuaternion(viewCamera.orientation));

  onMount(() => {
    ensurePreviewSession();
    window.addEventListener("keydown", handlePlateDeleteKeydown);
    void loadInitialPlates().finally(() => {
      editorMounted = true;
      hydratedDocumentKey = selectedCompositionDocumentKey();
      hydratedSequenceIdentity = workbench.project.sequence;
    });
    return () => {
      window.removeEventListener("keydown", handlePlateDeleteKeydown);
      clearActivePlateSketchCommitSource();
      previewSession?.destroy();
    };
  });

  $effect(() => {
    void activeWorkbenchRuntime.revisions.document;
    const documentKey = selectedCompositionDocumentKey();
    const sequenceIdentity = workbench.project.sequence;
    if (!editorMounted || (documentKey === hydratedDocumentKey && sequenceIdentity === hydratedSequenceIdentity))
      return;
    hydratedDocumentKey = documentKey;
    hydratedSequenceIdentity = sequenceIdentity;
    void hydrateSelectedCueDocument();
  });

  $effect(() => {
    const projectionProfile = workbench.project.scene.projectionMode;
    const viewerMode = workbench.project.workspace.viewerMode;
    const domeGuideSemanticSplit = workbench.project.scene.guideSplit;
    const domeGuideHorizonSplit = workbench.project.scene.horizonSplit;
    const surfaceFingerprint = JSON.stringify(workbench.project.scene.surface);
    const surfaceGeometryFingerprint = projectionSurfaceGeometryFingerprint(workbench.project.scene.surface);
    const rasterFingerprint = JSON.stringify(workbench.project.scene.raster);
    const surfaceChanged = surfaceFingerprint !== previousSurfaceFingerprint;
    const surfaceGeometryChanged = surfaceGeometryFingerprint !== previousSurfaceGeometryFingerprint;
    const rasterChanged = rasterFingerprint !== previousRasterFingerprint;
    if (!previewCanvas) return;
    if (projectionProfile !== previousProjectionProfile) {
      placements = compensatePlatePlacementsForProjectionGeometryChange(
        placements,
        {
          mode: previousProjectionProfile,
          guideSplit: previousDomeGuideSemanticSplit,
          horizonSplit: previousDomeGuideHorizonSplit,
          surface: previousProjectionSurface,
          raster: previousCarrierRaster,
        },
        {
          mode: projectionProfile,
          guideSplit: domeGuideSemanticSplit,
          horizonSplit: domeGuideHorizonSplit,
          surface: workbench.project.scene.surface,
          raster: workbench.project.scene.raster,
        },
      ).map((placement, index) => normalizePlatePlacement(placement, plates[index]));
      previousProjectionProfile = projectionProfile;
      previousDomeGuideSemanticSplit = domeGuideSemanticSplit;
      previousDomeGuideHorizonSplit = domeGuideHorizonSplit;
      previousSurfaceFingerprint = surfaceFingerprint;
      previousSurfaceGeometryFingerprint = surfaceGeometryFingerprint;
      previousRasterFingerprint = rasterFingerprint;
      previousProjectionSurface = cloneProjectionSurface(workbench.project.scene.surface);
      previousCarrierRaster = cloneCarrierRaster(workbench.project.scene.raster);
      viewCamera = defaultPlateEditorCamera(projectionProfile, workbench.project.scene.surface);
      if (plateEditorViewDisabledReason(plateProjectionViewMode, projectionProfile)) {
        plateProjectionViewMode = "source-map";
      }
      renderPreview();
      return;
    }
    if (viewerMode !== previousViewerMode) {
      previousViewerMode = viewerMode;
      // Review diagnostics are rendered by the governed GPU preview. The 2D
      // canvas now owns interaction handles only.
      renderPreview();
    }
    if (
      domeGuideSemanticSplit !== previousDomeGuideSemanticSplit ||
      domeGuideHorizonSplit !== previousDomeGuideHorizonSplit
    ) {
      placements = compensatePlatePlacementsForProjectionGeometryChange(
        placements,
        {
          mode: projectionProfile,
          guideSplit: previousDomeGuideSemanticSplit,
          horizonSplit: previousDomeGuideHorizonSplit,
          surface: previousProjectionSurface,
          raster: previousCarrierRaster,
        },
        {
          mode: projectionProfile,
          guideSplit: domeGuideSemanticSplit,
          horizonSplit: domeGuideHorizonSplit,
          surface: workbench.project.scene.surface,
          raster: workbench.project.scene.raster,
        },
      ).map((placement, index) => normalizePlatePlacement(placement, plates[index]));
      previousDomeGuideSemanticSplit = domeGuideSemanticSplit;
      previousDomeGuideHorizonSplit = domeGuideHorizonSplit;
      previousSurfaceFingerprint = surfaceFingerprint;
      previousSurfaceGeometryFingerprint = surfaceGeometryFingerprint;
      previousRasterFingerprint = rasterFingerprint;
      previousProjectionSurface = cloneProjectionSurface(workbench.project.scene.surface);
      previousCarrierRaster = cloneCarrierRaster(workbench.project.scene.raster);
      if (surfaceGeometryChanged) {
        viewCamera = defaultPlateEditorCamera(projectionProfile, workbench.project.scene.surface);
      }
      renderPreview();
      return;
    }
    if (surfaceChanged || rasterChanged) {
      if (surfaceGeometryChanged || rasterChanged) {
        placements = compensatePlatePlacementsForProjectionGeometryChange(
          placements,
          {
            mode: projectionProfile,
            guideSplit: domeGuideSemanticSplit,
            horizonSplit: domeGuideHorizonSplit,
            surface: previousProjectionSurface,
            raster: previousCarrierRaster,
          },
          {
            mode: projectionProfile,
            guideSplit: domeGuideSemanticSplit,
            horizonSplit: domeGuideHorizonSplit,
            surface: workbench.project.scene.surface,
            raster: workbench.project.scene.raster,
          },
        ).map((placement, index) => normalizePlatePlacement(placement, plates[index]));
      }
      previousSurfaceFingerprint = surfaceFingerprint;
      previousSurfaceGeometryFingerprint = surfaceGeometryFingerprint;
      previousRasterFingerprint = rasterFingerprint;
      previousProjectionSurface = cloneProjectionSurface(workbench.project.scene.surface);
      previousCarrierRaster = cloneCarrierRaster(workbench.project.scene.raster);
      if (surfaceGeometryChanged) {
        viewCamera = defaultPlateEditorCamera(projectionProfile, workbench.project.scene.surface);
      }
      renderPreview();
    }
  });

  $effect(() => {
    if (!previewCanvas) return;
    const updateSize = () => {
      if (!previewCanvas) return;
      const rect = previewCanvas.getBoundingClientRect();
      const pixelRatio = window.devicePixelRatio || 1;
      const w = Math.max(1, Math.round(rect.width * pixelRatio));
      const h = Math.max(1, Math.round(rect.height * pixelRatio));
      if (canvasWidth !== w || canvasHeight !== h) {
        canvasWidth = w;
        canvasHeight = h;
      }
    };
    updateSize();

    const observer = new ResizeObserver(() => {
      updateSize();
    });
    observer.observe(previewCanvas);

    window.addEventListener("resize", updateSize);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateSize);
    };
  });

  $effect(() => {
    viewCamera;
    plateProjectionViewMode;
    showCaveMask;
    invertCaveMask;
    canvasWidth;
    canvasHeight;
    scheduleRenderPreview();
  });

  $effect(() => {
    const session = previewSession;
    plates;
    placements;
    canvasWidth;
    plateFit;
    plateFeather;
    plateEditMode;
    viewCamera;
    workbench.project.scene.guideSplit;
    workbench.project.scene.horizonSplit;
    workbench.project.scene.projectionMode;
    workbench.project.scene.surface;
    workbench.project.scene.raster;
    workbench.project.workspace.viewerMode;
    showCaveMask;
    invertCaveMask;
    if (hydratingCue) return;
    const input = buildPreviewInput();
    const source = session ? activeCommitSource(session, input) : null;
    setActivePlateSketchCommitSource(source);
    applyPlateSketchFrame0ToDomeScene(input, { activeIndex });
    updateSelectedCompositionPlateDraft(plateCompositionSnapshot(workbench.project.scene));
    return () => clearActivePlateSketchCommitSource(source);
  });

  async function handlePlateInput(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    await loadPlateFiles(Array.from(input.files || []));
    input.value = "";
  }

  async function loadDefaultPlates() {
    if (plates.length > 0 || DEFAULT_PLATE_REFERENCES.length === 0) return;
    renderStatus = "Loading default plate references...";
    try {
      await assignSelectedCompositionSourceReferences([...DEFAULT_PLATE_REFERENCES], { replace: true });
      hydratedDocumentKey = selectedCompositionDocumentKey();
      hydratedSequenceIdentity = workbench.project.sequence;
      await hydrateSelectedCueDocument();
    } catch (error) {
      renderStatus = error instanceof Error ? error.message : "Default plate references could not be loaded.";
    }
  }

  async function loadInitialPlates() {
    if (await loadSceneFrame0Plates()) return;
    await loadDefaultPlates();
  }

  function selectedCompositionDocumentKey(): string {
    const composition = selectedCompositionState();
    return `${workbench.project.workspace.selectedCompositionId || "none"}:${composition?.sourceAssetIds.join("|") || "empty"}`;
  }

  async function hydrateSelectedCueDocument(): Promise<void> {
    hydratingCue = true;
    plates = [];
    placements = [];
    activeIndex = 0;
    plateFit = workbench.project.scene.frame0.plateFit;
    plateFeather = workbench.project.scene.frame0.plateFeather;
    const loaded = await loadSceneFrame0Plates();
    if (!loaded) {
      renderStatus = "Blank Composition Cue — load plates or import a Plate Sketch.";
      renderOverlay();
    }
    hydratingCue = false;
    scheduleRenderPreview();
  }

  async function loadSceneFrame0Plates(): Promise<boolean> {
    if (plates.length > 0 || workbench.project.scene.frame0.plateLayers.length === 0) return false;
    renderStatus = "Loading Dome Scene frame 0 plate layers...";
    const input = await domeScenePlateSketchPreviewInput(workbench.project.scene, {
      canvasWidth,
      canvasHeight,
      viewerMode: workbench.project.workspace.viewerMode,
      projectionViewMode: currentPlateProjectionViewMode(),
      projectionCamera: viewCamera,
      showCaveMask,
      invertCaveMask,
    });
    if (!input) {
      renderStatus = "Dome Scene frame 0 has no readable live plate sources.";
      return false;
    }
    plates = input.plates;
    placements = input.placements;
    plateFit = input.plateFit;
    plateFeather = input.plateFeather;
    activeIndex = Math.max(
      0,
      workbench.project.scene.frame0.plateLayers.findIndex(
        (layer) => layer.id === workbench.project.scene.frame0.activeLayerId,
      ),
    );
    renderPreview();
    return true;
  }

  async function loadPlateFiles(files: File[], dropPoint: Point2D | null = null) {
    const imageFiles = files.filter((file) => file.type.startsWith("image/"));
    if (imageFiles.length === 0) {
      renderStatus = "No image plates selected.";
      return;
    }
    renderStatus = `Adding ${imageFiles.length} Plate source${imageFiles.length === 1 ? "" : "s"}...`;
    try {
      const assets = await importSelectedCompositionSourceFiles(imageFiles, { replace: false });
      hydratedDocumentKey = selectedCompositionDocumentKey();
      hydratedSequenceIdentity = workbench.project.sequence;
      await hydrateSelectedCueDocument();
      const addedIndex = plates.findIndex((plate) => plate.assetId === assets.at(-1)?.id);
      if (addedIndex >= 0) {
        activeIndex = addedIndex;
        const sourcePoint = dropPoint ? currentProjectionAdapter().sourcePointAt(dropPoint) : null;
        if (sourcePoint && placements[addedIndex]) {
          placements[addedIndex] = normalizePlatePlacement(
            { ...placements[addedIndex], radius: sourcePoint.radius, azimuth: sourcePoint.azimuth },
            plates[addedIndex],
          );
          placements = [...placements];
        }
      }
      renderPreview();
      renderStatus = `${imageFiles.length} Plate source${imageFiles.length === 1 ? "" : "s"} added to this Composition.`;
    } catch (error) {
      renderStatus = error instanceof Error ? error.message : "Could not assign Plate sources.";
    }
  }

  async function removeActivePlate(): Promise<void> {
    const plate = activePlate;
    if (!plate) return;
    const removedIndex = activeIndex;
    renderStatus = `Removing ${plate.name}...`;
    if (plate.assetId) {
      if (!removeSelectedCompositionSourceAsset(plate.assetId)) {
        renderStatus = `${plate.name} could not be removed from this Composition.`;
        return;
      }
      hydratedDocumentKey = selectedCompositionDocumentKey();
      hydratedSequenceIdentity = workbench.project.sequence;
      await hydrateSelectedCueDocument();
    } else {
      plates = plates.filter((_, index) => index !== removedIndex);
      placements = placements.filter((_, index) => index !== removedIndex);
    }
    activeIndex = Math.max(0, Math.min(removedIndex, plates.length - 1));
    activeDrag = null;
    renderPreview();
    renderStatus = `${plate.name} removed. ${plates.length} Plate source${plates.length === 1 ? "" : "s"} remain.`;
  }

  function handlePlateDeleteKeydown(event: KeyboardEvent): void {
    if ((event.key !== "Delete" && event.key !== "Backspace") || event.repeat || event.metaKey || event.ctrlKey) return;
    if (!activePlate || isTextEditingTarget(event.target)) return;
    event.preventDefault();
    void removeActivePlate();
  }

  function isTextEditingTarget(target: EventTarget | null): boolean {
    return (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      (target instanceof HTMLElement && target.isContentEditable)
    );
  }

  function handlePlateDragEnter(event: DragEvent): void {
    if (!hasDraggedImages(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    dropActive = true;
  }

  function handlePlateDragOver(event: DragEvent): void {
    if (!hasDraggedImages(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    dropActive = true;
  }

  function handlePlateDragLeave(event: DragEvent): void {
    const current = event.currentTarget;
    const related = event.relatedTarget;
    if (current instanceof HTMLElement && related instanceof Node && current.contains(related)) return;
    dropActive = false;
  }

  function handlePlateDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    dropActive = false;
    const droppedFiles = Array.from(event.dataTransfer?.files || []);
    if (droppedFiles.length === 0) {
      renderStatus = "Drop one or more image files to add Plate sources.";
      return;
    }
    const point = clientToCanvasPoint(event);
    void materializeDroppedFiles(droppedFiles)
      .then((files) => loadPlateFiles(files, point))
      .catch((error) => {
        renderStatus = error instanceof Error ? error.message : "Dropped Plate sources could not be read.";
      });
  }

  function materializeDroppedFiles(files: File[]): Promise<File[]> {
    return Promise.all(
      files.map(
        async (file) =>
          new File([await file.arrayBuffer()], file.name, {
            type: file.type,
            lastModified: file.lastModified,
          }),
      ),
    );
  }

  function hasDraggedImages(dataTransfer: DataTransfer | null): boolean {
    if (!dataTransfer) return false;
    const items = Array.from(dataTransfer.items || []);
    if (items.length === 0) return Array.from(dataTransfer.types || []).includes("Files");
    return items.some((item) => item.kind === "file" && (!item.type || item.type.startsWith("image/")));
  }

  function autoArrange(force: boolean) {
    if (plates.length === 0) return;
    if (!force && placements.length === plates.length) return;
    const arrangement = arrangePlateSketchDefaults(plates);
    placements = arrangement.placements;
    activeIndex = arrangement.activeIndex;
  }

  function defaultPlatePlacement(index: number, plateCount: number, plate: PlateLike): PlatePlacementInput {
    return defaultPlateSketchPlacement(index, plateCount, plate);
  }

  function updateActivePlacement(patch: Partial<NormalizedPlatePlacement>) {
    if (!activePlacement || !activePlate) return;
    placements[activeIndex] = normalizePlatePlacement({ ...activePlacement, ...patch }, activePlate);
    placements = [...placements];
    scheduleRenderPreview();
  }

  function resetActivePlate() {
    if (!activePlate) return;
    placements[activeIndex] = normalizePlatePlacement(
      defaultPlatePlacement(activeIndex, plates.length, activePlate),
      activePlate,
    );
    placements = [...placements];
    renderPreview();
  }

  function selectPlate(index: number) {
    if (index < 0 || index >= plates.length) return;
    activeIndex = index;
    renderOverlay();
  }

  function plateLayerPlacementLabel(index: number): string {
    const placement = placements[index];
    if (!placement) return "unplaced raster source";
    return `${Math.round(placement.azimuth)} deg / r ${placement.radius.toFixed(2)} / ${Math.round(placement.opacity * 100)}%`;
  }

  function plateOptions() {
    return plates.map((plate, index) => ({
      value: String(index),
      label: `${index + 1}. ${plate.name}`,
    }));
  }

  function setActivePlateValue(value: string): void {
    activeIndex = Number(value);
    renderOverlay();
  }

  function setPlateFit(value: string): void {
    plateFit = value;
    renderPreview();
  }

  function setPlateEditMode(value: string): void {
    if (value !== "scale" && value !== "warp") return;
    plateEditMode = value;
    renderOverlay();
  }

  function setPlateFeather(value: number): void {
    plateFeather = value;
    renderPreview();
  }

  function autoArrangeAndRender(): void {
    autoArrange(true);
    renderPreview();
  }

  function ensurePreviewSession(): PlateSketchPreviewSession {
    if (previewSession) return previewSession;
    if (!renderCanvas) throw new Error("Plate Sketch WebGPU canvas is not mounted.");
    previewSession = createPlateSketchPreviewSession(renderCanvas);
    return previewSession;
  }

  function renderPreview() {
    void renderPreviewAsync();
  }

  async function renderPreviewAsync() {
    if (!renderCanvas || !previewCanvas) return;
    const serial = ++renderSerial;
    if (plates.length === 0 || placements.length === 0) {
      renderOverlay();
      return;
    }
    try {
      renderStatus = "Rendering WebGPU plate sketch preview...";
      const status = await ensurePreviewSession().renderPreview(buildPreviewInput());
      if (serial !== renderSerial) return;
      renderOverlay();
      if (status) renderStatus = status;
    } catch (error) {
      if (serial !== renderSerial) return;
      console.error(error);
      renderStatus = error instanceof Error ? error.message : "Could not render Plate Sketch preview.";
    }
  }

  function buildPreviewInput(): PlateSketchPreviewInput {
    return plateSketchPreviewInputFromEditorSnapshot(plateEditorSnapshot());
  }

  function buildCommitInput() {
    return plateSketchCommitInputFromEditorSnapshot(plateEditorSnapshot(), workbench.project.scene.raster);
  }

  function plateEditorSnapshot(): PlateSketchEditorSnapshot {
    return {
      plates,
      placements,
      canvasWidth,
      canvasHeight,
      plateFit,
      plateFeather,
      plateEditMode,
      domeGuideSemanticSplit: workbench.project.scene.guideSplit,
      domeGuideHorizonSplit: workbench.project.scene.horizonSplit,
      projectionProfile: workbench.project.scene.projectionMode,
      projectionSurface: workbench.project.scene.surface,
      projectionViewMode: currentPlateProjectionViewMode(),
      projectionCamera: viewCamera,
      viewerMode: workbench.project.workspace.viewerMode,
      showCaveMask,
      invertCaveMask,
    };
  }

  function activeCommitSource(session: PlateSketchPreviewSession, previewInput = buildPreviewInput()) {
    return {
      session,
      previewInput,
      commitInput: buildCommitInput(),
      canCommit,
      notReadyStatus: "Load at least one plate before committing.",
      committingStatus: `Committing ${workbench.project.scene.raster.width} × ${workbench.project.scene.raster.height} inpaint handoff...`,
      setStatus(status: string) {
        renderStatus = status;
      },
    };
  }

  function scheduleRenderPreview() {
    ensurePreviewSession().scheduleRenderPreview(renderPreview);
  }

  function renderOverlay() {
    if (!previewCanvas) return;
    previewCanvas.width = canvasWidth;
    previewCanvas.height = canvasHeight;
    const context = previewCanvas.getContext("2d");
    if (!context) return;
    const preview = previewViewport();
    renderPlateSketchEditorOverlay({
      context,
      viewModel: plateEditorViewModel(),
      canvasWidth,
      canvasHeight,
      previewWidth: preview.width,
      previewHeight: preview.height,
      activeIndex,
      plateEditMode,
      projectedGuides,
    });
  }

  async function commitPlateSketch() {
    await commitActivePlateSketchSourceToWorkbench();
  }

  async function downloadCurrentHandoff() {
    if (!canCommit) {
      renderStatus = "Load at least one plate before downloading.";
      return;
    }
    const { width, height } = workbench.project.scene.raster;
    renderStatus = `Rendering ${width} × ${height} Plate Sketch PNG...`;
    const handoff = await createPlateSketchDownloadHandoff({
      session: ensurePreviewSession(),
      previewInput: buildPreviewInput(),
      width,
      height,
    });
    downloadBlob(handoff.blob, handoff.filename);
    renderStatus = handoff.status;
  }

  function handlePointerDown(event: PointerEvent) {
    if (!previewCanvas) return;
    previewCanvas.focus({ preventScroll: true });
    const point = pointerToCanvasPoint(event);
    const projectedAnchor = projectedSpatialAnchorHandleHit(point, projectedGuides, HANDLE_RADIUS);
    if (currentPlateProjectionViewMode() !== "source-map" && projectedAnchor) {
      event.preventDefault();
      activeDrag = {
        action: "spatial-anchor",
        pointerId: event.pointerId,
        anchorId: projectedAnchor.id,
      };
      previewCanvas.setPointerCapture(event.pointerId);
      return;
    }
    if (plates.length === 0 || placements.length === 0) return;
    const viewModel = plateEditorViewModel();
    const hit = hitTestPlate(event, viewModel);
    if (!hit) {
      if (currentPlateProjectionViewMode() !== "source-map") {
        const cameraDrag = beginCameraDrag(event);
        if (!cameraDrag) return;
        activeDrag = {
          action: "camera",
          pointerId: event.pointerId,
          state: cameraDrag,
        };
        previewCanvas.setPointerCapture(event.pointerId);
      }
      return;
    }
    activeIndex = hit.index;
    const placement = placements[activeIndex];
    const drag = createPlateDrag(event, hit, placement, viewModel);
    if (!drag) return;
    activeDrag = drag;
    previewCanvas.setPointerCapture(event.pointerId);
    renderOverlay();
  }

  function handlePointerMove(event: PointerEvent) {
    if (!activeDrag || event.pointerId !== activeDrag.pointerId) return;
    if (activeDrag.action === "camera") {
      updateCameraDrag(event, activeDrag);
    } else if (activeDrag.action === "spatial-anchor") {
      updateProjectedSpatialAnchorDrag(event, activeDrag);
    } else {
      updatePlateDrag(event, activeDrag);
    }
  }

  function handlePointerUp(event: PointerEvent) {
    if (!activeDrag || event.pointerId !== activeDrag.pointerId) return;
    activeDrag = null;
    if (event.currentTarget instanceof HTMLElement && event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } else if (previewCanvas?.hasPointerCapture(event.pointerId)) {
      previewCanvas.releasePointerCapture(event.pointerId);
    }
  }

  function handleProjectedGuidePointerDown(event: PointerEvent, anchorId: ProjectedSpatialAnchorId): void {
    if (!projectedGuides.some((guide) => guide.id === anchorId) || !(event.currentTarget instanceof HTMLElement))
      return;
    event.preventDefault();
    event.stopPropagation();
    activeDrag = {
      action: "spatial-anchor",
      pointerId: event.pointerId,
      anchorId,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleProjectedGuideKeydown(event: KeyboardEvent, anchorId: ProjectedSpatialAnchorId): void {
    const guide = projectedGuides.find((candidate) => candidate.id === anchorId);
    if (!guide) return;
    const direction =
      event.key === "ArrowUp" || event.key === "ArrowRight"
        ? 1
        : event.key === "ArrowDown" || event.key === "ArrowLeft"
          ? -1
          : 0;
    if (direction === 0) return;
    const step = guide.unit === "meters" ? (event.shiftKey ? 0.25 : 0.05) : event.shiftKey ? 5 : 1;
    setProjectedSpatialAnchorValue(guide, guide.value + direction * step);
    event.preventDefault();
  }

  function createPlateDrag(
    event: PointerEvent,
    hit: PlateSketchEditorHit,
    placement: NormalizedPlatePlacement,
    viewModel: PlateSketchEditorViewModel,
  ): PlateEditorDrag | null {
    const point = pointerToCanvasPoint(event);
    return beginPlateSketchEditorDrag({
      pointerId: event.pointerId,
      point,
      hit,
      geometry: viewModel.geometries.find((geometry) => geometry.index === hit.index) || null,
      placement,
      plate: plates[hit.index],
      adapter: currentProjectionAdapter(),
      sourceProjectionMode: workbench.project.scene.projectionMode,
      innerGuideSplit: workbench.project.scene.guideSplit,
      carrierHorizonRadius: workbench.project.scene.horizonSplit,
      projectionSurface: workbench.project.scene.surface,
      plateEditMode,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
    });
  }

  function updatePlateDrag(event: PointerEvent, drag: PlateEditorDrag) {
    if (drag.action === "camera" || drag.action === "spatial-anchor") return;
    const placement = placements[activeIndex];
    if (!placement) return;
    const update = updatePlateSketchEditorDrag({
      drag,
      pointerId: event.pointerId,
      point: pointerToCanvasPoint(event),
      placement,
      plate: activePlate,
      adapter: currentProjectionAdapter(),
      sourceProjectionMode: workbench.project.scene.projectionMode,
      innerGuideSplit: workbench.project.scene.guideSplit,
      carrierHorizonRadius: workbench.project.scene.horizonSplit,
      projectionSurface: workbench.project.scene.surface,
      minScale: MIN_PLATE_SCALE,
      maxScale: MAX_PLATE_SCALE,
    });
    if (update.kind === "ignored") return;
    activeDrag = update.drag;
    placements[activeIndex] = update.placement;
    placements = [...placements];
    scheduleRenderPreview();
  }

  function updateProjectedSpatialAnchorDrag(
    event: PointerEvent,
    drag: Extract<PlateEditorDrag, { action: "spatial-anchor" }>,
  ): void {
    const point = pointerToCanvasPoint(event);
    if (!point) return;
    const surface = workbench.project.scene.surface;
    const adapter = currentProjectionAdapter();
    if (surface.kind === "angular") {
      const direction = adapter.physicalDirectionAt(point);
      if (!direction) return;
      setAngularProjectionSpatialAnchor(
        drag.anchorId,
        (Math.asin(Math.max(-1, Math.min(1, direction[1]))) * 180) / Math.PI,
      );
    } else {
      const surfacePoint = adapter.physicalSurfacePointAt(point);
      if (!surfacePoint) return;
      setProjectionSurfacePhysicalHorizon(surface.eyeHeight + surfacePoint[1]);
    }
    renderOverlay();
  }

  function projectedSpatialAnchorGuides(): ProjectedSpatialAnchorGuide[] {
    if (currentPlateProjectionViewMode() === "source-map") return [];
    const adapter = currentProjectionAdapter();
    return buildProjectedSpatialAnchorGuides({
      surface: workbench.project.scene.surface,
      mode: workbench.project.scene.projectionMode,
      viewport: previewRect(),
      projectPhysicalDirection: adapter.projectPhysicalDirection,
      projectPhysicalSurfacePoint: adapter.projectPhysicalSurfacePoint,
    });
  }

  function setProjectedSpatialAnchorValue(guide: ProjectedSpatialAnchorGuide, value: number): void {
    const clamped = Math.max(guide.minimum, Math.min(guide.maximum, value));
    if (guide.unit === "meters") setProjectionSurfacePhysicalHorizon(clamped);
    else setAngularProjectionSpatialAnchor(guide.id, clamped);
  }

  function hitTestPlate(event: PointerEvent, viewModel: PlateSketchEditorViewModel): PlateSketchEditorHit | null {
    const point = pointerToCanvasPoint(event);
    return hitTestPlateSketchEditor({
      point,
      direction: point ? currentProjectionAdapter().sourceDirectionAt(point) : null,
      activeIndex,
      geometries: viewModel.geometries,
      placements,
      plates,
      sourceProjectionMode: workbench.project.scene.projectionMode,
      innerGuideSplit: workbench.project.scene.guideSplit,
      carrierHorizonRadius: workbench.project.scene.horizonSplit,
      projectionSurface: workbench.project.scene.surface,
      plateFit,
      handleRadius: HANDLE_RADIUS,
      hitLocalPad: PLATE_HIT_LOCAL_PAD,
    });
  }

  function plateEditorViewModel(): PlateSketchEditorViewModel {
    return buildPlateSketchEditorViewModel({
      placements,
      plates,
      activeIndex,
      sourceProjectionMode: workbench.project.scene.projectionMode,
      innerGuideSplit: workbench.project.scene.guideSplit,
      carrierHorizonRadius: workbench.project.scene.horizonSplit,
      projectionSurface: workbench.project.scene.surface,
      plateFit,
      adapter: currentProjectionAdapter(),
    });
  }

  function updateCameraDrag(event: PointerEvent, drag: Extract<PlateEditorDrag, { action: "camera" }>) {
    if (!previewCanvas) return;
    const update = updateProjectionCameraDrag({
      drag: drag.state,
      pointerId: event.pointerId,
      clientPoint: event,
      rect: previewCanvas.getBoundingClientRect(),
      viewport: previewViewport(),
      viewMode: currentPlateProjectionViewMode(),
      clampToViewport: true,
    });
    drag.state = update.drag;
    if (update.kind === "updated") {
      viewCamera = update.camera;
      scheduleRenderPreview();
    }
  }

  function previewRect(): Rect {
    return { x: 0, y: 0, ...previewViewport() };
  }

  function currentProjectionAdapter(): PlateEditorProjectionAdapter {
    return createPlateEditorProjectionAdapter({
      mode: currentPlateProjectionViewMode(),
      sourceProjectionMode: workbench.project.scene.projectionMode,
      camera: viewCamera,
      rect: previewRect(),
      domeGuideSemanticSplit: workbench.project.scene.guideSplit,
      domeGuideHorizonSplit: workbench.project.scene.horizonSplit,
      projectionSurface: workbench.project.scene.surface,
      showCaveMask,
    });
  }

  function pointerToCanvasPoint(event: PointerEvent): Point2D | null {
    return clientToCanvasPoint(event);
  }

  function clientToCanvasPoint(clientPoint: { clientX: number; clientY: number }): Point2D | null {
    if (!previewCanvas) return null;
    return projectionCameraViewportPoint(clientPoint, previewCanvas.getBoundingClientRect(), previewViewport(), {
      clampToViewport: true,
    });
  }

  function handleWheel(event: WheelEvent) {
    const mode = currentPlateProjectionViewMode();
    if (mode === "source-map") return;
    event.preventDefault();
    viewCamera = updateProjectionCameraWheel({
      viewMode: mode,
      camera: viewCamera,
      deltaY: event.deltaY,
      modifiers: projectionCameraPointerModifiers(event),
    });
    scheduleRenderPreview();
  }

  function previewViewport(): { width: number; height: number } {
    const aspect = workbench.project.scene.raster.width / workbench.project.scene.raster.height;
    return aspect >= 1
      ? { width: PREVIEW_SIZE, height: PREVIEW_SIZE / aspect }
      : { width: PREVIEW_SIZE * aspect, height: PREVIEW_SIZE };
  }

  function beginCameraDrag(event: PointerEvent): ProjectionCameraDragState | null {
    if (!previewCanvas) return null;
    return beginProjectionCameraDrag({
      pointerId: event.pointerId,
      clientPoint: event,
      rect: previewCanvas.getBoundingClientRect(),
      viewport: previewViewport(),
      camera: viewCamera,
      modifiers: projectionCameraPointerModifiers(event),
      clampToViewport: true,
    });
  }

  function resetActiveWarp() {
    if (!activePlacement) return;
    updateActivePlacement({
      cornerOffsets: {
        nw: { x: 0, y: 0 },
        ne: { x: 0, y: 0 },
        se: { x: 0, y: 0 },
        sw: { x: 0, y: 0 },
      },
    });
  }

  function setPlateProjectionViewMode(mode: PlateEditorViewMode) {
    if (plateEditorViewDisabledReason(mode, workbench.project.scene.projectionMode)) return;
    plateProjectionViewMode = mode;
    scheduleRenderPreview();
  }

  function currentPlateProjectionViewMode(): PlateEditorViewMode {
    return plateEditorViewDisabledReason(plateProjectionViewMode, workbench.project.scene.projectionMode)
      ? "source-map"
      : plateProjectionViewMode;
  }
</script>

{#snippet plateActions()}
  <ActionButton tone="secondary" density="compact" onclick={() => loadDefaultPlates()}>Load sources</ActionButton>
{/snippet}

{#snippet plateLeft()}
  <PlateSketchSourcePanel
    {plates}
    {activeIndex}
    {handlePlateInput}
    {loadDefaultPlates}
    {removeActivePlate}
    {selectPlate}
    {plateLayerPlacementLabel}
  />

  <CameraControlsPanel
    bind:viewMode={plateProjectionViewMode}
    bind:viewCamera
    bind:showCaveMask
    bind:invertCaveMask
    projectionProfile={workbench.project.scene.projectionMode}
    projectionSurface={workbench.project.scene.surface}
    onNudge={(truck, lift, push) => {
      viewCamera = nudgeProjectionCamera(viewCamera, currentPlateProjectionViewMode(), truck, lift, push);
    }}
  />
{/snippet}

{#snippet plateViewport()}
  <PlateSketchViewportSurface
    bind:renderCanvas
    bind:previewCanvas
    {plates}
    {renderStatus}
    viewerMode={workbench.project.workspace.viewerMode}
    carrierAspect={workbench.project.scene.raster.width / workbench.project.scene.raster.height}
    projectionTitle={currentPlateProjectionViewMode() === "source-map"
      ? "Use projected views to drag the camera."
      : projectionCameraControlHelp(currentPlateProjectionViewMode())}
    {loadDefaultPlates}
    {dropActive}
    {handlePlateDragEnter}
    {handlePlateDragOver}
    {handlePlateDragLeave}
    {handlePlateDrop}
    {handlePointerDown}
    {handlePointerMove}
    {handlePointerUp}
    {handleProjectedGuidePointerDown}
    {handleProjectedGuideKeydown}
    {handleWheel}
    {projectedGuides}
    previewWidth={previewViewport().width}
    previewHeight={previewViewport().height}
  />
{/snippet}

{#snippet plateInspector()}
  <PlateSketchInspectorPanel
    {activePlate}
    {activePlacement}
    {activeIndex}
    {plates}
    {plateFit}
    {plateFeather}
    {plateEditMode}
    {canCommit}
    plateOptions={plateOptions()}
    {setActivePlateValue}
    {setPlateFit}
    {setPlateEditMode}
    {setPlateFeather}
    {updateActivePlacement}
    {autoArrangeAndRender}
    {resetActivePlate}
    {resetActiveWarp}
    {commitPlateSketch}
    {downloadCurrentHandoff}
  />
{/snippet}

{#snippet plateBottom()}
  <div class="plate-bottom-readout" aria-label="Plate Sketch scene readiness">
    <span><strong>Compose</strong> {plates.length} raster layer{plates.length === 1 ? "" : "s"}</span>
    <span>{canCommit ? "Plate Sketch source ready" : "Load plates before commit"}</span>
  </div>
  <output class="plate-editor-status">{renderStatus}</output>
{/snippet}

<DomeSceneWorkbench
  label="Plate Sketch placement editor"
  room="still"
  eyebrow="Compose / Plate Sketch"
  title="Dome Canvas"
  summary={plateSceneSummary}
  rootClass="plate-editor"
  topbarClass="plate-scene-topbar"
  gridClass="plate-scene-grid"
  leftClass="plate-scene-left"
  mainClass="plate-scene-main"
  inspectorClass="plate-scene-inspector"
  actions={plateActions}
  left={plateLeft}
  viewport={plateViewport}
  inspector={plateInspector}
  bottom={plateBottom}
/>
