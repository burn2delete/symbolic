import windowState from "electron-window-state";
import { BrowserWindow } from "electron";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Prefs } from "../shared/api";

const root = dirname(fileURLToPath(import.meta.url));

export function createWindow(prefs: Prefs, host?: BrowserWindow | null) {
  const state = windowState({
    defaultWidth: 1280,
    defaultHeight: 800,
  });
  return make(state, prefs, host);
}

function make(
  state: ReturnType<typeof windowState>,
  prefs: Prefs,
  input: BrowserWindow | null | undefined,
) {
  const host = input && !input.isDestroyed() ? input : null;
  const box = host ? host.getBounds() : state;
  const glass = process.platform === "darwin" && prefs.skin === "glass";

  const win = new BrowserWindow({
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: "Symbolic",
    ...(process.platform === "darwin"
      ? {
          backgroundColor: "#00000000",
          transparent: true,
          titleBarStyle: "hiddenInset" as const,
          vibrancy: glass ? "under-window" : undefined,
          visualEffectState: glass ? "active" : undefined,
        }
      : { backgroundColor: "#0f1114" }),
    webPreferences: {
      preload: preload(),
      contextIsolation: true,
      sandbox: false,
    },
  });

  state.manage(win);
  win.once("ready-to-show", () => win.show());
  load(win);
  win.webContents.setZoomFactor(1);
  win.webContents.on("zoom-changed", () => win.webContents.setZoomFactor(1));
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  return win;
}

export function paint(win: BrowserWindow, prefs: Prefs) {
  if (process.platform !== "darwin") return;
  win.setBackgroundColor("#00000000");
  win.setVibrancy(prefs.skin === "glass" ? "under-window" : null);
}

function load(win: BrowserWindow) {
  const url = process.env.ELECTRON_RENDERER_URL;
  if (url) {
    void win.loadURL(new URL("index.html", url).toString());
    return;
  }

  void win.loadFile(join(root, "../renderer/index.html"));
}

function preload() {
  const list = ["index.js", "index.mjs"].map((file) =>
    join(root, "../preload", file),
  );
  const hit = list.find((file) => existsSync(file));
  if (hit) return hit;
  return list[0];
}
