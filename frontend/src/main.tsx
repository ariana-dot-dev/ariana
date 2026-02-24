import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { initializePostHog } from "./lib/posthog";

// Initialize PostHog before React app
initializePostHog();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
