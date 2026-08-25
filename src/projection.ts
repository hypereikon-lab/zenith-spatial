export const TAU = Math.PI * 2;
export const HALF_PI = Math.PI * 0.5;

export type Vec3 = [number, number, number];
export type Vec4 = [number, number, number, number];
export type Mat4 = Float32Array;
export type Point2D = { x: number; y: number };
export type Rect = { x: number; y: number; width: number; height: number };
export type ProjectionProfile = {
  width: number;
  height: number;
  fisheyeScaleX: number;
  fisheyeScaleY: number;
  radiusPixels: number;
};
export type MapUv = { u: number; v: number };
export type TangentBasis = { center: Vec3; right: Vec3; down: Vec3 };
export type RotationRows = [Vec3, Vec3, Vec3];

export function perspectiveLH(fovy: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovy / 2);
  const range = far / (far - near);
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, range, 1, 0, 0, -near * range, 0]);
}

export function orthographicLH(width: number, height: number, near: number, far: number): Mat4 {
  const safeWidth = Math.max(0.000001, width);
  const safeHeight = Math.max(0.000001, height);
  const range = 1 / Math.max(0.000001, far - near);
  return new Float32Array([
    2 / safeWidth,
    0,
    0,
    0,
    0,
    2 / safeHeight,
    0,
    0,
    0,
    0,
    range,
    0,
    0,
    0,
    -near * range,
    1,
  ]);
}

export function lookAtLH(eye: Vec3, target: Vec3, up: Vec3): Mat4 {
  const z = normalize(subtract(target, eye));
  const x = normalize(cross(up, z));
  const y = cross(z, x);

  return new Float32Array([
    x[0],
    y[0],
    z[0],
    0,
    x[1],
    y[1],
    z[1],
    0,
    x[2],
    y[2],
    z[2],
    0,
    -dot(x, eye),
    -dot(y, eye),
    -dot(z, eye),
    1,
  ]);
}

export function multiplyMat4(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let col = 0; col < 4; col += 1) {
    for (let row = 0; row < 4; row += 1) {
      out[col * 4 + row] =
        a[row] * b[col * 4] + a[4 + row] * b[col * 4 + 1] + a[8 + row] * b[col * 4 + 2] + a[12 + row] * b[col * 4 + 3];
    }
  }
  return out;
}

export function multiplyMat4Vec4(m: Mat4, v: Vec4): Vec4 {
  return [
    m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12] * v[3],
    m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13] * v[3],
    m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14] * v[3],
    m[3] * v[0] + m[7] * v[1] + m[11] * v[2] + m[15] * v[3],
  ];
}

export function translationScaleMat4(tx: number, ty: number, tz: number, sx: number, sy: number, sz: number): Mat4 {
  return new Float32Array([sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, sz, 0, tx, ty, tz, 1]);
}

