import { describe, expect, test } from "vitest";
import { DOME_SCENE_EDITOR_MODES } from "./dome-scene-editor.js";

describe("dome scene editor modes", () => {
  test("exposes only the proven still-image workflow", () => {
    expect(DOME_SCENE_EDITOR_MODES.map(({ id, shortLabel }) => ({ id, shortLabel }))).toEqual([
      { id: "compose", shortLabel: "Compose" },
      { id: "inpaint", shortLabel: "Inpaint" },
      { id: "project", shortLabel: "Project" },
    ]);
  });
});
