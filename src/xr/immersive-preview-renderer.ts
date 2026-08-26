import type { AudienceInSpace, ImageSpatialSpec } from "../domain/schema.js";
import { audienceVenuePlan } from "../geometry/audience-in-space.js";
import { clamp, normalize, type Vec3 } from "../projection.js";
import { buildImmersiveCarrierMesh, immersiveArPlacement, immersiveVrModelMatrix } from "./spatial-preview-mesh.js";

export type ImmersivePreviewMode = "lookaround" | "immersive-vr" | "immersive-ar";

export type ImmersivePreviewRendererInput = {
  readonly mode: ImmersivePreviewMode;
  readonly canvas: HTMLCanvasElement;
  readonly overlayRoot: HTMLElement;
  readonly mediaUrl: string;
  readonly spec: ImageSpatialSpec;
  readonly audience: AudienceInSpace;
  readonly label: string;
  readonly signal: AbortSignal;
  readonly onUpdate: (update: ImmersiveRendererUpdate) => void;
};

export type ImmersiveRendererUpdate = {
  readonly status: string;
  readonly scaleLabel?: string;
  readonly sensorActive?: boolean;
};

export type ImmersivePreviewController = {
  readonly finished: Promise<void>;
  readonly end: () => Promise<void>;
  readonly recenter: () => void;
};

type DeviceOrientationConstructor = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<"granted" | "denied">;
};

type WakeLockNavigator = Navigator & {
  readonly wakeLock?: { request: (type: "screen") => Promise<{ release: () => Promise<void> }> };
};

export async function startImmersivePreviewRenderer(
  input: ImmersivePreviewRendererInput,
): Promise<ImmersivePreviewController> {
  if (input.mode === "lookaround") return startLookaround(input);
  return startWebXr(input);
}

