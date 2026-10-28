import "./hljs-setup";
import "highlight.js/styles/github-dark.css";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
// The generated design tokens carry the spacing and type scale (--space-gutter,
// --space-control, --font-meta-size, …) that global.css never defined. Without
// this import every one of those `var()`s resolves to nothing, and the Plan's
// panes lose their padding and gutter.
import "./styles/tokens.generated.css";
import "./global.css";
import { initErrorTracking } from "./errorTracking";

void initErrorTracking();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Register service worker for PWA (skip in Electron — custom protocol conflicts with SW)
if ("serviceWorker" in navigator && !import.meta.env.VITE_ELECTRON) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).catch(e => console.error(e));
  });
}