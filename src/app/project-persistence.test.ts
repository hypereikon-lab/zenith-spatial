import { describe, expect, test } from "vitest";
import { createDefaultDomeScene } from "../scene/dome-scene.js";
import { serializableDomeScene } from "./project-persistence.js";

describe("project persistence", () => {
  test("serializes reactive Dome Scene proxies without structuredClone failures", async () => {
    const scene = createDefaultDomeScene();
    const reactiveScene = new Proxy(
      {
        ...scene,
        surface: new Proxy(scene.surface, {}),
        raster: new Proxy(scene.raster, {}),
        frame0: new Proxy(scene.frame0, {}),
      },
      {},
    );

    expect(() => structuredClone(reactiveScene)).toThrow();
    await expect(serializableDomeScene(reactiveScene)).resolves.toEqual(scene);
  });
});
