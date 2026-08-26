import { clamp, normalize, vectorLength, type Vec3 } from "../projection.js";

export type LookaroundNavigationState = {
  readonly yawDegrees: number;
  readonly pitchDegrees: number;
  readonly offset: Vec3;
  readonly offsetMeters: number;
};

type PointerPosition = { readonly id: number; readonly x: number; readonly y: number };
type DragAnchor = PointerPosition & { readonly yawDegrees: number; readonly pitchDegrees: number };
type PinchAnchor = {
  readonly pointerIds: readonly [number, number];
  readonly distancePixels: number;
  readonly offset: Vec3;
  readonly forward: Vec3;
};

const YAW_DEGREES_PER_PIXEL = 0.16;
const PITCH_DEGREES_PER_PIXEL = 0.13;
const MAX_TOUCH_PITCH_DEGREES = 80;
const PINCH_RANGE_MULTIPLIER = 1.25;

/** Runtime-only touch navigation. The offset is accumulated in world space so turning never moves the observer. */
export class LookaroundNavigation {
  private readonly pointers = new Map<number, PointerPosition>();
  private dragAnchor: DragAnchor | null = null;
  private pinchAnchor: PinchAnchor | null = null;
  private yawDegrees = 0;
  private pitchDegrees = 0;
  private offset: Vec3 = [0, 0, 0];
  private viewportPixels = 400;

  constructor(private readonly maxOffsetMeters: number) {}

  setViewportSize(width: number, height: number): void {
    const shortestSide = Math.min(width, height);
    if (Number.isFinite(shortestSide)) this.viewportPixels = Math.max(160, shortestSide);
  }

  pointerDown(id: number, x: number, y: number, forward: Vec3): void {
    this.pointers.set(id, { id, x, y });
    this.rebaseGesture(forward);
  }

  pointerMove(id: number, x: number, y: number, forward: Vec3): "drag" | "pinch" | null {
    if (!this.pointers.has(id)) return null;
    this.pointers.set(id, { id, x, y });
    if (this.pointers.size >= 2) {
      if (!this.pinchAnchor || !this.pinchPointersRemainActive(this.pinchAnchor)) this.rebaseGesture(forward);
      const pinch = this.pinchAnchor;
      if (!pinch) return null;
      const points = pinch.pointerIds.map((pointerId) => this.pointers.get(pointerId));
      if (!points[0] || !points[1]) return null;
      const deltaPixels = pointerDistance(points[0], points[1]) - pinch.distancePixels;
      const deltaMeters =
        (deltaPixels / this.viewportPixels) * Math.max(this.maxOffsetMeters, 0) * PINCH_RANGE_MULTIPLIER;
      this.offset = clampOffset(addScaled(pinch.offset, pinch.forward, deltaMeters), this.maxOffsetMeters);
      return "pinch";
    }

    const drag = this.dragAnchor;
    if (!drag || drag.id !== id) {
      this.rebaseGesture(forward);
      return null;
    }
    this.yawDegrees = drag.yawDegrees + (x - drag.x) * YAW_DEGREES_PER_PIXEL;
    this.pitchDegrees = clamp(
      drag.pitchDegrees + (y - drag.y) * PITCH_DEGREES_PER_PIXEL,
      -MAX_TOUCH_PITCH_DEGREES,
      MAX_TOUCH_PITCH_DEGREES,
    );
    return "drag";
  }

  pointerEnd(id: number, forward: Vec3): void {
    this.pointers.delete(id);
    this.rebaseGesture(forward);
  }

  dollyBy(deltaMeters: number, forward: Vec3): void {
    if (!Number.isFinite(deltaMeters)) return;
    this.offset = clampOffset(addScaled(this.offset, normalize(forward), deltaMeters), this.maxOffsetMeters);
  }

  dollyFromWheel(deltaY: number, forward: Vec3): void {
    this.dollyBy((-deltaY / 900) * Math.max(this.maxOffsetMeters, 0), forward);
  }

  dollyStepMeters(): number {
    return Math.min(Math.max(this.maxOffsetMeters / 8, 0.15), 0.5);
  }

  recenter(forward: Vec3): void {
    this.yawDegrees = 0;
    this.pitchDegrees = 0;
    this.offset = [0, 0, 0];
    this.rebaseGesture(forward);
  }

  state(): LookaroundNavigationState {
    return {
      yawDegrees: this.yawDegrees,
      pitchDegrees: this.pitchDegrees,
      offset: [...this.offset],
      offsetMeters: vectorLength(this.offset),
    };
  }

  private rebaseGesture(forward: Vec3): void {
    const active = [...this.pointers.values()];
    if (active.length >= 2) {
      const first = active[0]!;
      const second = active[1]!;
      this.dragAnchor = null;
      this.pinchAnchor = {
        pointerIds: [first.id, second.id],
        distancePixels: pointerDistance(first, second),
        offset: [...this.offset],
        forward: normalize(forward),
      };
      return;
    }
    this.pinchAnchor = null;
    const pointer = active[0];
    this.dragAnchor = pointer ? { ...pointer, yawDegrees: this.yawDegrees, pitchDegrees: this.pitchDegrees } : null;
  }

  private pinchPointersRemainActive(pinch: PinchAnchor): boolean {
    return pinch.pointerIds.every((pointerId) => this.pointers.has(pointerId));
  }
}

function pointerDistance(left: PointerPosition, right: PointerPosition): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function addScaled(origin: Vec3, direction: Vec3, distance: number): Vec3 {
  return [
    origin[0] + direction[0] * distance,
    origin[1] + direction[1] * distance,
    origin[2] + direction[2] * distance,
  ];
}

function clampOffset(offset: Vec3, maximum: number): Vec3 {
  const limit = Number.isFinite(maximum) ? Math.max(maximum, 0) : 0;
  const length = vectorLength(offset);
  if (length <= limit || length <= 0) return offset;
  const direction = normalize(offset);
  return [direction[0] * limit, direction[1] * limit, direction[2] * limit];
}
