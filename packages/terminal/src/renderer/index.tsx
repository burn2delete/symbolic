import "./index.css";

import { createRoot } from "react-dom/client";

import { TooltipProvider } from "@/components/ui/tooltip";

import { App } from "./app";

const root = document.getElementById("root");

if (!root) throw new Error("Root element not found");

createRoot(root).render(
  <TooltipProvider delay={0}>
    <App />
  </TooltipProvider>,
);
