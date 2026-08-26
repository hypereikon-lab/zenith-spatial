import { useMemo } from "react";

import type { AudienceInSpace } from "../domain/schema.js";
import { audienceVenuePlan, normalizeAudienceInSpace } from "../geometry/audience-in-space.js";
import type { SourceProjectionMode } from "../geometry/source-projection.js";
import type { ProjectionSurface } from "../lib/shared/contracts/projection-authoring.js";
import { clamp } from "../projection.js";

export function AudienceInSpaceControls({
  audience,
  projectionMode,
  surface,
  onChange,
}: {
  audience: AudienceInSpace;
  projectionMode: SourceProjectionMode;
  surface: ProjectionSurface;
  onChange: (audience: AudienceInSpace) => void;
}) {
  const normalized = normalizeAudienceInSpace(audience, projectionMode, surface);
  const plan = audienceVenuePlan(normalized, projectionMode, surface);
  const marker = planPoint(normalized.xMeters, normalized.zMeters, plan.widthMeters, plan.depthMeters);
  const observer = planPoint(
    plan.projectionObserver.xMeters,
    plan.projectionObserver.zMeters,
    plan.widthMeters,
    plan.depthMeters,
  );
  const grid = useMemo(() => planGrid(plan.widthMeters, plan.depthMeters), [plan.depthMeters, plan.widthMeters]);

  function patch(values: Partial<AudienceInSpace>) {
    onChange(normalizeAudienceInSpace({ ...normalized, ...values }, projectionMode, surface));
  }

  function moveFromPointer(event: React.PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const u = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    const v = clamp((event.clientY - rect.top) / rect.height, 0, 1);
    patch({ xMeters: (u - 0.5) * plan.widthMeters, zMeters: (0.5 - v) * plan.depthMeters });
  }

  function handleMarkerKey(event: React.KeyboardEvent<HTMLButtonElement>) {
    const step = event.shiftKey ? 1 : 0.1;
    let xMeters = normalized.xMeters;
    let zMeters = normalized.zMeters;
    if (event.key === "ArrowLeft") xMeters -= step;
    else if (event.key === "ArrowRight") xMeters += step;
    else if (event.key === "ArrowUp") zMeters += step;
    else if (event.key === "ArrowDown") zMeters -= step;
    else if (event.key === "Home") {
      xMeters = 0;
      zMeters = 0;
    } else return;
    event.preventDefault();
    patch({ xMeters, zMeters });
  }

  return (
    <div className="audience-authoring" aria-label="Audience in Space controls">
      <div className="audience-authoring-heading">
        <div>
          <strong>Audience position</strong>
          <small>{plan.label} · metric inspection only</small>
        </div>
        <button type="button" className="tool-button" onClick={() => patch({ xMeters: 0, zMeters: 0 })}>
          Center
        </button>
      </div>

      <div
        className={`audience-plan is-${plan.shape}`}
        style={{ aspectRatio: String(clamp(plan.widthMeters / Math.max(plan.depthMeters, 0.000001), 0.72, 1.6)) }}
        aria-label={`Venue plan, ${formatMeters(plan.widthMeters)} by ${formatMeters(plan.depthMeters)}`}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          moveFromPointer(event);
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) moveFromPointer(event);
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
        }}
      >
        <svg viewBox="0 0 100 100" aria-hidden="true" preserveAspectRatio="none">
          {grid.vertical.map((position) => (
            <line key={`x-${position}`} x1={position} x2={position} y1="0" y2="100" />
          ))}
          {grid.horizontal.map((position) => (
            <line key={`z-${position}`} x1="0" x2="100" y1={position} y2={position} />
          ))}
          {plan.shape === "circle" ? <ellipse cx="50" cy="50" rx="49" ry="49" className="venue-outline" /> : null}
          <line x1="50" x2="50" y1="0" y2="100" className="venue-axis" />
          <line x1="0" x2="100" y1="50" y2="50" className="venue-axis" />
        </svg>
        <span
          className="projection-observer-marker"
          style={{ left: `${observer.u * 100}%`, top: `${observer.v * 100}%` }}
          title="Projection observer reference"
        />
        <button
          type="button"
          className="audience-person-marker"
          style={{
            left: `${marker.u * 100}%`,
            top: `${marker.v * 100}%`,
            transform: `translate(-50%, -50%) rotate(${normalized.yawDegrees}deg)`,
          }}
          aria-label={`Audience position X ${formatMeters(normalized.xMeters)}, Z ${formatMeters(normalized.zMeters)}. Drag or use arrow keys to move.`}
          onKeyDown={handleMarkerKey}
        >
          <span aria-hidden="true" />
        </button>
        <span className="audience-plan-scale">grid {formatMeters(grid.stepMeters)}</span>
      </div>
      <div className="audience-plan-legend" aria-label="Venue plan legend">
        <span className="is-audience">Audience</span>
        <span className="is-observer">Projection origin</span>
      </div>

      <div className="audience-position-grid">
        <AudienceNumber
          label="X"
          unit="m"
          value={normalized.xMeters}
          step={0.1}
          onChange={(xMeters) => patch({ xMeters })}
        />
        <AudienceNumber
          label="Z"
          unit="m"
          value={normalized.zMeters}
          step={0.1}
          onChange={(zMeters) => patch({ zMeters })}
        />
        <AudienceNumber
          label="Eyes"
          unit="m"
          value={normalized.eyeHeightMeters}
          step={0.05}
          onChange={(eyeHeightMeters) => patch({ eyeHeightMeters })}
        />
        <AudienceNumber
          label="Facing"
          unit="°"
          value={normalized.yawDegrees}
          step={1}
          onChange={(yawDegrees) => patch({ yawDegrees })}
        />
        <AudienceNumber
          label="Look"
          unit="°"
          value={normalized.pitchDegrees}
          step={1}
          onChange={(pitchDegrees) => patch({ pitchDegrees })}
        />
        <AudienceNumber
          label="FOV"
          unit="°"
          value={normalized.fovDegrees}
          step={1}
          onChange={(fovDegrees) => patch({ fovDegrees })}
        />
        {surface.kind === "angular" ? (
          <AudienceNumber
            label="Dome R"
            unit="m"
            value={normalized.domeRadiusMeters}
            step={0.25}
            onChange={(domeRadiusMeters) => patch({ domeRadiusMeters })}
          />
        ) : null}
      </div>

      <div className="segmented compact audience-facing-presets" aria-label="Audience facing direction">
        {[
          ["Front", 0],
          ["Right", 90],
          ["Back", 180],
          ["Left", -90],
        ].map(([label, yaw]) => (
          <button key={label} type="button" onClick={() => patch({ yawDegrees: Number(yaw), pitchDegrees: 0 })}>
            {label}
          </button>
        ))}
      </div>

      <p className="audience-venue-readout">
        {plan.shape === "circle"
          ? `Ø${formatMeters(plan.widthMeters)}`
          : `${formatMeters(plan.widthMeters)} × ${formatMeters(plan.depthMeters)}`}
        {` · height ${formatMeters(plan.heightMeters)} · eyes ${formatMeters(normalized.eyeHeightMeters)}`}
      </p>
    </div>
  );
}