async function startLookaround(input: ImmersivePreviewRendererInput): Promise<ImmersivePreviewController> {
  const permission = requestOrientationPermission();
  const renderer = await GlSpatialRenderer.create(
    input.canvas,
    input.mediaUrl,
    input.spec,
    input.audience,
    input.signal,
  );
  const permissionState = await permission;
  if (input.signal.aborted) {
    renderer.destroy();
    throw new DOMException("Immersive preview was interrupted.", "AbortError");
  }
  let ended = false;
  let frameId = 0;
  let resolveFinished!: () => void;
  const finished = new Promise<void>((resolve) => {
    resolveFinished = resolve;
  });
  const plan = audienceVenuePlan(input.audience, input.spec.projectionMode, input.spec.surface);
  const eye: Vec3 = [
    input.audience.xMeters - plan.projectionObserver.xMeters,
    input.audience.eyeHeightMeters - plan.projectionObserver.eyeHeightMeters,
    input.audience.zMeters - plan.projectionObserver.zMeters,
  ];
  let sensorBaseline: { alpha: number; beta: number } | null = null;
  let sensorYaw = 0;
  let sensorPitch = 0;
  let receivedOrientation = false;
  let dragYaw = 0;
  let dragPitch = 0;
  let pointer: { id: number; x: number; y: number; yaw: number; pitch: number } | null = null;
  let wakeLock: { release: () => Promise<void> } | null = null;

  const recenter = () => {
    sensorBaseline = null;
    sensorYaw = 0;
    sensorPitch = 0;
    dragYaw = 0;
    dragPitch = 0;
    input.onUpdate({
      status: permissionState === "granted" ? "Phone orientation recentered." : "Touch view recentered.",
      sensorActive: receivedOrientation,
    });
  };

  const orientation = (event: DeviceOrientationEvent) => {
    if (event.alpha === null || event.beta === null) return;
    if (!receivedOrientation) {
      receivedOrientation = true;
      input.onUpdate({ status: `${input.label} · move the phone or drag to look around.`, sensorActive: true });
    }
    sensorBaseline ??= { alpha: event.alpha, beta: event.beta };
    sensorYaw = shortestAngleDegrees(event.alpha - sensorBaseline.alpha);
    sensorPitch = clamp(event.beta - sensorBaseline.beta, -75, 75);
  };
  const pointerDown = (event: PointerEvent) => {
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, yaw: dragYaw, pitch: dragPitch };
    input.canvas.setPointerCapture(event.pointerId);
  };
  const pointerMove = (event: PointerEvent) => {
    if (!pointer || pointer.id !== event.pointerId) return;
    dragYaw = pointer.yaw + (event.clientX - pointer.x) * 0.16;
    dragPitch = clamp(pointer.pitch + (event.clientY - pointer.y) * 0.13, -80, 80);
  };
  const pointerEnd = (event: PointerEvent) => {
    if (!pointer || pointer.id !== event.pointerId) return;
    if (input.canvas.hasPointerCapture(event.pointerId)) input.canvas.releasePointerCapture(event.pointerId);
    pointer = null;
  };
  const resize = () => resizeCanvas(input.canvas);

  resize();
  input.canvas.addEventListener("pointerdown", pointerDown);
  input.canvas.addEventListener("pointermove", pointerMove);
  input.canvas.addEventListener("pointerup", pointerEnd);
  input.canvas.addEventListener("pointercancel", pointerEnd);
  window.addEventListener("resize", resize);
  if (permissionState === "granted") window.addEventListener("deviceorientation", orientation, true);
  const wakeLockNavigator = navigator as WakeLockNavigator;
  if (wakeLockNavigator.wakeLock) {
    void wakeLockNavigator.wakeLock
      .request("screen")
      .then((lock) => {
        if (ended) void lock.release();
        else wakeLock = lock;
      })
      .catch(() => undefined);
  }

  input.onUpdate({
    status:
      permissionState === "granted"
        ? `${input.label} · orientation ready; drag also works.`
        : `${input.label} · orientation unavailable; drag to look around.`,
    sensorActive: false,
  });

  const render = () => {
    if (ended) return;
    const yawDegrees = input.audience.yawDegrees + sensorYaw + dragYaw;
    const pitchDegrees = clamp(input.audience.pitchDegrees + sensorPitch + dragPitch, -88, 88);
    const forward = forwardFromEuler(yawDegrees, pitchDegrees);
    const target: Vec3 = [eye[0] + forward[0], eye[1] + forward[1], eye[2] + forward[2]];
    const projection = perspectiveMatrix(
      input.audience.fovDegrees,
      input.canvas.width / Math.max(input.canvas.height, 1),
      0.02,
      Math.max(200, input.audience.domeRadiusMeters * 4),
    );
    const view = lookAtMatrix(eye, target, [0, 1, 0]);
    renderer.draw(projection, view, identityMatrix(), {
      x: 0,
      y: 0,
      width: input.canvas.width,
      height: input.canvas.height,
    });
    frameId = requestAnimationFrame(render);
  };
  frameId = requestAnimationFrame(render);

  const end = async () => {
    if (ended) return;
    ended = true;
    cancelAnimationFrame(frameId);
    input.canvas.removeEventListener("pointerdown", pointerDown);
    input.canvas.removeEventListener("pointermove", pointerMove);
    input.canvas.removeEventListener("pointerup", pointerEnd);
    input.canvas.removeEventListener("pointercancel", pointerEnd);
    window.removeEventListener("resize", resize);
    window.removeEventListener("deviceorientation", orientation, true);
    renderer.destroy();
    await wakeLock?.release().catch(() => undefined);
    if (document.fullscreenElement === input.overlayRoot) await document.exitFullscreen().catch(() => undefined);
    resolveFinished();
  };
  input.signal.addEventListener("abort", () => void end(), { once: true });
  return { finished, end, recenter };
}