export function subtract(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function scaleVec3(v: Vec3, scale: number): Vec3 {
  return [v[0] * scale, v[1] * scale, v[2] * scale];
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export function normalize(v: Vec3): Vec3 {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
}

export function vectorLength(v: Vec3): number {
  return Math.hypot(v[0], v[1], v[2]);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function mod(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

export function wrapDegrees(value: number): number {
  return ((((value + 180) % 360) + 360) % 360) - 180;
}

export function unwrapAngleNear(angle: number, target: number): number {
  return target + Math.atan2(Math.sin(angle - target), Math.cos(angle - target));
}

export function distance2d(a: Point2D, b: Point2D): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function pointInPolygon(point: Point2D, polygon: Point2D[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersects = yi > point.y !== yj > point.y && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi || 1) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function angularDistance(a: Vec3, b: Vec3): number {
  return Math.acos(clamp(dot(a, b), -1, 1));
}

export function slerpDirections(a: Vec3, b: Vec3, t: number): Vec3 {
  const omega = angularDistance(a, b);
  if (omega <= 0.000001) return normalize(a);
  const sine = Math.sin(omega);
  if (Math.abs(sine) <= 0.000001) {
    const alternateAxis: Vec3 = Math.abs(a[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const axis = normalize(cross(a, alternateAxis));
    return rotateVectorAroundAxis(a, axis, omega * t);
  }
  const scaleA = Math.sin((1 - t) * omega) / sine;
  const scaleB = Math.sin(t * omega) / sine;
  return normalize([a[0] * scaleA + b[0] * scaleB, a[1] * scaleA + b[1] * scaleB, a[2] * scaleA + b[2] * scaleB]);
}

export function rotateVectorAroundAxis(value: Vec3, axis: Vec3, angle: number): Vec3 {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const axisDot = dot(axis, value);
  const axisCross = cross(axis, value);
  return normalize([
    value[0] * cosine + axisCross[0] * sine + axis[0] * axisDot * (1 - cosine),
    value[1] * cosine + axisCross[1] * sine + axis[1] * axisDot * (1 - cosine),
    value[2] * cosine + axisCross[2] * sine + axis[2] * axisDot * (1 - cosine),
  ]);
}

export function rotationRowsFromTo(fromDirection: Vec3, toDirection: Vec3): RotationRows {
  const from = normalize(fromDirection);
  const to = normalize(toDirection);
  const axisCross = cross(from, to);
  const sine = vectorLength(axisCross);
  const cosine = clamp(dot(from, to), -1, 1);
  if (sine < 0.000001) {
    if (cosine > 0) return identityRotationRows();
    const alternateAxis: Vec3 = Math.abs(from[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    return rotationRowsAroundAxis(normalize(cross(from, alternateAxis)), Math.PI);
  }
  const [x, y, z] = axisCross;
  const k = (1 - cosine) / (sine * sine);
  return [
    [cosine + x * x * k, x * y * k - z, x * z * k + y],
    [y * x * k + z, cosine + y * y * k, y * z * k - x],
    [z * x * k - y, z * y * k + x, cosine + z * z * k],
  ];
}

export function rotationRowsAroundAxis(axis: Vec3, angle: number): RotationRows {
  const [x, y, z] = normalize(axis);
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const t = 1 - cosine;
  return [
    [t * x * x + cosine, t * x * y - sine * z, t * x * z + sine * y],
    [t * x * y + sine * z, t * y * y + cosine, t * y * z - sine * x],
    [t * x * z - sine * y, t * y * z + sine * x, t * z * z + cosine],
  ];
}

export function identityRotationRows(): RotationRows {
  return [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
}

export function projectionRadiusForTheta(theta: number): number {
  return clamp(theta / HALF_PI, 0, 1);
}

export function inverseMotionProjectionRadius(radial: number): number {
  return clamp(radial, 0, 1) * HALF_PI;
}

export function projectedPixelSpanToTangentHalf(pixelSpan: number, profile: ProjectionProfile): number {
  const normalizedHalfSpan = clamp((Math.max(1, pixelSpan) * 0.5) / Math.max(1, profile.radiusPixels), 0.0001, 0.96);
  const halfAngle = Math.min(inverseMotionProjectionRadius(normalizedHalfSpan), 1.35);
  return Math.max(0.0001, Math.tan(halfAngle));
}

export function tangentBasisAtMapUv(u: number, v: number, profile: ProjectionProfile): TangentBasis | null {
  const center = mapUvToDomeDirection(u, v, profile);
  if (!center) return null;
  const epsilon = 2 / Math.max(profile.width, profile.height);
  const xNeighbor = mapUvToDomeDirection(u + epsilon, v, profile) || mapUvToDomeDirection(u - epsilon, v, profile);
  const yNeighbor = mapUvToDomeDirection(u, v + epsilon, profile) || mapUvToDomeDirection(u, v - epsilon, profile);
  let right = xNeighbor ? tangentVector(center, xNeighbor) : null;
  let down = yNeighbor ? tangentVector(center, yNeighbor) : null;
  if (!right || vectorLength(right) < 0.000001) {
    right = Math.abs(center[1]) > 0.97 ? [1, 0, 0] : normalize(cross([0, 1, 0], center));
  } else {
    right = normalize(right);
  }
  if (!down || vectorLength(down) < 0.000001) {
    down = normalize(cross(center, right));
  } else {
    down = subtract(down, scaleVec3(right, dot(down, right)));
    down = vectorLength(down) < 0.000001 ? normalize(cross(center, right)) : normalize(down);
  }
  if (dot(cross(right, down), center) < 0) {
    down = scaleVec3(down, -1);
  }
  return { center, right, down };
}

export function mapUvToDomeDirection(u: number, v: number, profile: ProjectionProfile): Vec3 | null {
  const x = (u - 0.5) / Math.max(0.0001, profile.fisheyeScaleX);
  const y = (v - 0.5) / Math.max(0.0001, profile.fisheyeScaleY);
  const radial = Math.hypot(x, y);
  if (radial > 1.0001) return null;
  const theta = inverseMotionProjectionRadius(radial);
  const azimuth = radial > 0.000001 ? Math.atan2(x, -y) : 0;
  const sinTheta = Math.sin(theta);
  return [sinTheta * Math.sin(azimuth), Math.cos(theta), sinTheta * Math.cos(azimuth)];
}

export function domeDirectionToMotionUv(direction: Vec3, profile: ProjectionProfile): MapUv | null {
  if (direction[1] < -0.0001) return null;
  const theta = Math.acos(clamp(direction[1], 0, 1));
  const radial = projectionRadiusForTheta(theta);
  if (radial > 1.0001) return null;
  const azimuth = Math.atan2(direction[0], direction[2]);
  return {
    u: 0.5 + Math.sin(azimuth) * profile.fisheyeScaleX * radial,
    v: 0.5 - Math.cos(azimuth) * profile.fisheyeScaleY * radial,
  };
}

export function projectedLayerBounds(
  basis: TangentBasis,
  halfWidth: number,
  halfHeight: number,
  scale: number,
  spin: number,
  profile: ProjectionProfile,
): Rect | null {
  const cosSpin = Math.cos(spin);
  const sinSpin = Math.sin(spin);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const samples = 6;
  for (let yIndex = 0; yIndex <= samples; yIndex += 1) {
    const sourceY = lerp(-halfHeight, halfHeight, yIndex / samples);
    for (let xIndex = 0; xIndex <= samples; xIndex += 1) {
      if (xIndex > 0 && xIndex < samples && yIndex > 0 && yIndex < samples) continue;
      const sourceX = lerp(-halfWidth, halfWidth, xIndex / samples);
      const localX = (sourceX * cosSpin - sourceY * sinSpin) * scale;
      const localY = (sourceX * sinSpin + sourceY * cosSpin) * scale;
      const direction = tangentLocalToDirection(basis, localX, localY);
      const uv = domeDirectionToMotionUv(direction, profile);
      if (!uv) continue;
      minX = Math.min(minX, uv.u * profile.width);
      minY = Math.min(minY, uv.v * profile.height);
      maxX = Math.max(maxX, uv.u * profile.width);
      maxY = Math.max(maxY, uv.v * profile.height);
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  const pad = 6;
  const x0 = clamp(Math.floor(minX - pad), 0, profile.width - 1);
  const y0 = clamp(Math.floor(minY - pad), 0, profile.height - 1);
  const x1 = clamp(Math.ceil(maxX + pad), x0 + 1, profile.width);
  const y1 = clamp(Math.ceil(maxY + pad), y0 + 1, profile.height);
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

export function tangentLocalToDirection(basis: TangentBasis, localX: number, localY: number): Vec3 {
  return normalize([
    basis.center[0] + basis.right[0] * localX + basis.down[0] * localY,
    basis.center[1] + basis.right[1] * localX + basis.down[1] * localY,
    basis.center[2] + basis.right[2] * localX + basis.down[2] * localY,
  ]);
}

export function tangentVector(center: Vec3, neighbor: Vec3): Vec3 {
  return subtract(neighbor, scaleVec3(center, dot(neighbor, center)));
}
