import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: { index: "src/main/index.ts" },
      },
    },
  },
  preload: {
    build: {
      rollupOptions: {
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
