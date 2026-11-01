import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@/styles/index.css";
import App from "./App";
import { boot } from "@/lib/boot";
import { ipc } from "@/lib/ipc";
import { applySettingsToDom, useSettings } from "@/store/settings";

async function start() {
  // Hydrate every store first so the first paint already reflects saved state; the inline splash covers this.
  await boot();
  applySettingsToDom(useSettings.getState().values);

  const root = document.getElementById("root");
  if (!root) throw new Error("#root missing");
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );

  // Two frames so the app has painted under the splash before we fade it out.
  await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
  const splash = document.getElementById("splash");
  splash?.classList.add("hide");
  setTimeout(() => splash?.remove(), 200);
  // Window is created hidden; show it once content is ready (no white flash).
  await ipc.appReady().catch(() => {});
}

void start();
