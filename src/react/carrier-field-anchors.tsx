import { useMemo, useRef, type KeyboardEvent, type PointerEvent } from "react";

import {
  beginSourceGuideBreakpointDrag,
  sourceGuideBreakpointFromRailPointer,
  sourceGuideBreakpointRadiusFromKey,
  updateSourceGuideBreakpointDrag,
  type SourceGuideBreakpointDragState,
  type SourceGuideBreakpointId,
  type SourceGuideBreakpointRadiusUpdate,
} from "../geometry/source-guide-drag-controller.js";
import { sourceGuideBreakpoints, sourceGuideZones } from "../geometry/source-guide-semantics.js";
import type { SourceProjectionMode } from "../lib/shared/contracts/projection-profile.js";

export function CarrierFieldAnchors({
  mode,
  guideSplit,
  horizonSplit,
  onChange,
}: {
  mode: SourceProjectionMode;
  guideSplit: number;
  horizonSplit: number;
  onChange: (id: SourceGuideBreakpointId, radius: number) => void;
}) {
  const breakpoints = useMemo(
    () => sourceGuideBreakpoints(mode, guideSplit, horizonSplit),
    [guideSplit, horizonSplit, mode],
  );
  const zones = useMemo(() => sourceGuideZones(mode, guideSplit, horizonSplit), [guideSplit, horizonSplit, mode]);
  const drag = useRef<SourceGuideBreakpointDragState | null>(null);

  function apply(update: SourceGuideBreakpointRadiusUpdate) {
    if (update.action === "set") onChange(update.id, update.radius);
  }

  function start(event: PointerEvent<HTMLElement>, id: SourceGuideBreakpointId, rail: HTMLElement) {
    event.preventDefault();
    drag.current = beginSourceGuideBreakpointDrag({
      id,
      pointerId: event.pointerId,
      railRect: rail.getBoundingClientRect(),
    });
    rail.setPointerCapture(event.pointerId);
    apply(updateSourceGuideBreakpointDrag({ drag: drag.current, pointerId: event.pointerId, clientX: event.clientX }));
  }

  function handleRailPointerDown(event: PointerEvent<HTMLDivElement>) {
    const breakpoint = sourceGuideBreakpointFromRailPointer({
      breakpoints,
      clientX: event.clientX,
      railRect: event.currentTarget.getBoundingClientRect(),
    });
    if (breakpoint) start(event, breakpoint.id, event.currentTarget);
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    event.preventDefault();
    apply(updateSourceGuideBreakpointDrag({ drag: drag.current, pointerId: event.pointerId, clientX: event.clientX }));
  }

  function end(event: PointerEvent<HTMLDivElement>) {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function handleKey(event: KeyboardEvent<HTMLButtonElement>, id: SourceGuideBreakpointId) {
    const update = sourceGuideBreakpointRadiusFromKey({ breakpoints, id, key: event.key, shiftKey: event.shiftKey });
    if (update.action === "none") return;
    event.preventDefault();
    apply(update);
  }

  return (
    <div className="carrier-anchor-control" aria-label="Image horizon alignment controls">
      <div className="carrier-anchor-heading">
        <span>Align image horizon</span>
        <strong>{breakpoints.map((item) => `${item.label} ${formatPercent(item.radius)}`).join(" · ")}</strong>
        <small>Allocates Plate pixels against the physical guide; it does not move the observer.</small>
      </div>
      <div
        className="carrier-anchor-rail"
        role="group"
        aria-label="Image field alignment rail"
        onPointerDown={handleRailPointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={end}
        onPointerCancel={end}
      >
        {zones.map((zone) => (
          <span
            key={zone.id}
            className={`carrier-anchor-zone ${zone.tone}`}
            style={{ left: `${zone.startRadius * 100}%`, width: `${(zone.endRadius - zone.startRadius) * 100}%` }}
            aria-hidden="true"
          />
        ))}
        {breakpoints.map((breakpoint) => (
          <button
            key={breakpoint.id}
            type="button"
            className={`carrier-anchor-marker ${breakpoint.role === "horizon" ? "is-horizon" : ""}`}
            style={{ left: `${breakpoint.radius * 100}%` }}
            aria-label={`${breakpoint.label} field anchor at ${formatPercent(breakpoint.radius)}`}
            title={`${breakpoint.label} ${formatPercent(breakpoint.radius)}`}
            onPointerDown={(event) => {
              event.stopPropagation();
              const rail = event.currentTarget.closest(".carrier-anchor-rail");
              if (rail instanceof HTMLElement) start(event, breakpoint.id, rail);
            }}
            onKeyDown={(event) => handleKey(event, breakpoint.id)}
          />
        ))}
      </div>
      <div className="carrier-anchor-zones" aria-hidden="true">
        {zones.map((zone) => (
          <span key={zone.id}>{zone.label}</span>
        ))}
      </div>
    </div>
  );
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}
