<script lang="ts">
  import { workbench } from "../../artifacts/artifact-store.svelte.js";
  import {
    setBoxRoomProjectionSurface,
    setAngularProjectionSpatialAnchor,
    setCarrierAspectPreset,
    setCylinderProjectionSurface,
    setDoubleGableProjectionSurface,
    setPlanarHallRoofProfile,
    setProjectionSurfacePhysicalHorizon,
  } from "../../app/workbench-view-commands.js";
  import {
    GENERATION_ASPECT_PRESETS,
    MAX_PLANAR_ROOF_ANCHORS,
    generationAspectProfile,
    planarRoofProfile,
    projectionSurfacePhysicalHorizon,
    projectionSpatialAnchors,
    projectionSurfaceSummary,
    type GenerationAspectPreset,
    type PlanarRoofAnchor,
  } from "../../lib/shared/contracts/projection-authoring.js";
  import { NumberField, SelectField, WorkstationPanel } from "../primitives/index.js";

  const surface = $derived(workbench.project.scene.surface);
  const raster = $derived(workbench.project.scene.raster);
  const modelProfile = $derived(generationAspectProfile(raster.aspectPreset));
  const isCylinderWall = $derived(workbench.project.scene.projectionMode === "cylinder-wall");
  const cylinderWallNaturalAspect = $derived(
    surface.kind === "cylinder" ? (Math.PI * 2 * surface.radius) / surface.height : null,
  );
  const hallRoofProfile = $derived(surface.kind === "double-gable-room" ? planarRoofProfile(surface) : []);
  const physicalHorizon = $derived(projectionSurfacePhysicalHorizon(surface));
  const spatialAnchors = $derived(projectionSpatialAnchors(surface));
  const carrierHorizonPercent = $derived(Math.round(workbench.project.scene.horizonSplit * 100));
  const angularMinimum = $derived(
    workbench.project.scene.projectionMode === "nadir-180"
      ? -89.5
      : workbench.project.scene.projectionMode === "zenith-230"
        ? -25
        : 0,
  );
  const angularMaximum = $derived(workbench.project.scene.projectionMode === "nadir-180" ? 0 : 89.5);
  const aspectOptions = $derived(
    GENERATION_ASPECT_PRESETS.map((aspect) => ({
      value: aspect,
      label: generationAspectProfile(aspect).label,
      disabled: isCylinderWall && aspect !== "21:9",
    })),
  );

  function changeAspect(value: string): void {
    if (GENERATION_ASPECT_PRESETS.includes(value as GenerationAspectPreset)) {
      setCarrierAspectPreset(value as GenerationAspectPreset);
    }
  }

  function updateRoofAnchor(index: number, patch: Partial<PlanarRoofAnchor>): void {
    setPlanarHallRoofProfile(
      hallRoofProfile.map((anchor, anchorIndex) => (anchorIndex === index ? { ...anchor, ...patch } : anchor)),
    );
  }

  function addRoofAnchor(afterIndex: number): void {
    if (hallRoofProfile.length >= MAX_PLANAR_ROOF_ANCHORS) return;
    const left = hallRoofProfile[afterIndex];
    const right = hallRoofProfile[afterIndex + 1];
    if (!left || !right) return;
    setPlanarHallRoofProfile([
      ...hallRoofProfile.slice(0, afterIndex + 1),
      {
        id: `roof-break-${Date.now()}`,
        position: (left.position + right.position) * 0.5,
        height: (left.height + right.height) * 0.5,
        role: "break",
      },
      ...hallRoofProfile.slice(afterIndex + 1),
    ]);
  }

  function removeRoofAnchor(index: number): void {
    if (index <= 0 || index >= hallRoofProfile.length - 1 || hallRoofProfile.length <= 3) return;
    setPlanarHallRoofProfile(hallRoofProfile.filter((_, anchorIndex) => anchorIndex !== index));
  }
</script>

<WorkstationPanel
  class="projection-authoring-panel"
  label="Composition carrier geometry and generation raster"
  title="Venue carrier"
  summary={projectionSurfaceSummary(surface)}
