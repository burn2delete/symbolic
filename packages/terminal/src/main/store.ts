import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { app } from "electron";
import Store from "electron-store";

import type { Diag, Prefs } from "../shared/api";

type Data = {
  dirs?: string[];
  prefs?: Prefs;
  secret?: string;
};

const store = new Store<Data>({ name: "terminal" });
const log = join(app.getPath("userData"), "logs", "main.log");

export const defaults: Prefs = {
  cwd_mode: "recent",
  font_size: 14,
  theme: "system",
};

export function dirs() {
  return store.get("dirs") ?? [];
}

export function pushDir(dir: string) {
  const list = [dir, ...dirs().filter((item: string) => item !== dir)].slice(
    0,
    12,
  );
  store.set("dirs", list);
  return list;
}

export function prefs() {
  return tidy(store.get("prefs") ?? defaults);
}

export function secret() {
  const cur = store.get("secret");
  if (cur) return cur;
  const next = crypto.randomUUID();
  store.set("secret", next);
  write("secret.create");
  return next;
}

export function setPrefs(input: Partial<Prefs>) {
  const next = tidy({ ...prefs(), ...input });
  store.set("prefs", next);
  write("prefs.set", next);
  return next;
}

export function defaultDir() {
  if (prefs().cwd_mode === "home") return app.getPath("home");
  return dirs()[0] ?? app.getPath("home");
}

export function write(tag: string, data?: unknown) {
  try {
    mkdirSync(dirname(log), { recursive: true });
    appendFileSync(
      log,
      `${new Date().toISOString()} ${tag}${body(data)}\n`,
      "utf8",
    );
  } catch {}
}

export function getDiag(): Diag {
  return {
    path: log,
    tail: existsSync(log) ? readFileSync(log, "utf8").slice(-16_000) : "",
  };
}

function tidy(input: Prefs) {
  return {
    cwd_mode: input.cwd_mode === "home" ? "home" : "recent",
    font_size: size(input.font_size),
    theme: theme(input.theme),
  } satisfies Prefs;
}

function size(input: number) {
  const n = Number.isFinite(input) ? Math.round(input) : defaults.font_size;
  return Math.min(32, Math.max(10, n));
}

function theme(input: Prefs["theme"]) {
  if (input === "light" || input === "dark") return input;
  return "system";
}

function body(data: unknown) {
  if (data === undefined) return "";
  try {
    return ` ${JSON.stringify(data)}`;
  } catch {
    return " [unserializable]";
  }
}
