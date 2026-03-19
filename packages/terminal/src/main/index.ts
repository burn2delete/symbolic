import { existsSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { app, BrowserWindow } from "electron";

import type { Create } from "../shared/api";
import { Host } from "./host";
import { pickDir, registerIpcHandlers, send } from "./ipc";
import { createMenu } from "./menu";
import { Sessions } from "./pty";
import {
  defaultDir,
  dirs,
  getDiag,
  prefs,
  pushDir,
  setPrefs,
  write,
} from "./store";
import { createWindow } from "./windows";

const wait: string[] = [];
const map = new Map<number, Sessions>();
const allow = new Set<number>();
const shared = new Host();

setup();

function setup() {
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
    void openPath(file);
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
    void openWindow();
    wire();
    void flush();
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

function wire() {
  registerIpcHandlers({
    boot: async (win) => session(win)?.boot() ?? empty(),
    create: async (win, input) => {
      return openWindow(input, win).then((item) => item.session);
    },
    close: async (win, id) => close(win, id),
    restart: async (win, id) => {
      const item = session(win);
      if (!item) throw new Error("Missing session");
      return item.restart(id);
    },
    focus: async (win, id) => {
      await session(win)?.focus(id);
    },
    next: async () => {},
    prev: async () => {},
    input: async (win, input) => {
      const item = session(win);
      if (!item || item.current() !== input.id) return;
      await item.input(input.id, input.data);
    },
    resize: async (win, input) => {
      const item = session(win);
      if (!item || item.current() !== input.id) return;
      await item.resize(input.id, input.cols, input.rows);
    },
    pickDir: async (win, dir) => {
      const next = await pickDir(win, dir ?? defaultDir());
      if (next) {
        pushDir(next);
        menu();
      }
      return next;
    },
    getPrefs: async () => prefs(),
    setPrefs: async (input) => setPrefs(input),
    getDiag: async () => getDiag(),
  });

  menu();
}

async function openWindow(input?: Create, host?: BrowserWindow | null) {
  const win = createWindow(host);
  const item = new Sessions(
    {
      send: (event) => send(win, event),
      dirs: () => menu(),
      host: () => shared.ensure(),
    },
    input,
  );
  map.set(win.id, item);
  win.on("focus", () => {
    menu();
    item.menu("window:refresh");
  });
  win.on("show", () => {
    item.menu("window:refresh");
  });
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
        await openDir(dir, win);
      })();
    },
    settings: (win) => {
      session(win)?.menu("settings");
    },
    recent: (dir) => {
      void openDir(dir, focus());
    },
    dirs: () =>
      [defaultDir(), ...dirs()].filter(
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

async function flush() {
  for (const file of wait.splice(0)) await openPath(file);
}

async function openPath(file: string) {
  show();
  const dir = pathDir(file);
  if (!dir) return;
  await openDir(dir, focus());
}

async function openDir(dir: string, tab?: BrowserWindow | null) {
  pushDir(dir);
  menu();
  await openWindow({ cwd: dir }, tab);
}

function pathDir(file: string) {
  if (!existsSync(file)) return null;
  const stat = statSync(file);
  return stat.isDirectory() ? file : dirname(file);
}

function title(session: { cwd: string; title: string }) {
  if (!/^Session \d+$/.test(session.title)) return session.title;
  const parts = session.cwd.split("/").filter(Boolean);
  return parts.at(-1) || session.cwd || "Symbolic";
}

function wireDiag() {
  process.on("uncaughtException", (err) => {
    write("process.uncaught", {
      msg: err.message,
      stack: err.stack,
    });
  });
  process.on("unhandledRejection", (err) => {
    write("process.rejection", {
      err:
        err instanceof Error
          ? { msg: err.message, stack: err.stack }
          : String(err),
    });
  });
  app.on("render-process-gone", (_event, web, info) => {
    write("render.gone", {
      reason: info.reason,
      exit_code: info.exitCode,
      url: web.getURL(),
    });
  });
  app.on("child-process-gone", (_event, info) => {
    write("child.gone", {
      type: info.type,
      reason: info.reason,
      name: info.name,
      service: info.serviceName,
      exit_code: info.exitCode,
    });
  });
}
