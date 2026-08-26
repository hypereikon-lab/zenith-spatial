import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter";

import { RuntimeProvider } from "./runtime-context.js";
import { WorkbenchApp } from "./workbench-app.js";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Zenith root element is missing.");

createRoot(root).render(
  <RuntimeProvider>
    <WorkbenchApp />
  </RuntimeProvider>,
);
