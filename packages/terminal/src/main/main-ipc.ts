import { BrowserWindow } from "electron";

import type { Choice, Create, Seed, Session, Snapshot } from "../shared/api";
import { paint } from "./windows";
import { pickDir, registerIpcHandlers, send } from "./ipc";
import { defaultDir, getDiag, prefs, pushDir, setCustoms, setPrefs, customs } from "./store";
import type { Sessions } from "./pty";

type Deps = {
  seed: (win: BrowserWindow | null) => Promise<Seed>;
  boot: (win: BrowserWindow | null) => Promise<Snapshot>;
  close: (win: BrowserWindow | null, id: string) => Promise<void>;
  get: (win: BrowserWindow | null) => Sessions | null;
  menu: () => void;
  open: (input?: Create, host?: BrowserWindow | null) => Promise<{
    session: Session;
  }>;
  sync: (win: BrowserWindow | null) => Promise<void>;
  apps: () => Promise<Choice[]>;
};

export function wire(deps: Deps) {
  registerIpcHandlers({
    seed: async (win) => deps.seed(win),
    boot: async (win) => deps.boot(win),
    create: async (win, input) => deps.open(input, win).then((item) => item.session),
    tab: async (win, input) => {
      const item = deps.get(win);
      if (!item) throw new Error("Missing session");
      const next = await item.create(input);
      void deps.sync(win);
      return next;
    },
    close: async (win, id) => deps.close(win, id),
    remove: async (win, id) => {
      await deps.get(win)?.remove(id);
      void deps.sync(win);
    },
    restart: async (win, id) => {
      const item = deps.get(win);
      if (!item) throw new Error("Missing session");
      const next = await item.restart(id);
      void deps.sync(win);
      return next;
    },
    focus: async (win, id) => {
      await deps.get(win)?.focus(id);
      void deps.sync(win);
    },
    next: async (win) => {
      await deps.get(win)?.nextTab();
      void deps.sync(win);
    },
    prev: async (win) => {
      await deps.get(win)?.prevTab();
      void deps.sync(win);
    },
    input: async (win, input) => {
      const item = deps.get(win);
      if (!item || item.current() !== input.id) return;
      await item.input(input.id, input.data);
    },
    resize: async (win, input) => {
      const item = deps.get(win);
      if (!item || item.current() !== input.id) return;
      await item.resize(input.id, input.cols, input.rows);
    },
    pickDir: async (win, dir) => {
      const next = await pickDir(win, dir ?? defaultDir());
      if (next) {
        pushDir(next);
        deps.menu();
      }
      return next;
    },
    apps: async () => deps.apps(),
    getCustoms: async () => customs(),
    setCustoms: async (input) => setCustoms(input),
    getPrefs: async () => prefs(),
    setPrefs: async (input) => {
      const next = setPrefs(input);
      BrowserWindow.getAllWindows()
        .filter((win) => !win.isDestroyed())
        .forEach((win) => {
          paint(win, next);
          send(win, { type: "prefs", prefs: next });
          void deps.sync(win);
        });
      return next;
    },
    getDiag: async () => getDiag(),
  });

  deps.menu();
}