export function AudienceViewportHud({
  audience,
  projectionMode,
  surface,
}: {
  audience: AudienceInSpace;
  projectionMode: SourceProjectionMode;
  surface: ProjectionSurface;
}) {
  const normalized = normalizeAudienceInSpace(audience, projectionMode, surface);
  const plan = audienceVenuePlan(normalized, projectionMode, surface);
  return (
    <div className="audience-pov-hud" aria-label="Audience physical position readout">
      <span>AUDIENCE POV</span>
      <strong>
        X {formatMeters(normalized.xMeters)} · Z {formatMeters(normalized.zMeters)} · eyes{" "}
        {formatMeters(normalized.eyeHeightMeters)}
      </strong>
      <small>
        {plan.label} ·{" "}
        {plan.shape === "circle"
          ? `Ø${formatMeters(plan.widthMeters)}`
          : `${formatMeters(plan.widthMeters)} × ${formatMeters(plan.depthMeters)}`}
      </small>
    </div>
  );
}

function AudienceNumber({
  label,
  unit,
  value,
  step,
  onChange,
}: {
  label: string;
  unit: string;
  value: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <label>
      <span>{label}</span>
      <span>
        <input
          type="number"
          aria-label={`${label} ${unit}`}
          value={Math.round(value * 100) / 100}
          step={step}
          onChange={(event) => {
            const next = Number(event.currentTarget.value);
            if (Number.isFinite(next)) onChange(next);
          }}
        />
        <small>{unit}</small>
      </span>
    </label>
  );
}

function planPoint(xMeters: number, zMeters: number, widthMeters: number, depthMeters: number) {
  return {
    u: clamp(xMeters / Math.max(widthMeters, 0.000001) + 0.5, 0, 1),
    v: clamp(0.5 - zMeters / Math.max(depthMeters, 0.000001), 0, 1),
  };
}

function planGrid(widthMeters: number, depthMeters: number) {
  const maximumDimension = Math.max(widthMeters, depthMeters);
  const stepMeters = maximumDimension > 40 ? 5 : maximumDimension > 20 ? 2 : 1;
  const vertical: number[] = [];
  const horizontal: number[] = [];
  for (let x = stepMeters; x < widthMeters; x += stepMeters) vertical.push((x / widthMeters) * 100);
  for (let z = stepMeters; z < depthMeters; z += stepMeters) horizontal.push((z / depthMeters) * 100);
  return { vertical, horizontal, stepMeters };
}

function formatMeters(value: number): string {
  return `${Number(value.toFixed(2))}m`;
}
