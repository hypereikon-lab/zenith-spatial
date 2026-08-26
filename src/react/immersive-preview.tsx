import { Effect } from "effect";
import { useEffect, useMemo, useRef, useState } from "react";

import type { AudienceInSpace, ImageSpatialSpec } from "../domain/schema.js";
import { audienceVenuePlan } from "../geometry/audience-in-space.js";
import { sourceProjectionLabel } from "../geometry/source-projection.js";
import {
  ImmersivePreview,
  requestLookaroundOrientationPermission,
  type ImmersiveCapabilities,
} from "../xr/immersive-preview-service.js";
import type { ImmersivePreviewController, ImmersivePreviewMode } from "../xr/immersive-preview-renderer.js";
import { useEffectRunner } from "./runtime-bridge.js";

const INITIAL_CAPABILITIES: ImmersiveCapabilities = {
  secureContext: false,
  lookaround: true,
  orientation: false,
  vr: false,
  ar: false,
};

export function ImmersivePreviewPanel({
  mediaUrl,
  spec,
  audience,
  label,
  contentKey,
  presentation = "panel",
}: {
  readonly mediaUrl: string | null;
  readonly spec: ImageSpatialSpec | null;
  readonly audience: AudienceInSpace;
  readonly label: string;
  readonly contentKey: string;
  readonly presentation?: "panel" | "demo-route";
}) {
  const run = useEffectRunner();
  const canvas = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const controller = useRef<ImmersivePreviewController | null>(null);
  const pendingEnd = useRef(false);
  const launchSerial = useRef(0);
  const launchedContentKey = useRef<string | null>(null);
  const [capabilities, setCapabilities] = useState(INITIAL_CAPABILITIES);
  const [checking, setChecking] = useState(true);
  const [activeMode, setActiveMode] = useState<ImmersivePreviewMode | null>(null);
  const [status, setStatus] = useState("Checking this device…");
  const [scaleLabel, setScaleLabel] = useState<string | null>(null);
  const [positionLabel, setPositionLabel] = useState<string | null>(null);
  const [sensorActive, setSensorActive] = useState(false);
  const plan = useMemo(
    () => (spec ? audienceVenuePlan(audience, spec.projectionMode, spec.surface) : null),
    [audience, spec],
  );

  useEffect(() => {
    let mounted = true;
    void run(
      Effect.flatMap(ImmersivePreview, (service) =>
        Effect.all({ capabilities: service.capabilities, prepared: service.prepare }),
      ),
    )
      .then(({ capabilities: next }) => {
        if (!mounted) return;
        setCapabilities(next);
        setStatus(capabilitySummary(next));
      })
      .catch((error: unknown) => {
        if (mounted) setStatus(errorMessage(error));
      })
      .finally(() => {
        if (mounted) setChecking(false);
      });
    return () => {
      mounted = false;
    };
  }, [run]);

  useEffect(() => {
    if (!activeMode) return;
    const keyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") stop();
    };
    window.addEventListener("keydown", keyDown);
    return () => window.removeEventListener("keydown", keyDown);
  }, [activeMode]);

  useEffect(() => {
    if (activeMode && launchedContentKey.current !== contentKey) stop();
  }, [activeMode, contentKey]);

  function launch(mode: ImmersivePreviewMode) {
    const targetCanvas = canvas.current;
    const targetOverlay = overlay.current;
    if (!targetCanvas || !targetOverlay || !mediaUrl || !spec || activeMode) return;
    const serial = ++launchSerial.current;
    launchedContentKey.current = contentKey;
    const orientationPermission =
      mode === "lookaround" ? requestLookaroundOrientationPermission() : Promise.resolve("unavailable" as const);
    pendingEnd.current = false;
    setActiveMode(mode);
    setScaleLabel(null);
    setPositionLabel(null);
    setSensorActive(false);
    setStatus(mode === "lookaround" ? "Opening spatial lookaround…" : `Entering ${modeLabel(mode)}…`);
    if (mode === "lookaround" && targetOverlay.requestFullscreen) {
      void targetOverlay.requestFullscreen().catch(() => undefined);
    }

    void run(
      Effect.flatMap(ImmersivePreview, (service) =>
        service.run({
          mode,
          canvas: targetCanvas,
          overlayRoot: targetOverlay,
          mediaUrl,
          spec,
          audience,
          label,
          orientationPermission,
          onReady: (next) => {
            if (serial !== launchSerial.current) {
              void next.end();
              return;
            }
            controller.current = next;
            if (pendingEnd.current) void next.end();
          },
          onUpdate: (update) => {
            if (serial !== launchSerial.current) return;
            setStatus(update.status);
            setScaleLabel(update.scaleLabel ?? null);
            setSensorActive(update.sensorActive ?? false);
            if (update.positionLabel !== undefined) setPositionLabel(update.positionLabel);
          },
        }),
      ),
    )
      .catch((error: unknown) => {
        if (serial === launchSerial.current) {
          setStatus(errorMessage(error));
          if (document.fullscreenElement === targetOverlay) void document.exitFullscreen().catch(() => undefined);
        }
      })
      .finally(() => {
        if (serial !== launchSerial.current) return;
        controller.current = null;
        pendingEnd.current = false;
        launchedContentKey.current = null;
        setActiveMode(null);
        setSensorActive(false);
        setPositionLabel(null);
      });
  }

  function stop() {
    pendingEnd.current = true;
    setStatus("Closing immersive resources…");
    void controller.current?.end();
  }

  const unavailableReason = !mediaUrl || !spec ? "Select review media first." : null;
  return (
    <>
      <div
        className={
          presentation === "demo-route"
            ? "panel-section immersive-preview-panel is-demo-route"
            : "panel-section immersive-preview-panel"
        }
      >
        <div className="immersive-heading">
          <div>
            <h3>Immersive preview</h3>
            <p>One web scene · progressive device support</p>
          </div>
          <span className={capabilities.secureContext ? "xr-security is-ready" : "xr-security"}>
            {capabilities.secureContext ? "SECURE" : "HTTPS"}
          </span>
        </div>
        <div className="immersive-mode-grid" aria-label="Immersive preview modes">
          <ImmersiveModeButton
            label="Phone Lookaround"
            detail={capabilities.orientation ? "Sensor + pinch" : "Touch + pinch"}
            available={!checking && !unavailableReason}
            active={activeMode === "lookaround"}
            onClick={() => launch("lookaround")}
          />
          <ImmersiveModeButton
            label="Enter VR"
            detail="Quest / WebXR"
            available={!checking && !unavailableReason && capabilities.vr}
            active={activeMode === "immersive-vr"}
            onClick={() => launch("immersive-vr")}
          />
          {presentation === "panel" ? (
            <ImmersiveModeButton
              label="Place AR Model"
              detail="WebXR hit test"
              available={!checking && !unavailableReason && capabilities.ar}
              active={activeMode === "immersive-ar"}
              onClick={() => launch("immersive-ar")}
            />
          ) : null}
        </div>
        <p className="immersive-support-readout" aria-live="polite">
          {checking ? "Detecting WebXR modes…" : (unavailableReason ?? status)}
        </p>
        {plan && spec ? (
          <p className="immersive-metric-readout">
            <strong>{sourceProjectionLabel(spec.projectionMode)}</strong>
            <span>
              {plan.shape === "circle"
                ? `Ø${formatMeters(plan.widthMeters)}`
                : `${formatMeters(plan.widthMeters)} × ${formatMeters(plan.depthMeters)}`}
              {` · ${formatMeters(plan.heightMeters)} high`}
            </span>
          </p>
        ) : null}
      </div>

      <div
        ref={overlay}
        className={activeMode ? `immersive-overlay is-active is-${activeMode}` : "immersive-overlay"}
        role="dialog"
        aria-modal={activeMode ? "true" : undefined}
        aria-hidden={activeMode ? undefined : "true"}
        aria-label="Zenith Immersive Preview"
      >
        <canvas ref={canvas} className="immersive-canvas" aria-label="Immersive spatial carrier" />
        <div className="immersive-overlay-chrome">
          <div className="immersive-overlay-title">
            <span>ZENITH / IMMERSIVE PREVIEW</span>
            <strong>{activeMode ? modeLabel(activeMode) : "Spatial preview"}</strong>
          </div>
          <div className="immersive-overlay-state" role="status">
            <span className="status-dot" aria-hidden="true" />
            <span>{status}</span>
            {scaleLabel ? <strong>{scaleLabel}</strong> : null}
            {sensorActive ? <strong>SENSOR</strong> : null}
            {positionLabel ? <strong>{positionLabel}</strong> : null}
          </div>
          <div className="immersive-overlay-actions">
            {activeMode === "lookaround" ? (
              <div className="immersive-dolly-actions" role="group" aria-label="Spatial movement">
                <button
                  className="button ghost immersive-dolly-button"
                  type="button"
                  aria-label="Move backward"
                  title="Move backward"
                  onClick={() => controller.current?.move("backward")}
                >
                  −
                </button>
                <button
                  className="button ghost immersive-dolly-button"
                  type="button"
                  aria-label="Move forward"
                  title="Move forward"
                  onClick={() => controller.current?.move("forward")}
                >
                  +
                </button>
              </div>
            ) : null}
            <button className="button ghost" type="button" onClick={() => controller.current?.recenter()}>
              Recenter
            </button>
            <button className="button" type="button" onClick={stop}>
              Exit preview
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function ImmersiveModeButton({
  label,
  detail,
  available,
  active,
  onClick,
}: {
  readonly label: string;
  readonly detail: string;
  readonly available: boolean;
  readonly active: boolean;
  readonly onClick: () => void;
}) {
  return (
    <button
      className={active ? "immersive-mode is-active" : "immersive-mode"}
      type="button"
      disabled={!available || active}
      onClick={onClick}
    >
      <strong>{label}</strong>
      <small>{available ? detail : "Unavailable here"}</small>
    </button>
  );
}

function capabilitySummary(capabilities: ImmersiveCapabilities): string {
  if (capabilities.vr && capabilities.ar) return "VR and AR are available on this device.";
  if (capabilities.vr) return "VR is available; AR is not exposed by this device.";
  if (capabilities.ar) return "AR is available; immersive VR is not exposed by this device.";
  if (!capabilities.secureContext) return "Phone Lookaround works; HTTPS is required for immersive WebXR.";
  return "Phone Lookaround is available; this browser exposes no immersive XR session.";
}

function modeLabel(mode: ImmersivePreviewMode): string {
  if (mode === "immersive-vr") return "VR at 1:1 scale";
  if (mode === "immersive-ar") return "AR scale model";
  return "Phone Lookaround";
}

function errorMessage(error: unknown): string {
  if (typeof error === "object" && error && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return error instanceof Error ? error.message : "Immersive preview failed.";
}

function formatMeters(value: number): string {
  return `${Number(value.toFixed(2))}m`;
}
