import windowState from "electron-window-state";
import { BrowserWindow } from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));

export function createWindow(host?: BrowserWindow | null) {
  const state = windowState({
    defaultWidth: 1280,
    defaultHeight: 800,
  });
  return make(state, host);
}

function make(
  state: ReturnType<typeof windowState>,
  input: BrowserWindow | null | undefined,
) {
  const host = input && !input.isDestroyed() ? input : null;
  const box = host ? host.getBounds() : state;

  const win = new BrowserWindow({
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: "Symbolic",
    backgroundColor: "#0f1114",
    ...(process.platform === "darwin"
      ? {
          titleBarStyle: "hiddenInset" as const,
        }
      : {}),
    webPreferences: {
      preload: join(root, "../preload/index.mjs"),
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

function load(win: BrowserWindow) {
  const url = process.env.ELECTRON_RENDERER_URL;
  if (url) {
    void win.loadURL(new URL("index.html", url).toString());
    return;
  }

  void win.loadFile(join(root, "../renderer/index.html"));
}
