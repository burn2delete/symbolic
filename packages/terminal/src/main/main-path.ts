import { existsSync, statSync } from "node:fs";
import { dirname } from "node:path";
import type { BrowserWindow } from "electron";
import type { Create, Frame } from "../shared/api";

import { pushDir } from "./store";

export type Open = (
  input?: Create,
  host?: BrowserWindow | null,
) => Promise<{ session: { id: string } }>;

export async function flush(wait: string[], open: (file: string) => Promise<void>) {
  for (const file of wait.splice(0)) await open(file);
}

export async function openPath(
  file: string,
  show: () => void,
  focus: () => BrowserWindow | null,
  open: (dir: string, tab?: BrowserWindow | null) => Promise<void>,
) {
  show();
  const dir = pathDir(file);
  if (!dir) return;
  await open(dir, focus());
}

export async function openDir(
  dir: string,
  menu: () => void,
  open: Open,
  tab?: BrowserWindow | null,
  launch?: Create["launch"],
) {
  pushDir(dir, launch);
  menu();
  await open({ cwd: dir, launch }, tab);
}

export function pathDir(file: string) {
  if (!existsSync(file)) return null;
  const stat = statSync(file);
  return stat.isDirectory() ? file : dirname(file);
}

export function title(session: { cwd: string; title: string }) {
  if (!/^Session \d+$/.test(session.title)) return session.title;
  const parts = session.cwd.split("/").filter(Boolean);
  return parts.at(-1) || session.cwd || "Symbolic";
}

export function view(win: BrowserWindow | null): Frame {
  const box = win as
    | (BrowserWindow & {
        getWindowButtonVisibility?: () => boolean;
      })
    | null;
  return {
    full: !!win?.isFullScreen(),
    lights:
      process.platform === "darwin"
        ? (box?.getWindowButtonVisibility?.() ?? true)
        : false,
  };
}
