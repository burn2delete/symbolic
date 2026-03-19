import { contextBridge, ipcRenderer } from "electron";

import type { Api, Create, Event, Input, Prefs, Size } from "../shared/api";

const api: Api = {
  boot: () => ipcRenderer.invoke("terminal:boot"),
  create: (input?: Create) => ipcRenderer.invoke("terminal:create", input),
  close: (id: string) => ipcRenderer.invoke("terminal:close", id),
  restart: (id: string) => ipcRenderer.invoke("terminal:restart", id),
  focus: (id: string) => ipcRenderer.invoke("terminal:focus", id),
  next: () => ipcRenderer.invoke("terminal:next"),
  prev: () => ipcRenderer.invoke("terminal:prev"),
  input: async (input: Input) => {
    ipcRenderer.send("terminal:input", input);
  },
  resize: async (input: Size) => {
    ipcRenderer.send("terminal:resize", input);
  },
  pick_dir: (dir?: string | null) =>
    ipcRenderer.invoke("terminal:pick-dir", dir),
  get_prefs: () => ipcRenderer.invoke("terminal:get-prefs"),
  set_prefs: (input: Partial<Prefs>) =>
    ipcRenderer.invoke("terminal:set-prefs", input),
  get_diag: () => ipcRenderer.invoke("terminal:get-diag"),
  on: (cb) => {
    const fn = (_: unknown, event: Event) => cb(event);
    ipcRenderer.on("terminal:event", fn);
    return () => ipcRenderer.removeListener("terminal:event", fn);
  },
};

contextBridge.exposeInMainWorld("api", api);
