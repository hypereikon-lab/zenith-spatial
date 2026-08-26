export const DEMO_VR_PATH = "/demo/vr";

export type ZenithAppRoute = "workbench" | "demo-vr";

export function resolveZenithAppRoute(pathname: string): ZenithAppRoute {
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return normalized === DEMO_VR_PATH ? "demo-vr" : "workbench";
}
