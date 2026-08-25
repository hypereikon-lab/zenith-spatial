import { HALF_PI, TAU } from "../projection.js";
import { DEFAULT_CAVE_ROOM, normalizeCaveRoom, type CaveRoom } from "../geometry/cave-projection.js";
import {
  DEFAULT_DOUBLE_GABLE_PROJECTION_SURFACE,
  planarRoofProfile,
  type DoubleGableProjectionSurface,
} from "../lib/shared/contracts/projection-authoring.js";
import {
  DEFAULT_CYLINDER_ROOM,
  normalizeCylinderRoom,
  type CylinderCarrierMode,
  type CylinderRoom,
} from "../geometry/cylinder-continuity-carrier.js";

type GeometryBuffers = { vertices: Float32Array; indices: Uint32Array };
type CaveGeometryBuffers = GeometryBuffers & { vertexStrideFloats: number };

export function buildDomeGeometry(quality: number, thetaStart = 0, thetaEnd = HALF_PI): GeometryBuffers {
  const rings = [64, 112, 176][quality] ?? 112;
  const segments = [128, 224, 352][quality] ?? 224;
  const vertices: number[] = [];
  const indices: number[] = [];
  const start = Math.max(0, Math.min(Math.PI, thetaStart));
  const end = Math.max(start, Math.min(Math.PI, thetaEnd));

  for (let ring = 0; ring <= rings; ring += 1) {
    const theta = start + (ring / rings) * (end - start);
    const sinTheta = Math.sin(theta);
    const y = Math.cos(theta);

    for (let segment = 0; segment <= segments; segment += 1) {
      const phi = (segment / segments) * TAU;
      vertices.push(sinTheta * Math.sin(phi), y, sinTheta * Math.cos(phi));
    }
  }

  for (let ring = 0; ring < rings; ring += 1) {
    const row = ring * (segments + 1);
    const nextRow = (ring + 1) * (segments + 1);

    for (let segment = 0; segment < segments; segment += 1) {
      const a = row + segment;
      const b = row + segment + 1;
      const c = nextRow + segment;
      const d = nextRow + segment + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  return {
    vertices: new Float32Array(vertices),
    indices: new Uint32Array(indices),
  };
}

export function buildRoomGeometry(segments = 160): GeometryBuffers {
  const vertices = [0, 0, 0];
  const indices: number[] = [];

  for (let segment = 0; segment <= segments; segment += 1) {
    const angle = (segment / segments) * TAU;
    vertices.push(Math.sin(angle), 0, Math.cos(angle));
  }

  for (let segment = 1; segment <= segments; segment += 1) {
    indices.push(0, segment, segment + 1);
  }

  return {
    vertices: new Float32Array(vertices),
    indices: new Uint32Array(indices),
  };
}

export function buildCaveRoomGeometry(room: CaveRoom = DEFAULT_CAVE_ROOM): CaveGeometryBuffers {
  const normalizedRoom = normalizeCaveRoom(room);
  const halfWidth = normalizedRoom.width * 0.5;
  const halfDepth = normalizedRoom.depth * 0.5;
  const eyeHeight = normalizedRoom.eyeHeight;
  const bottom = -eyeHeight;
  const top = normalizedRoom.height - eyeHeight;
  const minX = -halfWidth - normalizedRoom.eyeX;
  const maxX = halfWidth - normalizedRoom.eyeX;
  const minZ = -halfDepth - normalizedRoom.eyeZ;
  const maxZ = halfDepth - normalizedRoom.eyeZ;
  const vertices: number[] = [];
  const indices: number[] = [];

  addFace(
    vertices,
    indices,
    [
      [minX, top, maxZ],
      [maxX, top, maxZ],
      [maxX, bottom, maxZ],
      [minX, bottom, maxZ],
    ],
    0,
  );
  addFace(
    vertices,
    indices,
    [
      [maxX, top, maxZ],
      [maxX, top, minZ],
      [maxX, bottom, minZ],
      [maxX, bottom, maxZ],
    ],
    1,
  );
  addFace(
    vertices,
    indices,
    [
      [maxX, top, minZ],
      [minX, top, minZ],
      [minX, bottom, minZ],
      [maxX, bottom, minZ],
    ],
    2,
  );
  addFace(
    vertices,
    indices,
    [
      [minX, top, minZ],
      [minX, top, maxZ],
      [minX, bottom, maxZ],
      [minX, bottom, minZ],
    ],
    3,
  );
  addFace(
    vertices,
    indices,
    [
      [minX, bottom, maxZ],
      [maxX, bottom, maxZ],
      [maxX, bottom, minZ],
      [minX, bottom, minZ],
    ],
    4,
  );

  return {
    vertices: new Float32Array(vertices),
    indices: new Uint32Array(indices),
    vertexStrideFloats: 6,
  };
}

export function buildDoubleGableRoomGeometry(
  room: DoubleGableProjectionSurface = DEFAULT_DOUBLE_GABLE_PROJECTION_SURFACE,
): CaveGeometryBuffers {
  const halfLength = room.length * 0.5;
  const minX = -halfLength - room.eyeX;
  const maxX = halfLength - room.eyeX;
  const bottom = -room.eyeHeight;
  const profile = planarRoofProfile(room).map((anchor) => ({
    z: (anchor.position - 0.5) * room.width - room.eyeZ,
    height: anchor.height - room.eyeHeight,
  }));
  const vertices: number[] = [];
  const indices: number[] = [];

  addFace(
    vertices,
    indices,
    [
      [minX, profile.at(-1)!.height, profile.at(-1)!.z],
      [maxX, profile.at(-1)!.height, profile.at(-1)!.z],
      [maxX, bottom, profile.at(-1)!.z],
      [minX, bottom, profile.at(-1)!.z],
    ],
    0,
  );
  addFace(
    vertices,
    indices,
    [
      [maxX, profile[0].height, profile[0].z],
      [minX, profile[0].height, profile[0].z],
      [minX, bottom, profile[0].z],
      [maxX, bottom, profile[0].z],
    ],
    2,
  );

  for (let segment = 0; segment < profile.length - 1; segment += 1) {
    const left = profile[segment];
    const right = profile[segment + 1];
    addFace(
      vertices,
      indices,
      [
        [maxX, left.height, left.z],
        [maxX, right.height, right.z],
        [maxX, bottom, right.z],
        [maxX, bottom, left.z],
      ],
      1,
    );
    addFace(
      vertices,
      indices,
      [
        [minX, right.height, right.z],
        [minX, left.height, left.z],
        [minX, bottom, left.z],
        [minX, bottom, right.z],
      ],
      3,
    );
    addFace(
      vertices,
      indices,
      [
        [minX, left.height, left.z],
        [minX, right.height, right.z],
        [maxX, right.height, right.z],
        [maxX, left.height, left.z],
      ],
      4 + segment,
    );
  }

  return {
    vertices: new Float32Array(vertices),
    indices: new Uint32Array(indices),
    vertexStrideFloats: 6,
  };
}

export function buildCylinderRoomGeometry(
  mode: CylinderCarrierMode,
  room: Partial<CylinderRoom> = DEFAULT_CYLINDER_ROOM,
  segments = 192,
): CaveGeometryBuffers {
  const normalizedRoom = normalizeCylinderRoom(room);
  const bottom = -normalizedRoom.eyeHeight;
  const top = normalizedRoom.height - normalizedRoom.eyeHeight;
  const capY = mode === "cylinder-nadir" ? bottom : top;
  const vertices: number[] = [];
  const indices: number[] = [];
  const steps = Math.max(12, Math.round(segments));

  for (let segment = 0; segment < steps; segment += 1) {
    const next = segment + 1;
    const angle0 = (segment / steps) * TAU;
    const angle1 = (next / steps) * TAU;
    addFace(
      vertices,
      indices,
      [
        [Math.sin(angle0) * normalizedRoom.radius, top, Math.cos(angle0) * normalizedRoom.radius],
        [Math.sin(angle1) * normalizedRoom.radius, top, Math.cos(angle1) * normalizedRoom.radius],
        [Math.sin(angle1) * normalizedRoom.radius, bottom, Math.cos(angle1) * normalizedRoom.radius],
        [Math.sin(angle0) * normalizedRoom.radius, bottom, Math.cos(angle0) * normalizedRoom.radius],
      ],
      0,
    );

    const start = vertices.length / 6;
    vertices.push(0, capY, 0, 0.5, 0.5, 1);
    vertices.push(
      Math.sin(angle0) * normalizedRoom.radius,
      capY,
      Math.cos(angle0) * normalizedRoom.radius,
      Math.sin(angle0) * 0.5 + 0.5,
      0.5 - Math.cos(angle0) * 0.5,
      1,
    );
    vertices.push(
      Math.sin(angle1) * normalizedRoom.radius,
      capY,
      Math.cos(angle1) * normalizedRoom.radius,
      Math.sin(angle1) * 0.5 + 0.5,
      0.5 - Math.cos(angle1) * 0.5,
      1,
    );
    indices.push(start, start + 1, start + 2);
  }

  return {
    vertices: new Float32Array(vertices),
    indices: new Uint32Array(indices),
    vertexStrideFloats: 6,
  };
}

function addFace(vertices: number[], indices: number[], corners: number[][], faceIndex: number): void {
  const start = vertices.length / 6;
  const uvs = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];
  for (let index = 0; index < corners.length; index += 1) {
    const corner = corners[index];
    const uv = uvs[index];
    vertices.push(corner[0], corner[1], corner[2], uv[0], uv[1], faceIndex);
  }
  indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
}
