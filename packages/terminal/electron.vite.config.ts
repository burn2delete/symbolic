import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        "symbolic/tui-themes": fileURLToPath(new URL("../symbolic/src/tui-themes.ts", import.meta.url)),
      },
    },
    build: {
      rollupOptions: {
        external: ["electron", "node-pty"],
        input: { index: "src/main/index.ts" },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        external: ["electron"],
        input: { index: "src/preload/index.ts" },
      },
    },
  },
  renderer: {
    plugins: [tailwindcss(), react()],
    root: "src/renderer",
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src/renderer", import.meta.url)),
      },
    },
    build: {
      rollupOptions: {
        input: {
          main: "src/renderer/index.html",
        },
      },
    },
  },
});
