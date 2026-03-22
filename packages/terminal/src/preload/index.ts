import { contextBridge, ipcRenderer } from "electron";

import type { Api, Create, Custom, Event, Input, Prefs, Size } from "../shared/api";

const api: Api = {
  seed: () => ipcRenderer.invoke("terminal:seed"),
  boot: () => ipcRenderer.invoke("terminal:boot"),
  create: (input?: Create) => ipcRenderer.invoke("terminal:create", input),
  tab: (input?: Create) => ipcRenderer.invoke("terminal:tab", input),
  close: (id: string) => ipcRenderer.invoke("terminal:close", id),
  remove: (id: string) => ipcRenderer.invoke("terminal:remove", id),
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
  apps: () => ipcRenderer.invoke("terminal:apps"),
  get_customs: () => ipcRenderer.invoke("terminal:get-customs"),
  set_customs: (input: Custom[]) =>
    ipcRenderer.invoke("terminal:set-customs", input),
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
