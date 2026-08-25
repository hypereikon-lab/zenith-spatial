<script lang="ts">
  import { onMount } from "svelte";
  import { workbench } from "../artifacts/artifact-store.svelte.js";
  import { eulerDegreesFromQuaternion, quaternionFromEulerDegrees } from "../geometry/camera-rig.js";
  import { nudgeProjectionCamera, projectionCameraControlHelp } from "../geometry/projection-camera-controls.js";
  import {
    beginProjectionCameraDrag,
    projectionCameraPointerModifiers,
    updateProjectionCameraDrag,
    updateProjectionCameraWheel,
  } from "../geometry/projection-camera-controller.js";
  import { createSourceMapPreviewSession } from "../graphics/source-map-preview-session.js";
  import {
    PLATE_EDITOR_VIEW_MODES,
    defaultPlateEditorCamera,
    plateEditorViewDisabledReason,
  } from "../plates/plate-editor-view.js";
  import type { ArtifactMedia } from "../artifacts/artifact-types.js";
  import type { ProjectionCameraDragState } from "../geometry/projection-camera-controller.js";
  import type {
    SourceMapPreviewSession,
    SourceMapPreviewSessionUpdate,
  } from "../graphics/source-map-preview-session.js";
  import type { ImageSpatialSpec } from "../lib/shared/contracts/composition-sequence.js";
  import type { PlateEditorViewMode } from "../plates/plate-editor-view.js";
  import CameraControlsPanel from "./CameraControlsPanel.svelte";
  import { ActionButton } from "./primitives/index.js";

  const PREVIEW_SIZE = 960;

  let {
    media,
    label = "Media Preview",
    spatialSpec = null,
  }: {
    media: ArtifactMedia;
    label?: string;
    spatialSpec?: ImageSpatialSpec | null;
  } = $props();

  const projectionProfile = $derived(spatialSpec?.projectionMode ?? workbench.project.scene.projectionMode);
  const guideSplit = $derived(spatialSpec?.guideSplit ?? workbench.project.scene.guideSplit);
  const horizonSplit = $derived(spatialSpec?.horizonSplit ?? workbench.project.scene.horizonSplit);
  const projectionSurface = $derived(spatialSpec?.surface ?? workbench.project.scene.surface);
  const carrierAspect = $derived(
    spatialSpec
      ? spatialSpec.targetWidth / spatialSpec.targetHeight
      : workbench.project.scene.raster.width / workbench.project.scene.raster.height,
  );

  let canvas = $state<HTMLCanvasElement | null>(null);
  let previewSession = $state.raw<SourceMapPreviewSession | null>(null);
  let imageSize = $state({ width: 0, height: 0 });
  let viewMode = $state<PlateEditorViewMode>("source-map");
  let showCaveMask = $state<boolean>(false);
  let invertCaveMask = $state<boolean>(false);
  let viewCamera = $state(initialViewCamera());
  let status = $state("Drop or import an image to inspect it through projection geometry.");
  let controlsOpen = $state(false);
  let previousProjectionProfile = initialProjectionProfile();
  let previousProjectionSurfaceFingerprint = initialProjectionSurfaceFingerprint();
  let previousViewMode: PlateEditorViewMode = "source-map";
  let activeCameraDrag = $state<ProjectionCameraDragState | null>(null);
  let viewCameraEuler = $derived(eulerDegreesFromQuaternion(viewCamera.orientation));

  function initialViewCamera() {
    return defaultPlateEditorCamera(projectionProfile, projectionSurface);
  }

  function initialProjectionProfile() {
    return projectionProfile;
  }

  function initialProjectionSurfaceFingerprint() {
    return JSON.stringify(projectionSurface);
  }

  onMount(() => {
    if (canvas) {
      previewSession = createSourceMapPreviewSession(canvas);
      renderCurrentMedia();
    }
    return () => {
      previewSession?.destroy();
    };
  });

  let canvasWidth = $state(960);
  let canvasHeight = $state(960);

  $effect(() => {
    if (!canvas) return;
    const updateSize = () => {
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
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
    observer.observe(canvas);

    window.addEventListener("resize", updateSize);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateSize);
    };
  });

  $effect(() => {
    const projectionSurfaceFingerprint = JSON.stringify(projectionSurface);
    workbench.project.workspace.viewerMode;
    media.url;
    media.kind;
    guideSplit;
    horizonSplit;
    carrierAspect;
    viewMode;
    viewCamera;
    showCaveMask;
    invertCaveMask;
    canvasWidth;
    canvasHeight;
    if (
      projectionProfile !== previousProjectionProfile ||
      projectionSurfaceFingerprint !== previousProjectionSurfaceFingerprint
    ) {
      previousProjectionProfile = projectionProfile;
      previousProjectionSurfaceFingerprint = projectionSurfaceFingerprint;
      viewCamera = defaultPlateEditorCamera(projectionProfile, projectionSurface);
    }
    renderCurrentMedia();
  });

  $effect(() => {
    const currentViewMode = viewMode;
    if (currentViewMode === previousViewMode) return;
    previousViewMode = currentViewMode;
    controlsOpen = false;
  });

  function effectiveViewMode(): PlateEditorViewMode {
    return plateEditorViewDisabledReason(viewMode, projectionProfile) ? "source-map" : viewMode;
  }

  function applySessionUpdate(update: SourceMapPreviewSessionUpdate | null) {
    if (!update) return;
    if (update.status) status = update.status;
    if (update.imageSize) imageSize = update.imageSize;
  }

  function updateViewCamera(patch: Partial<typeof viewCamera>) {
    viewCamera = { ...viewCamera, ...patch };
  }

  function handlePointerDown(event: PointerEvent) {
    if (!canvas || effectiveViewMode() === "source-map" || !hasProjectableMedia()) return;
    event.preventDefault();
    activeCameraDrag = beginProjectionCameraDrag({
      pointerId: event.pointerId,
      clientPoint: event,
      rect: canvas.getBoundingClientRect(),
      viewport: previewViewport(),
      camera: viewCamera,
      modifiers: projectionCameraPointerModifiers(event),
    });
    canvas.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: PointerEvent) {
    if (!activeCameraDrag || event.pointerId !== activeCameraDrag.pointerId) return;
    if (!canvas) return;
    const update = updateProjectionCameraDrag({
      drag: activeCameraDrag,
      pointerId: event.pointerId,
      clientPoint: event,
      rect: canvas.getBoundingClientRect(),
      viewport: previewViewport(),
      viewMode: effectiveViewMode(),
    });
    activeCameraDrag = update.drag;
    if (update.kind === "updated") {
      viewCamera = update.camera;
    }
  }

  function handlePointerUp(event: PointerEvent) {
    if (!activeCameraDrag || event.pointerId !== activeCameraDrag.pointerId) return;
    activeCameraDrag = null;
    canvas?.releasePointerCapture(event.pointerId);
  }

  function handleWheel(event: WheelEvent) {
    const mode = effectiveViewMode();
    if (mode === "source-map" || !hasProjectableMedia()) return;
    event.preventDefault();
    viewCamera = updateProjectionCameraWheel({
      viewMode: mode,
      camera: viewCamera,
      deltaY: event.deltaY,
      modifiers: projectionCameraPointerModifiers(event),
    });
  }

  function hasProjectableMedia(): boolean {
    return media.kind === "image";
  }

  function renderCurrentMedia() {
    void previewSession?.renderMedia(
      {
        mediaUrl: media.url || "",
        mediaKind: media.kind,
        projectionProfile,
        viewerMode: workbench.project.workspace.viewerMode,
        selectedViewMode: effectiveViewMode(),
        camera: viewCamera,
        domeGuideSemanticSplit: guideSplit,
        domeGuideHorizonSplit: horizonSplit,
        showCaveMask,
        invertCaveMask,
        width: canvasWidth,
        height: canvasHeight,
        label,
        projectionSurface,
      },
      applySessionUpdate,
    );
  }

  function previewViewport(): { width: number; height: number } {
    return carrierAspect >= 1
      ? { width: PREVIEW_SIZE, height: PREVIEW_SIZE / carrierAspect }
      : { width: PREVIEW_SIZE * carrierAspect, height: PREVIEW_SIZE };
  }

