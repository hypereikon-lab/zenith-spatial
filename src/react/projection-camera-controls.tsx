import {
  eulerDegreesFromQuaternion,
  quaternionFromEulerDegrees,
  quaternionFromLookAt,
} from "../geometry/camera-rig.js";
import { nudgeProjectionCamera, relockProjectionCameraToPivot } from "../geometry/projection-camera-controls.js";
import type { SourceProjectionMode } from "../geometry/source-projection.js";
import type { ProjectionSurface } from "../lib/shared/contracts/projection-authoring.js";
import {
  defaultPlateEditorCamera,
  type PlateEditorCamera,
  type PlateEditorViewMode,
} from "../plates/plate-editor-view.js";

type CameraPreset = "reset" | "zenith" | "horizon" | "front";

export function ProjectionCameraControls({
  viewMode,
  camera,
  projectionMode,
  surface,
  onChange,
}: {
  viewMode: PlateEditorViewMode;
  camera: PlateEditorCamera;
  projectionMode: SourceProjectionMode;
  surface: ProjectionSurface;
  onChange: (camera: PlateEditorCamera) => void;
}) {
  if (viewMode === "source-map") return null;
  const euler = eulerDegreesFromQuaternion(camera.orientation);

  function applyPreset(preset: CameraPreset) {
    const reset = defaultPlateEditorCamera(projectionMode, surface);
    if (preset === "reset") {
      onChange(reset);
      return;
    }
    const pivot = reset.pivot ?? [0, 0, 0];
    const distance = Math.hypot(
      reset.position[0] - pivot[0],
      reset.position[1] - pivot[1],
      reset.position[2] - pivot[2],
    );
    const pitch = preset === "zenith" ? (89.9 * Math.PI) / 180 : preset === "front" ? (12 * Math.PI) / 180 : 0;
    const position: [number, number, number] = [
      pivot[0],
      pivot[1] + distance * Math.sin(pitch),
      pivot[2] + distance * Math.cos(pitch),
    ];
    onChange({ ...reset, position, orientation: quaternionFromLookAt(position, pivot), pivot });
  }

  function patchPosition(axis: 0 | 1 | 2, value: number) {
    const position = [...camera.position] as [number, number, number];
    position[axis] = value;
    onChange({ ...camera, position });
  }

  function patchPivot(axis: 0 | 1 | 2, value: number) {
    const pivot: [number, number, number] = camera.pivot ? ([...camera.pivot] as [number, number, number]) : [0, 0, 0];
    pivot[axis] = value;
    onChange({ ...camera, pivot });
  }

  function patchEuler(axis: "yawDegrees" | "pitchDegrees" | "rollDegrees", value: number) {
    const next = { ...euler, [axis]: value };
    onChange({
      ...camera,
      orientation: quaternionFromEulerDegrees(next.yawDegrees, next.pitchDegrees, next.rollDegrees),
    });
  }

  return (
    <div className="camera-authoring" aria-label="Projection camera controls">
      <div className="segmented compact camera-presets" aria-label="Projection camera presets">
        {(["reset", "zenith", "horizon", "front"] as const).map((preset) => (
          <button type="button" key={preset} onClick={() => applyPreset(preset)}>
            {preset[0]!.toUpperCase() + preset.slice(1)}
          </button>
        ))}
      </div>
      <details>
        <summary>Transforms and nudge</summary>
        <div className="camera-transform-grid">
          <CameraVectorRow label="Position" values={camera.position} onChange={patchPosition} />
          <div className="camera-vector-row">
            <span>Rotation</span>
            <CameraNumber label="Yaw" value={euler.yawDegrees} onChange={(value) => patchEuler("yawDegrees", value)} />
            <CameraNumber
              label="Pitch"
              value={euler.pitchDegrees}
              onChange={(value) => patchEuler("pitchDegrees", value)}
            />
            <CameraNumber
              label="Roll"
              value={euler.rollDegrees}
              onChange={(value) => patchEuler("rollDegrees", value)}
            />
          </div>
          <CameraVectorRow label="Pivot" values={camera.pivot ?? [0, 0, 0]} onChange={patchPivot} />
          <div className="camera-nudge-pad" aria-label="Camera nudge controls">
            <button type="button" aria-label="Truck left" onClick={() => nudge(-0.2, 0, 0)}>
              ←
            </button>
            <button type="button" aria-label="Lift up" onClick={() => nudge(0, 0.2, 0)}>
              ↑
            </button>
            <button type="button" aria-label="Truck right" onClick={() => nudge(0.2, 0, 0)}>
              →
            </button>
            <button type="button" aria-label="Push forward" onClick={() => nudge(0, 0, 0.2)}>
              In
            </button>
            <button type="button" aria-label="Lift down" onClick={() => nudge(0, -0.2, 0)}>
              ↓
            </button>
            <button type="button" aria-label="Pull back" onClick={() => nudge(0, 0, -0.2)}>
              Out
            </button>
          </div>
          <button
            className="tool-button full"
            type="button"
            onClick={() => onChange(relockProjectionCameraToPivot(camera))}
          >
            Look at pivot
          </button>
        </div>
      </details>
    </div>
  );

  function nudge(truck: number, lift: number, push: number) {
    onChange(nudgeProjectionCamera(camera, viewMode, truck, lift, push));
  }
}

function CameraVectorRow({
  label,
  values,
  onChange,
}: {
  label: string;
  values: readonly [number, number, number];
  onChange: (axis: 0 | 1 | 2, value: number) => void;
}) {
  return (
    <div className="camera-vector-row">
      <span>{label}</span>
      {(["X", "Y", "Z"] as const).map((axis, index) => (
        <CameraNumber
          key={axis}
          label={`${label} ${axis}`}
          value={values[index]!}
          onChange={(value) => onChange(index as 0 | 1 | 2, value)}
        />
      ))}
    </div>
  );
}

function CameraNumber({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <input
      type="number"
      aria-label={label}
      value={Math.round(value * 100) / 100}
      step={label.includes("Yaw") || label.includes("Pitch") || label.includes("Roll") ? 1 : 0.1}
      onChange={(event) => {
        const next = Number(event.currentTarget.value);
        if (Number.isFinite(next)) onChange(next);
      }}
    />
  );
}