async function startWebXr(input: ImmersivePreviewRendererInput): Promise<ImmersivePreviewController> {
  if (!navigator.xr) throw new Error("WebXR is not available in this browser.");
  const sessionMode: XRSessionMode = input.mode === "immersive-vr" ? "immersive-vr" : "immersive-ar";
  const session = await navigator.xr.requestSession(sessionMode, {
    requiredFeatures: ["local-floor"],
    optionalFeatures: sessionMode === "immersive-ar" ? ["hit-test", "dom-overlay"] : ["dom-overlay"],
    domOverlay: { root: input.overlayRoot },
  });
  if (input.signal.aborted) {
    await session.end().catch(() => undefined);
    throw new DOMException("Immersive preview was interrupted.", "AbortError");
  }
  let renderer: GlSpatialRenderer | null = null;
  let hitTestSource: XRHitTestSource | null = null;
  let frameId = 0;
  let ended = false;
  let resolveFinished!: () => void;
  const finished = new Promise<void>((resolve) => {
    resolveFinished = resolve;
  });
  const finish = () => {
    if (ended) return;
    ended = true;
    if (frameId) session.cancelAnimationFrame(frameId);
    hitTestSource?.cancel();
    hitTestSource = null;
    renderer?.destroy();
    renderer = null;
    resolveFinished();
  };
  session.addEventListener("end", finish, { once: true });
  input.signal.addEventListener(
    "abort",
    () => {
      if (!ended) void session.end().catch(() => finish());
    },
    { once: true },
  );

  try {
    renderer = await GlSpatialRenderer.create(input.canvas, input.mediaUrl, input.spec, input.audience, input.signal);
    if (ended) throw new Error("The WebXR session ended while media was loading.");
    await renderer.makeXrCompatible();
    const layer = new XRWebGLLayer(session, renderer.gl, { alpha: sessionMode === "immersive-ar", antialias: true });
    session.updateRenderState({ baseLayer: layer, depthNear: 0.02, depthFar: 240 });
    const referenceSpace = await session.requestReferenceSpace("local-floor");
    const ar = immersiveArPlacement(input.audience, input.spec);
    const arFallback = multiplyMatrices(translationMatrix(0, 0, -1.35), ar.modelMatrix);
    let arPlacedMatrix: Float32Array | null = null;
    let arCandidateMatrix: Float32Array | null = null;

    if (sessionMode === "immersive-ar" && session.requestHitTestSource) {
      const viewerSpace = await session.requestReferenceSpace("viewer");
      hitTestSource = (await session.requestHitTestSource({ space: viewerSpace })) ?? null;
    }
    const select = () => {
      if (!arCandidateMatrix) return;
      arPlacedMatrix = arCandidateMatrix;
      input.onUpdate({ status: `${input.label} placed as an AR scale model.`, scaleLabel: `1:${ar.scaleDenominator}` });
    };
    session.addEventListener("select", select);

    input.onUpdate(
      sessionMode === "immersive-ar"
        ? {
            status: hitTestSource
              ? "Aim at a floor or table and tap to place the carrier."
              : "Surface hit testing is unavailable; showing the carrier ahead of you.",
            scaleLabel: `1:${ar.scaleDenominator}`,
          }
        : { status: `${input.label} at physical scale · move within your safe boundary.` },
    );

    const render = (time: DOMHighResTimeStamp, frame: XRFrame) => {
      void time;
      if (ended || !renderer) return;
      const pose = frame.getViewerPose(referenceSpace);
      if (!pose) {
        frameId = session.requestAnimationFrame(render);
        return;
      }
      if (hitTestSource && !arPlacedMatrix) {
        const hit = frame.getHitTestResults(hitTestSource)[0];
        const hitPose = hit?.getPose(referenceSpace);
        arCandidateMatrix = hitPose ? multiplyMatrices(hitPose.transform.matrix, ar.modelMatrix) : null;
      }
      renderer.gl.bindFramebuffer(renderer.gl.FRAMEBUFFER, layer.framebuffer);
      const model =
        sessionMode === "immersive-vr"
          ? immersiveVrModelMatrix(input.audience, input.spec)
          : (arPlacedMatrix ?? arCandidateMatrix ?? arFallback);
      for (const view of pose.views) {
        const viewport = layer.getViewport(view);
        if (!viewport) continue;
        renderer.draw(
          view.projectionMatrix,
          view.transform.inverse.matrix,
          model,
          viewport,
          sessionMode === "immersive-ar",
        );
      }
      frameId = session.requestAnimationFrame(render);
    };
    frameId = session.requestAnimationFrame(render);

    session.addEventListener("end", () => session.removeEventListener("select", select), { once: true });

    return {
      finished,
      end: async () => {
        if (!ended) await session.end().catch(() => finish());
      },
      recenter: () => {
        if (sessionMode === "immersive-ar") arPlacedMatrix = null;
        input.onUpdate({
          status:
            sessionMode === "immersive-ar"
              ? "Placement cleared; aim and tap again."
              : "Use the headset recenter control.",
          scaleLabel: sessionMode === "immersive-ar" ? `1:${ar.scaleDenominator}` : undefined,
        });
      },
    };
  } catch (error) {
    hitTestSource?.cancel();
    renderer?.destroy();
    await session.end().catch(() => undefined);
    throw error;
  }
}

