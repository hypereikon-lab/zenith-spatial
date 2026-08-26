import { describe, expect, test } from "vitest";

import { DEMO_VR_HREF, DEMO_VR_PATH, resolveZenithAppRoute } from "./app-route.js";

describe("Zenith app routes", () => {
  test.each([DEMO_VR_PATH, `${DEMO_VR_PATH}/`, `${DEMO_VR_PATH}///`])(
    "opens the dedicated immersive demo at %s",
    (pathname) => {
      expect(resolveZenithAppRoute(pathname)).toBe("demo-vr");
    },
  );

  test("opens the hosted direct link from the root query", () => {
    const url = new URL(DEMO_VR_HREF, "https://zenith.example");
    expect(resolveZenithAppRoute(url.pathname, url.search)).toBe("demo-vr");
  });

  test.each([
    ["/", ""],
    ["/", "?demo=other"],
    ["/review", "?demo=vr"],
    ["/demo", ""],
    ["/demo/vr/extra", ""],
  ])("keeps %s%s in the full workbench", (pathname, search) => {
    expect(resolveZenithAppRoute(pathname, search)).toBe("workbench");
  });
});
