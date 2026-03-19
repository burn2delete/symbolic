import {
  BrowserWindow,
  dialog,
  ipcMain,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from "electron";

import type { Create, Diag, Input, Prefs, Size, Snapshot } from "../shared/api";

type Deps = {
  boot: (win: BrowserWindow | null) => Promise<Snapshot>;
  create: (win: BrowserWindow | null, input?: Create) => Promise<unknown>;
  close: (win: BrowserWindow | null, id: string) => Promise<void>;
  restart: (win: BrowserWindow | null, id: string) => Promise<unknown>;
  focus: (win: BrowserWindow | null, id: string) => Promise<void>;
  next: (win: BrowserWindow | null) => Promise<void>;
  prev: (win: BrowserWindow | null) => Promise<void>;
  input: (win: BrowserWindow | null, input: Input) => Promise<void>;
  resize: (win: BrowserWindow | null, input: Size) => Promise<void>;
  pickDir: (
    win: BrowserWindow | null,
    dir?: string | null,
  ) => Promise<string | null>;
  getPrefs: () => Promise<Prefs>;
  setPrefs: (input: Partial<Prefs>) => Promise<Prefs>;
  getDiag: () => Promise<Diag>;
};

export function registerIpcHandlers(deps: Deps) {
  ipcMain.handle("terminal:boot", (event: IpcMainInvokeEvent) =>
    deps.boot(win(event)),
  );
  ipcMain.handle(
    "terminal:create",
    (event: IpcMainInvokeEvent, input?: Create) =>
      deps.create(win(event), input),
  );
  ipcMain.handle("terminal:close", (event: IpcMainInvokeEvent, id: string) =>
    deps.close(win(event), id),
  );
  ipcMain.handle("terminal:restart", (event: IpcMainInvokeEvent, id: string) =>
    deps.restart(win(event), id),
  );
  ipcMain.handle("terminal:focus", (event: IpcMainInvokeEvent, id: string) =>
    deps.focus(win(event), id),
  );
  ipcMain.handle("terminal:next", (event: IpcMainInvokeEvent) =>
    deps.next(win(event)),
  );
  ipcMain.handle("terminal:prev", (event: IpcMainInvokeEvent) =>
    deps.prev(win(event)),
  );
  ipcMain.on("terminal:input", (event: IpcMainEvent, input: Input) => {
    void deps.input(win(event), input);
  });
  ipcMain.on("terminal:resize", (event: IpcMainEvent, input: Size) => {
    void deps.resize(win(event), input);
  });
  ipcMain.handle(
    "terminal:pick-dir",
    (event: IpcMainInvokeEvent, dir?: string | null) =>
      deps.pickDir(win(event), dir),
  );
  ipcMain.handle("terminal:get-prefs", () => deps.getPrefs());
  ipcMain.handle(
    "terminal:set-prefs",
    (_event: IpcMainInvokeEvent, input: Partial<Prefs>) => deps.setPrefs(input),
  );
  ipcMain.handle("terminal:get-diag", () => deps.getDiag());
}

function win(event: IpcMainInvokeEvent | IpcMainEvent) {
  return BrowserWindow.fromWebContents(event.sender);
}

export function send(win: BrowserWindow, event: unknown) {
  if (win.isDestroyed()) return;
  win.webContents.send("terminal:event", event);
}

export async function pickDir(win: BrowserWindow | null, dir?: string | null) {
  const res = await (win
    ? dialog.showOpenDialog(win, {
        properties: ["openDirectory", "createDirectory"],
        title: "Choose a folder",
        defaultPath: dir ?? undefined,
      })
    : dialog.showOpenDialog({
        properties: ["openDirectory", "createDirectory"],
        title: "Choose a folder",
        defaultPath: dir ?? undefined,
      }));
  if (res.canceled) return null;
  return res.filePaths[0] ?? null;
}