class GlSpatialRenderer {
  readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly vertexBuffer: WebGLBuffer;
  private readonly indexBuffer: WebGLBuffer;
  private readonly texture: WebGLTexture;
  private readonly vertexArray: WebGLVertexArrayObject;
  private readonly mvpLocation: WebGLUniformLocation;
  private readonly indexCount: number;
  private destroyed = false;

  private constructor(
    canvas: HTMLCanvasElement,
    media: ImageBitmap,
    spec: ImageSpatialSpec,
    audience: AudienceInSpace,
  ) {
    const gl = canvas.getContext("webgl2", {
      alpha: true,
      antialias: true,
      depth: true,
      xrCompatible: true,
      powerPreference: "high-performance",
    });
    if (!gl) throw new Error("WebGL 2 is required for immersive preview.");
    this.gl = gl;
    this.program = createProgram(gl, VERTEX_SHADER, FRAGMENT_SHADER);
    this.vertexBuffer = requiredResource(gl.createBuffer(), "vertex buffer");
    this.indexBuffer = requiredResource(gl.createBuffer(), "index buffer");
    this.texture = requiredResource(gl.createTexture(), "source texture");
    this.vertexArray = requiredResource(gl.createVertexArray(), "vertex array");
    this.mvpLocation = requiredResource(gl.getUniformLocation(this.program, "uMvp"), "MVP uniform");

    const mesh = buildImmersiveCarrierMesh(spec, audience);
    this.indexCount = mesh.indices.length;
    gl.bindVertexArray(this.vertexArray);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.vertices, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 12);

    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, media);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(
      gl.TEXTURE_2D,
      gl.TEXTURE_WRAP_S,
      spec.projectionMode === "cylinder-wall" ? gl.REPEAT : gl.CLAMP_TO_EDGE,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.useProgram(this.program);
    gl.uniform1i(gl.getUniformLocation(this.program, "uSource"), 0);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(null);
  }

  static async create(
    canvas: HTMLCanvasElement,
    mediaUrl: string,
    spec: ImageSpatialSpec,
    audience: AudienceInSpace,
    signal: AbortSignal,
  ): Promise<GlSpatialRenderer> {
    const response = await fetch(mediaUrl, { signal });
    if (!response.ok) throw new Error(`Could not load immersive media (HTTP ${response.status}).`);
    const bitmap = await createImageBitmap(await response.blob(), { imageOrientation: "from-image" });
    try {
      return new GlSpatialRenderer(canvas, bitmap, spec, audience);
    } finally {
      bitmap.close();
    }
  }

  async makeXrCompatible(): Promise<void> {
    await this.gl.makeXRCompatible();
  }

  draw(
    projection: ArrayLike<number>,
    view: ArrayLike<number>,
    model: ArrayLike<number>,
    viewport: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
    transparent = false,
  ): void {
    if (this.destroyed) return;
    const gl = this.gl;
    gl.viewport(viewport.x, viewport.y, viewport.width, viewport.height);
    gl.clearColor(0.006, 0.008, 0.01, transparent ? 0 : 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.uniformMatrix4fv(this.mvpLocation, false, multiplyMatrices(projection, multiplyMatrices(view, model)));
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.bindVertexArray(this.vertexArray);
    gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    const gl = this.gl;
    gl.deleteTexture(this.texture);
    gl.deleteBuffer(this.indexBuffer);
    gl.deleteBuffer(this.vertexBuffer);
    gl.deleteVertexArray(this.vertexArray);
    gl.deleteProgram(this.program);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
}

const VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec2 aUv;
uniform mat4 uMvp;
out vec2 vUv;
void main() {
  vUv = aUv;
  gl_Position = uMvp * vec4(aPosition, 1.0);
}`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
uniform sampler2D uSource;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec3 color = texture(uSource, vec2(vUv.x, 1.0 - vUv.y)).rgb;
  outColor = vec4(color, 1.0);
}`;

function createProgram(gl: WebGL2RenderingContext, vertexSource: string, fragmentSource: string): WebGLProgram {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = requiredResource(gl.createProgram(), "shader program");
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) || "unknown program link failure";
    gl.deleteProgram(program);
    throw new Error(`Immersive shader link failed: ${message}`);
  }
  return program;
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = requiredResource(gl.createShader(type), "shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || "unknown shader compilation failure";
    gl.deleteShader(shader);
    throw new Error(`Immersive shader compilation failed: ${message}`);
  }
  return shader;
}

