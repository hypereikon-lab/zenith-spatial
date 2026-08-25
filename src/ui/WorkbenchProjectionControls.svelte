<script lang="ts">
  import {
    changeProjectionProfile,
    changeViewerMode,
    setDomeGuideHorizonSplit,
    setDomeGuideSemanticSplit,
  } from "../app/workbench-view-commands.js";
  import { workbenchProjectionControlsView } from "../app/workbench-projection-controls-view-model.js";
  import { sourceProjectionIsRadialCylinderCarrier, type SourceProjectionMode } from "../geometry/source-projection.js";
  import { SOURCE_REVIEW_VIEW_MODES, type SourceReviewViewMode } from "../scene/projection-view-contract.js";
  import {
    beginSourceGuideBreakpointDrag,
    sourceGuideBreakpointFromRailPointer,
    sourceGuideBreakpointRadiusFromKey,
    updateSourceGuideBreakpointDrag,
  } from "../geometry/source-guide-drag-controller.js";
  import type {
    SourceGuideBreakpointDragState,
    SourceGuideBreakpointId,
    SourceGuideBreakpointRadiusUpdate,
  } from "../geometry/source-guide-drag-controller.js";
  import { SegmentedControl, SelectField } from "./primitives/index.js";

  let activeGuideBreakpointDrag = $state<SourceGuideBreakpointDragState | null>(null);
  const projectionView = $derived(workbenchProjectionControlsView());

  function handleProjectionChange(value: string) {
    const profile = value as SourceProjectionMode;
    changeProjectionProfile(profile);
  }

  function handleViewerMode(value: string): void {
    if (SOURCE_REVIEW_VIEW_MODES.includes(value as SourceReviewViewMode)) {
      changeViewerMode(value as SourceReviewViewMode);
    }
  }

  function handleGuideRailPointerDown(event: PointerEvent) {
    if (!(event.currentTarget instanceof HTMLElement)) return;
    const breakpoint = sourceGuideBreakpointFromRailPointer({
      breakpoints: projectionView.guideBreakpoints,
      clientX: event.clientX,
      railRect: event.currentTarget.getBoundingClientRect(),
    });
    if (!breakpoint) return;
    startGuideBreakpointDrag(event, breakpoint.id, event.currentTarget);
  }

  function handleGuideBreakpointPointerDown(event: PointerEvent, breakpointId: SourceGuideBreakpointId) {
    if (!(event.currentTarget instanceof HTMLElement)) return;
    event.preventDefault();
    event.stopPropagation();
    const rail = event.currentTarget.closest(".guide-breakpoint-rail");
    if (!(rail instanceof HTMLElement)) return;
    startGuideBreakpointDrag(event, breakpointId, rail);
  }

  function startGuideBreakpointDrag(event: PointerEvent, breakpointId: SourceGuideBreakpointId, rail: HTMLElement) {
    activeGuideBreakpointDrag = beginSourceGuideBreakpointDrag({
      id: breakpointId,
      pointerId: event.pointerId,
      railRect: rail.getBoundingClientRect(),
    });
    rail.setPointerCapture(event.pointerId);
    updateGuideBreakpointFromPointer(event, activeGuideBreakpointDrag);
  }

  function handleGuideBreakpointPointerMove(event: PointerEvent) {
    const drag = activeGuideBreakpointDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    updateGuideBreakpointFromPointer(event, drag);
  }

  function handleGuideBreakpointPointerUp(event: PointerEvent) {
    const drag = activeGuideBreakpointDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    activeGuideBreakpointDrag = null;
    if (event.currentTarget instanceof HTMLElement) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function handleGuideBreakpointKeydown(event: KeyboardEvent, breakpointId: SourceGuideBreakpointId) {
    const next = sourceGuideBreakpointRadiusFromKey({
      breakpoints: projectionView.guideBreakpoints,
      id: breakpointId,
      key: event.key,
      shiftKey: event.shiftKey,
    });
    if (next.action === "none") return;
    applyGuideBreakpointRadiusUpdate(next);
    event.preventDefault();
  }

  function updateGuideBreakpointFromPointer(event: PointerEvent, drag: SourceGuideBreakpointDragState) {
    applyGuideBreakpointRadiusUpdate(
      updateSourceGuideBreakpointDrag({
        drag,
        pointerId: event.pointerId,
        clientX: event.clientX,
      }),
    );
  }

  function applyGuideBreakpointRadiusUpdate(update: SourceGuideBreakpointRadiusUpdate) {
    if (update.action === "none") return;
    setGuideBreakpointRadius(update.id, update.radius);
  }

  function setGuideBreakpointRadius(breakpointId: SourceGuideBreakpointId, radius: number) {
    if (breakpointId === "inner-split") {
      setDomeGuideSemanticSplit(radius);
    } else if (breakpointId === "carrier-horizon" || breakpointId === "physical-horizon") {
      setDomeGuideHorizonSplit(radius);
    }
  }

  function formatPercent(value: number): string {
    return `${Math.round(value * 100)}%`;
  }

  function handleCylinderCapInput(event: Event) {
    if (event.currentTarget instanceof HTMLInputElement) {
      setDomeGuideSemanticSplit(event.currentTarget.value);
    }
  }
</script>

<section class="zenith-projection-strip" aria-label="Projection and guide controls">
  <SelectField
    id="workbench-projection-profile"
    label="Source profile"
    value={projectionView.projectionMode}
    options={projectionView.projectionOptions}
    class="zenith-projection-field"
    onchange={handleProjectionChange}
  />

  <SegmentedControl
    label="Review overlay"
    value={projectionView.viewerMode}
    options={projectionView.viewerOptions}
    class="zenith-projection-view-toggle"
    onSelect={handleViewerMode}
  />

  <div class="zenith-projection-readout" aria-label="Projection summary">
    <span>
      {projectionView.projectionMode === "cylinder-wall"
        ? "Left/right seam identified"
        : `${projectionView.projectionSummary.center} center`}
    </span>
    <span>{projectionView.projectionSummary.coverageLabel}</span>
    <span>{projectionView.carrierSummary}</span>
    <span>{projectionView.rasterSummary}</span>
    <span>{projectionView.guideZoneSummary}</span>
  </div>

  {#if sourceProjectionIsRadialCylinderCarrier(projectionView.projectionMode)}
    <label class="zenith-cylinder-cap-control">
      <span>Topology cap</span>
      <input
        type="number"
        min="0.005"
        max="0.25"
        step="0.005"
        value={projectionView.guideBreakpoints[0]?.radius ?? 0.02}
        aria-describedby="zenith-cylinder-cap-note"
        onchange={handleCylinderCapInput}
      />
      <small id="zenith-cylinder-cap-note">0.5–25%; a positive cap keeps the circle-to-cylinder map invertible.</small>
    </label>
  {/if}

  <div class="projection-guide-controls zenith-projection-breakpoints" aria-label="Carrier field anchor controls">
    <div class="projection-breakpoint-heading">
      <span>Carrier field anchors</span>
      <strong>{projectionView.guideZoneSummary}</strong>
    </div>
    <div class="guide-breakpoint-control">
      <span class="guide-breakpoint-rail-wrap">
        <span
          class="guide-breakpoint-rail"
          role="group"
          aria-label="Carrier field anchor rail"
          onpointerdown={handleGuideRailPointerDown}
          onpointermove={handleGuideBreakpointPointerMove}
          onpointerup={handleGuideBreakpointPointerUp}
          onpointercancel={handleGuideBreakpointPointerUp}
        >
          {#each projectionView.guideZones as zone}
            <span
              class={`guide-breakpoint-zone ${zone.tone}`}
              style={`left: ${zone.startRadius * 100}%; width: ${(zone.endRadius - zone.startRadius) * 100}%`}
            ></span>
          {/each}
          {#each projectionView.guideBreakpoints as breakpoint}
            {#if breakpoint.editable}
              <button
                type="button"
                class:editable={breakpoint.editable}
                class:horizon={breakpoint.role === "horizon"}
                class="guide-breakpoint-marker"
                style={`left: ${breakpoint.radius * 100}%`}
                title={`${breakpoint.label} ${formatPercent(breakpoint.radius)}`}
                aria-label={`${breakpoint.label} field anchor at ${formatPercent(breakpoint.radius)}`}
                onpointerdown={(event) => handleGuideBreakpointPointerDown(event, breakpoint.id)}
                onkeydown={(event) => handleGuideBreakpointKeydown(event, breakpoint.id)}
              ></button>
            {:else}
              <span
                class:horizon={breakpoint.role === "horizon"}
                class="guide-breakpoint-marker"
                style={`left: ${breakpoint.radius * 100}%`}
                title={`${breakpoint.label} ${formatPercent(breakpoint.radius)}`}
              ></span>
            {/if}
          {/each}
        </span>
      </span>
      <span class="guide-breakpoint-values">
        {#each projectionView.guideBreakpoints as breakpoint}
          <span class:fixed={!breakpoint.editable}>
            {breakpoint.label}
            {formatPercent(breakpoint.radius)}
          </span>
        {/each}
      </span>
    </div>
  </div>
</section>
