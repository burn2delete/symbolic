import { app, BrowserWindow } from "electron";

import type { Create, Snapshot } from "../shared/api";
import { pickDir, send } from "./ipc";
import { createMenu } from "./menu";
import { Sessions } from "./pty";
import { defaultDir, dirs, prefs, write } from "./store";
import { read as readTui } from "./tui";
import { createWindow, paint } from "./windows";
import { apps } from "./main-apps";
import { allow, map, shared, wait } from "./main-state";
import { wire } from "./main-ipc";
import { wireDiag } from "./main-diag";
import { flush as drain, openDir, openPath, title, view } from "./main-path";

export function start() {
  hush();
  wireDiag();

  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }

  app.on("second-instance", () => show());
  app.on("before-quit", () => {
    map.forEach((item) => item.dispose());
    shared.dispose();
  });
  app.on("open-file", (event, file) => {
    event.preventDefault();
    if (!app.isReady()) {
      wait.push(file);
      return;
    }
    void openPath(file, show, focus, (dir, tab) =>
      openDir(dir, menu, openWindow, tab),
    );
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
  app.on("activate", () => {
    if (windows().length > 0) {
      show();
      return;
    }
    void openWindow();
  });

  void app.whenReady().then(() => {
    write("app.ready", {
      packaged: app.isPackaged,
      pid: process.pid,
      user_data: app.getPath("userData"),
    });
    wire({
      seed: async (win) => ({
        prefs: prefs(),
        frame: view(win),
        tui: await readTui(cur(win)),
      }),
      boot: async (win) => snap(win, (await session(win)?.boot()) ?? empty()),
      close,
      get: session,
      menu,
      open: openWindow,
      sync: syncTui,
      apps: async () => apps(),
    });
    void openWindow();
    void drain(wait, (file) =>
      openPath(file, show, focus, (dir, tab) =>
        openDir(dir, menu, openWindow, tab),
      ),
    );
  });
}

function hush() {
  const raw = console.error;
  console.error = (...args: unknown[]) => {
    if (args[0] === "Unhandled pty write error") {
      const err = args[1];
      write("pty.write.error", {
        err:
          err instanceof Error
            ? { msg: err.message, stack: err.stack }
            : typeof err === "object" && err !== null
              ? JSON.parse(JSON.stringify(err))
              : String(err),
      });
      return;
    }
    raw(...args);
  };
}

async function openWindow(input?: Create, host?: BrowserWindow | null) {
  const cfg = prefs();
  const win = createWindow(cfg, host);
  paint(win, cfg);
  const item = new Sessions(
    {
      send: (event) => send(win, event),
      dirs: () => menu(),
      host: () => shared.ensure(),
      title: (session) => win.setTitle(session ? title(session) : "Symbolic"),
    },
    input,
  );
  map.set(win.id, item);
  const sync = () => send(win, { type: "frame", frame: view(win) });
  win.on("focus", () => {
    menu();
    item.menu("window:refresh");
    void syncTui(win);
  });
  win.on("show", () => {
    item.menu("window:refresh");
    void syncTui(win);
  });
  win.on("enter-full-screen", sync);
  win.on("leave-full-screen", sync);
  win.on("close", (event) => {
    if (allow.delete(win.id)) return;
    if (!item.current()) return;
    event.preventDefault();
    item.menu("window:close-request");
  });
  win.on("closed", () => {
    map.get(win.id)?.dispose();
    map.delete(win.id);
    allow.delete(win.id);
    menu();
  });
  const session =
    item.session() ?? (await item.boot().then((data) => data.list[0]));
  if (!session) throw new Error("Missing session");
  win.setTitle(title(session));
  menu();
  return { win, session };
}

function close(win: BrowserWindow | null, id: string) {
  const item = session(win);
  if (!item || item.current() !== id) return Promise.resolve();
  if (win) allow.add(win.id);
  win?.close();
  return Promise.resolve();
}

function show() {
  const win = focus();
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function menu() {
  createMenu({
    create: (win) => {
      void openWindow(undefined, win);
    },
    close: (win) => {
      win?.close();
    },
    restart: (win) => {
      const item = session(win);
      const id = item?.current();
      if (!item || !id) return;
      void item.restart(id);
    },
    open: (win) => {
      void (async () => {
        const dir = await pickDir(win, defaultDir());
        if (!dir) return;
        await openDir(dir, menu, openWindow, win);
      })();
    },
    settings: (win) => {
      session(win)?.menu("settings");
    },
    recent: (dir) => {
      void openDir(dir, menu, openWindow, focus(), dirs().find((item) => item.cwd === dir)?.launch);
    },
    dirs: () =>
      [defaultDir(), ...dirs().map((item) => item.cwd)].filter(
        (dir, idx, list) => dir && list.indexOf(dir) === idx,
      ),
    trigger: (win, id) => {
      session(win)?.menu(id);
    },
  });
}

function session(win: BrowserWindow | null) {
  if (!win || win.isDestroyed()) return null;
  return map.get(win.id) ?? null;
}

function windows() {
  return BrowserWindow.getAllWindows().filter((win) => !win.isDestroyed());
}

function focus() {
  return (
    BrowserWindow.getFocusedWindow() ??
    windows().find((win) => win.isVisible()) ??
    windows()[0] ??
    null
  );
}

function empty() {
  return {
    list: [],
    active: null,
    dirs: dirs(),
    prefs: prefs(),
    host: null,
  };
}

async function snap(win: BrowserWindow | null, data: Snapshot): Promise<Snapshot> {
  return {
    ...data,
    frame: view(win),
    tui: await readTui(cur(win, data)),
  };
}

async function syncTui(win: BrowserWindow | null) {
  if (!win || win.isDestroyed()) return;
  send(win, {
    type: "tui",
    tui: await readTui(cur(win)),
  });
}

function cur(win: BrowserWindow | null, data?: Snapshot) {
  const cwd = session(win)?.cwd();
  if (cwd) return cwd;
  if (!data?.active) return defaultDir();
  return data.list.find((item) => item.id === data.active)?.cwd ?? defaultDir();
}
