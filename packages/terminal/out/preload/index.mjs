import { contextBridge, ipcRenderer } from "electron";
const api = {
  boot: () => ipcRenderer.invoke("terminal:boot"),
  create: (input) => ipcRenderer.invoke("terminal:create", input),
  close: (id) => ipcRenderer.invoke("terminal:close", id),
  restart: (id) => ipcRenderer.invoke("terminal:restart", id),
  focus: (id) => ipcRenderer.invoke("terminal:focus", id),
  next: () => ipcRenderer.invoke("terminal:next"),
  prev: () => ipcRenderer.invoke("terminal:prev"),
  input: async (input) => {
    ipcRenderer.send("terminal:input", input);
  },
  resize: async (input) => {
    ipcRenderer.send("terminal:resize", input);
  },
  pick_dir: (dir) => ipcRenderer.invoke("terminal:pick-dir", dir),
  get_prefs: () => ipcRenderer.invoke("terminal:get-prefs"),
  set_prefs: (input) => ipcRenderer.invoke("terminal:set-prefs", input),
  get_diag: () => ipcRenderer.invoke("terminal:get-diag"),
  on: (cb) => {
    const fn = (_, event) => cb(event);
    ipcRenderer.on("terminal:event", fn);
    return () => ipcRenderer.removeListener("terminal:event", fn);
  }
};
contextBridge.exposeInMainWorld("api", api);