</script>

<section class="source-map-viewer" aria-label={`${label} geometry viewer`}>
  <div class="source-map-canvas-wrap" style={`--carrier-aspect:${Math.max(0.01, carrierAspect)}`}>
    <canvas
      bind:this={canvas}
      class="source-map-preview-canvas"
      class:interactive={effectiveViewMode() !== "source-map" && hasProjectableMedia()}
      class:dragging={Boolean(activeCameraDrag)}
      aria-label={`${label} mapped through projection geometry`}
      title={effectiveViewMode() === "source-map"
        ? "Switch to Dome Stage, Audience POV, or Volume Room to drag the view."
        : projectionCameraControlHelp(effectiveViewMode())}
      onpointerdown={handlePointerDown}
      onpointermove={handlePointerMove}
      onpointerup={handlePointerUp}
      onpointercancel={handlePointerUp}
      onwheel={handleWheel}
      oncontextmenu={(event) => event.preventDefault()}
    ></canvas>
    {#if effectiveViewMode() !== "source-map" && hasProjectableMedia()}
      <div class="viewer-hud-hint">
        <span>🖱️ Drag to Rotate</span>
        <span>Shift+Drag to Pan</span>
        <span>Scroll to Zoom</span>
      </div>
    {/if}
  </div>

  <ActionButton
    tone="secondary"
    density="compact"
    class="source-map-tools-toggle"
    selected={controlsOpen}
    aria-expanded={controlsOpen}
    onclick={() => (controlsOpen = !controlsOpen)}
  >
    {controlsOpen ? "Hide projection controls" : "Projection controls"}
  </ActionButton>

  {#if controlsOpen}
    <aside class="source-map-tools" aria-label={`${label} projection controls`}>
      <CameraControlsPanel
        bind:viewMode
        bind:viewCamera
        bind:showCaveMask
        bind:invertCaveMask
        {projectionProfile}
        {projectionSurface}
        onNudge={(truck, lift, push) => {
          viewCamera = nudgeProjectionCamera(viewCamera, effectiveViewMode(), truck, lift, push);
        }}
      />
    </aside>
  {/if}

  <output class="source-map-status">{status}</output>
</section>