function requiredResource<A>(resource: A | null, label: string): A {
  if (resource === null) throw new Error(`Could not create immersive ${label}.`);
  return resource;
}

async function requestOrientationPermission(): Promise<"granted" | "denied" | "unavailable"> {
  if (typeof window === "undefined" || !("DeviceOrientationEvent" in window)) return "unavailable";
  const constructor = window.DeviceOrientationEvent as DeviceOrientationConstructor;
  if (!constructor.requestPermission) return "granted";
  try {
    return await constructor.requestPermission();
  } catch {
    return "denied";
  }
}

function resizeCanvas(canvas: HTMLCanvasElement): void {
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
  const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
}

function shortestAngleDegrees(value: number): number {
  return ((value + 540) % 360) - 180;
}

function forwardFromEuler(yawDegrees: number, pitchDegrees: number): Vec3 {
  const yaw = (yawDegrees * Math.PI) / 180;
  const pitch = (pitchDegrees * Math.PI) / 180;
  const cosPitch = Math.cos(pitch);
  return normalize([Math.sin(yaw) * cosPitch, Math.sin(pitch), Math.cos(yaw) * cosPitch]);
}

function identityMatrix(): Float32Array {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

function translationMatrix(x: number, y: number, z: number): Float32Array {
  const matrix = identityMatrix();
  matrix[12] = x;
  matrix[13] = y;
  matrix[14] = z;
  return matrix;
}

export function multiplyMatrices(a: ArrayLike<number>, b: ArrayLike<number>): Float32Array {
  const output = new Float32Array(16);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let value = 0;
      for (let index = 0; index < 4; index += 1) value += a[index * 4 + row]! * b[column * 4 + index]!;
      output[column * 4 + row] = value;
    }
  }
  return output;
}

function perspectiveMatrix(fovDegrees: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1 / Math.tan((fovDegrees * Math.PI) / 360);
  const range = 1 / (near - far);
  return new Float32Array([
    f / Math.max(aspect, 0.000001),
    0,
    0,
    0,
    0,
    f,
    0,
    0,
    0,
    0,
    (far + near) * range,
    -1,
    0,
    0,
    2 * far * near * range,
    0,
  ]);
}

function lookAtMatrix(eye: Vec3, target: Vec3, up: Vec3): Float32Array {
  const backward = normalize([eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]]);
  const right = normalize(cross(up, backward));
  const correctedUp = cross(backward, right);
  return new Float32Array([
    right[0],
    correctedUp[0],
    backward[0],
    0,
    right[1],
    correctedUp[1],
    backward[1],
    0,
    right[2],
    correctedUp[2],
    backward[2],
    0,
    -dot(right, eye),
    -dot(correctedUp, eye),
    -dot(backward, eye),
    1,
  ]);
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
