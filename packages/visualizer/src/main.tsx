import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { SSEProvider } from "./context/SSEContext.js";
import { ProjectProvider } from "./context/ProjectContext.js";
import { App } from "./App.js";
import "./styles/index.css";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Root element #root not found");

createRoot(rootEl).render(
  <StrictMode>
    <SSEProvider>
      <ProjectProvider>
        <App />
      </ProjectProvider>
    </SSEProvider>
  </StrictMode>
);
