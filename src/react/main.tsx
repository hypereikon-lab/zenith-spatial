import { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter";

import { resolveZenithAppRoute } from "./app-route.js";
import { RuntimeProvider } from "./runtime-context.js";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Zenith root element is missing.");
const route = resolveZenithAppRoute(window.location.pathname);
const RouteApp =
  route === "demo-vr"
    ? lazy(() => import("./demo-vr-app.js").then((module) => ({ default: module.DemoVrApp })))
    : lazy(() => import("./workbench-app.js").then((module) => ({ default: module.WorkbenchApp })));

createRoot(root).render(
  <RuntimeProvider>
    <Suspense fallback={<RouteLoading />}>
      <RouteApp />
    </Suspense>
  </RuntimeProvider>,
);

function RouteLoading() {
  return (
    <main className="boot-screen" aria-busy="true">
      <span className="boot-mark">Z</span>
      <p>Loading Zenith…</p>
    </main>
  );
}
