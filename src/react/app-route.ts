export const DEMO_VR_PATH = "/demo/vr";
export const DEMO_VR_HREF = "/?demo=vr";

export type ZenithAppRoute = "workbench" | "demo-vr";

export function resolveZenithAppRoute(pathname: string, search = ""): ZenithAppRoute {
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  const directDemoQuery = normalized === "/" && new URLSearchParams(search).get("demo") === "vr";
  return normalized === DEMO_VR_PATH || directDemoQuery ? "demo-vr" : "workbench";
}
