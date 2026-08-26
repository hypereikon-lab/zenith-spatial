import { describe, expect, test } from "vitest";

import { DEMO_VR_PATH, resolveZenithAppRoute } from "./app-route.js";

describe("Zenith app routes", () => {
  test.each([DEMO_VR_PATH, `${DEMO_VR_PATH}/`, `${DEMO_VR_PATH}///`])(
    "opens the dedicated immersive demo at %s",
    (pathname) => {
      expect(resolveZenithAppRoute(pathname)).toBe("demo-vr");
    },
  );

  test.each(["/", "/review", "/demo", "/demo/vr/extra"])("keeps %s in the full workbench", (pathname) => {
    expect(resolveZenithAppRoute(pathname)).toBe("workbench");
  });
});