>
  <SelectField
    id="plate-carrier-aspect"
    label="Generation frame"
    value={raster.aspectPreset}
    options={aspectOptions}
    onchange={changeAspect}
  />

  <div class="projection-authoring-model-readout" aria-label="Cross-model output dimensions">
    <span><strong>GPT Image</strong> {raster.width} × {raster.height}</span>
    <small>One aspect family; provider-specific pixels. Projector decode remains downstream.</small>
  </div>

  {#if physicalHorizon}
    <div class="projection-physical-horizon" aria-label="Projected texture horizon plane">
      <div class="projection-physical-horizon-heading">
        <span>Texture horizon anchor</span>
        <strong>{physicalHorizon.height.toFixed(2)} m above venue floor</strong>
      </div>
      {#if surface.kind === "box-room"}
        <NumberField
          id="carrier-room-horizon-height"
          label="Horizon height · m"
          value={physicalHorizon.height}
          min={0.01}
          max={physicalHorizon.upperLimit - 0.01}
          step={0.05}
          onchange={setProjectionSurfacePhysicalHorizon}
        />
      {:else if surface.kind === "double-gable-room"}
        <NumberField
          id="carrier-hall-horizon-height"
          label="Horizon height · m"
          value={physicalHorizon.height}
          min={0.01}
          max={physicalHorizon.upperLimit - 0.01}
          step={0.05}
          onchange={setProjectionSurfacePhysicalHorizon}
        />
      {:else if surface.kind === "cylinder"}
        <NumberField
          id="carrier-cylinder-horizon-height"
          label="Horizon height · m"
          value={physicalHorizon.height}
          min={0.01}
          max={physicalHorizon.upperLimit - 0.01}
          step={0.05}
          onchange={setProjectionSurfacePhysicalHorizon}
        />
      {/if}
      <small>
        Authored world-space texture reference. The observer pose stays fixed while this plane moves. The raster
        eye-line at {carrierHorizonPercent}% only allocates source-map pixels.
      </small>
    </div>
  {/if}

  {#if surface.kind === "box-room"}
    <div class="projection-authoring-field-grid" aria-label="Measured rectangular room dimensions in metres">
      <NumberField
        id="carrier-room-width"
        label="Width · m"
        value={surface.width}
        min={0.05}
        step={0.05}
        onchange={(width) => setBoxRoomProjectionSurface({ width })}
      />
      <NumberField
        id="carrier-room-depth"
        label="Depth · m"
        value={surface.depth}
        min={0.05}
        step={0.05}
        onchange={(depth) => setBoxRoomProjectionSurface({ depth })}
      />
      <NumberField
        id="carrier-room-height"
        label="Height · m"
        value={surface.height}
        min={0.05}
        step={0.05}
        onchange={(height) => setBoxRoomProjectionSurface({ height })}
      />
      <NumberField
        id="carrier-eye-height"
        label="Observer Y · m"
        value={surface.eyeHeight}
        min={0.01}
        max={surface.height - 0.01}
        step={0.05}
        onchange={(eyeHeight) => setBoxRoomProjectionSurface({ eyeHeight })}
      />
      <NumberField
        id="carrier-eye-x"
        label="Observer X · m"
        value={surface.eyeX}
        min={-surface.width * 0.5}
        max={surface.width * 0.5}
        step={0.05}
        onchange={(eyeX) => setBoxRoomProjectionSurface({ eyeX })}
      />
      <NumberField
        id="carrier-eye-z"
        label="Observer Z · m"
        value={surface.eyeZ}
        min={-surface.depth * 0.5}
        max={surface.depth * 0.5}
        step={0.05}
        onchange={(eyeZ) => setBoxRoomProjectionSurface({ eyeZ })}
      />
    </div>
  {:else if surface.kind === "double-gable-room"}
    <div class="projection-authoring-field-grid" aria-label="Measured profiled planar hall dimensions in metres">
      <NumberField
        id="carrier-hall-length"
        label="Length · m"
        value={surface.length}
        min={0.05}
        step={0.05}
        onchange={(length) => setDoubleGableProjectionSurface({ length })}
      />
      <NumberField
        id="carrier-hall-width"
        label="Width · m"
        value={surface.width}
        min={0.05}
        step={0.05}
        onchange={(width) => setDoubleGableProjectionSurface({ width })}
      />
      <NumberField
        id="carrier-hall-eye-height"
        label="Observer Y · m"
        value={surface.eyeHeight}
        min={0.01}
        max={Math.min(...hallRoofProfile.map((anchor) => anchor.height)) - 0.01}
        step={0.05}
        onchange={(eyeHeight) => setDoubleGableProjectionSurface({ eyeHeight })}
      />
      <NumberField
        id="carrier-hall-eye-x"
        label="Observer X · m"
        value={surface.eyeX}
        min={-surface.length * 0.5}
        max={surface.length * 0.5}
        step={0.05}
        onchange={(eyeX) => setDoubleGableProjectionSurface({ eyeX })}
      />
      <NumberField
        id="carrier-hall-eye-z"
        label="Observer Z · m"
        value={surface.eyeZ}
        min={-surface.width * 0.5}
        max={surface.width * 0.5}
        step={0.05}
        onchange={(eyeZ) => setDoubleGableProjectionSurface({ eyeZ })}
      />
    </div>
    <div class="planar-roof-profile-editor" aria-label="Piecewise-planar roof profile">
      <div class="planar-roof-profile-heading">
        <span>Planar roof profile</span>
        <strong>{hallRoofProfile.length - 1} planes · {hallRoofProfile.length}/{MAX_PLANAR_ROOF_ANCHORS} anchors</strong
        >
      </div>
      {#each hallRoofProfile as anchor, index (anchor.id)}
        <div class="planar-roof-anchor-row">
          <span class={`planar-roof-anchor-role ${anchor.role}`}>{anchor.role}</span>
          <NumberField
            id={`carrier-hall-roof-position-${anchor.id}`}
            label="Across · %"
            value={anchor.position * 100}
            min={index === 0 ? 0 : hallRoofProfile[index - 1].position * 100 + 0.1}
            max={index === hallRoofProfile.length - 1 ? 100 : hallRoofProfile[index + 1].position * 100 - 0.1}
            step={0.1}
            disabled={index === 0 || index === hallRoofProfile.length - 1}
            onchange={(position) => updateRoofAnchor(index, { position: position / 100 })}
          />
          <NumberField
            id={`carrier-hall-roof-height-${anchor.id}`}
            label="Height · m"
            value={anchor.height}
            min={0.05}
            step={0.05}
            onchange={(height) => updateRoofAnchor(index, { height })}
          />
          {#if index < hallRoofProfile.length - 1}
            <button
              type="button"
              class="planar-roof-anchor-action"
              disabled={hallRoofProfile.length >= MAX_PLANAR_ROOF_ANCHORS}
              onclick={() => addRoofAnchor(index)}
              aria-label={`Add roof anchor after ${anchor.role}`}>+</button
            >
          {:else}
            <span class="planar-roof-anchor-action-spacer"></span>
          {/if}
          <button
            type="button"
            class="planar-roof-anchor-action remove"
            disabled={index === 0 || index === hallRoofProfile.length - 1 || hallRoofProfile.length <= 3}
            onclick={() => removeRoofAnchor(index)}
            aria-label={`Remove ${anchor.role} roof anchor`}>−</button
          >
        </div>
      {/each}
    </div>
    <p class="projection-authoring-note">
      Observer-centred profiled-shell carrier: every adjacent anchor pair is one exact roof plane. The inner square is
      the continuous roof, the outer field is the four walls, and the raster edge is the open floor line. No floor
      pixels are authored.
    </p>
  {:else if surface.kind === "cylinder"}
    <div class="projection-authoring-field-grid" aria-label="Measured cylinder dimensions in metres">
      <NumberField
        id="carrier-cylinder-eye-height"
        label="Observer Y · m"
        value={surface.eyeHeight}
        min={0.01}
        max={surface.height - 0.01}
        step={0.05}
        onchange={(eyeHeight) => setCylinderProjectionSurface({ eyeHeight })}
      />
      <NumberField
        id="carrier-cylinder-radius"
        label="Radius · m"
        value={surface.radius}
        min={0.05}
        step={0.05}
        onchange={(radius) => setCylinderProjectionSurface({ radius })}
      />
      <NumberField
        id="carrier-cylinder-height"
        label="Height · m"
        value={surface.height}
        min={0.05}
        step={0.05}
        onchange={(height) => setCylinderProjectionSurface({ height })}
      />
    </div>
    {#if isCylinderWall}
      <p class="projection-authoring-note">
        Full rectangular 360° wall chart. Left and right edges are the same physical seam; top-to-bottom is
        ceiling-to-floor. Cylinder Wall is governed at 21:9 (2912 × 1248) for the model-facing unwrap; equal physical
        wall sampling is approximately {cylinderWallNaturalAspect?.toFixed(2)}:1 for this measured cylinder.
      </p>
    {:else}
      <p class="projection-authoring-note">
        Radial continuity carrier: the center cap joins the surrounding wall annulus. Rectangular frames sample this
        normalized circle as a full-frame ellipse.
      </p>
    {/if}
  {:else}
    {#if spatialAnchors && "semanticElevationDegrees" in spatialAnchors}
      <div class="projection-physical-horizon" aria-label="Angular texture anchors">
        <div class="projection-physical-horizon-heading">
          <span>Projected texture anchors</span>
          <strong>observer-centred elevation</strong>
        </div>
        <div class="projection-authoring-field-grid">
          <NumberField
            id="carrier-angular-semantic-elevation"
            label={workbench.project.scene.projectionMode === "nadir-180" ? "Floor field · °" : "Sky field · °"}
            value={spatialAnchors.semanticElevationDegrees}
            min={angularMinimum}
            max={angularMaximum}
            step={1}
            onchange={(value) => setAngularProjectionSpatialAnchor("semantic", value)}
          />
          <NumberField
            id="carrier-angular-horizon-elevation"
            label="Horizon · °"
            value={spatialAnchors.horizonElevationDegrees}
            min={angularMinimum}
            max={angularMaximum}
            step={1}
            onchange={(value) => setAngularProjectionSpatialAnchor("horizon", value)}
          />
        </div>
        <small>Drag these latitude anchors directly on Dome Stage. Carrier split percentages remain independent.</small>
      </div>
    {/if}
    <p class="projection-authoring-note">
      Fisheye carriers are observer-centred angular maps. The rectangular generation frame preserves the circular
      projection and its black exterior without changing dome directions.
    </p>
  {/if}
</WorkstationPanel>
