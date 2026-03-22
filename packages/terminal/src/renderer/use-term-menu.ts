import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";

import { unpack } from "./term-util";

const winIds = ["new-window", "new_window", "window:new", "session:new-window"];
const tabIds = ["new-tab", "new_tab", "tab:new", "session:new"];
const openIds = ["open-folder", "open_folder", "file:open-folder", "session:open-folder"];
const prefIds = ["settings", "prefs", "preferences", "window:settings", "app:settings"];
const diagIds = ["diagnostics", "diag", "help:diagnostics"];
const killIds = ["close-tab", "close_tab", "tab:close"];
const quitIds = ["close-window", "close_window", "window:close", "window:close-request"];
const bootIds = ["restart", "restart-window", "restart_window", "session:restart", "restart-tab", "restart_tab"];
const syncIds = ["window:refresh", "refresh", "tab:refresh"];
const copyIds = ["copy", "edit:copy"];
const pasteIds = ["paste", "edit:paste"];
const allIds = ["select_all", "select-all", "edit:select-all"];
const has = (id: string, list: string[]) => list.includes(id);

type Cfg = {
  active: MutableRefObject<string | null>;
  panel: Dispatch<SetStateAction<"prefs" | "diag" | null>>;
};

type Fns = {
  create: () => unknown;
  add: () => unknown;
  open: () => unknown;
  diag: () => unknown;
  choose: (dir: string) => unknown;
  remove: (id: string) => unknown;
  close: () => unknown;
  restart: () => unknown;
  refresh: () => unknown;
  copy: () => unknown;
  paste: () => unknown;
  select: () => unknown;
};

export function useTermMenu(cfg: Cfg, fn: Fns) {
  return useCallback((id: string) => {
    if (has(id, winIds)) return void fn.create();
    if (has(id, tabIds)) return void fn.add();
    if (has(id, openIds)) return void fn.open();
    if (has(id, prefIds)) return void cfg.panel("prefs");
    if (has(id, diagIds)) {
      cfg.panel("diag");
      return void fn.diag();
    }
    if (has(id, killIds)) return void fn.remove(cfg.active.current ?? "");
    if (has(id, quitIds)) return void fn.close();
    if (id.startsWith("recent:")) return void fn.choose(unpack(id.slice(7)));
    if (id.startsWith("open-recent:")) return void fn.choose(unpack(id.slice(12)));
    if (has(id, bootIds)) return void fn.restart();
    if (has(id, syncIds)) return void fn.refresh();
    if (has(id, copyIds)) return void fn.copy();
    if (has(id, pasteIds)) return void fn.paste();
    if (has(id, allIds)) return void fn.select();
  }, [
    cfg.active,
    cfg.panel,
    fn.add,
    fn.choose,
    fn.close,
    fn.copy,
    fn.create,
    fn.diag,
    fn.open,
    fn.paste,
    fn.refresh,
    fn.remove,
    fn.restart,
    fn.select,
  ]);
}
