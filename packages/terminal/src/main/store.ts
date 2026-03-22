import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { app } from "electron";
import Store from "electron-store";

import type { Custom, Diag, Launch, Prefs, Recent } from "../shared/api";
import { symbolic } from "../shared/launch";

type Data = {
  dirs?: unknown[];
  prefs?: Prefs;
  customs?: Custom[];
  secret?: string;
};

const store = new Store<Data>({ name: "terminal" });
const log = join(app.getPath("userData"), "logs", "main.log");

export const defaults: Prefs = {
  cwd_mode: "recent",
  font_size: 14,
  theme: "system",
  skin: "warm",
  color: "local",
  status_closed: true,
  status_open: "sidebar",
};

type Legacy = Partial<Prefs> & {
  light_skin?: Prefs["skin"];
  dark_skin?: Prefs["skin"];
};

export function dirs() {
  return cleanDirs(store.get("dirs") ?? []);
}

export function pushDir(cwd: string, launch: Launch = symbolic) {
  const list = [
    { cwd, launch },
    ...dirs().filter((item) => item.cwd !== cwd),
  ].slice(
    0,
    12,
  );
  store.set("dirs", list);
  return list;
}

export function prefs() {
  return tidy(store.get("prefs") ?? defaults);
}

export function customs() {
  return cleanCustoms(store.get("customs") ?? []);
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

export function setCustoms(input: Custom[]) {
  const next = cleanCustoms(input);
  store.set("customs", next);
  write("customs.set", next);
  return next;
}

export function defaultDir() {
  if (prefs().cwd_mode === "home") return app.getPath("home");
  return dirs()[0]?.cwd ?? app.getPath("home");
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

function tidy(input: Legacy) {
  return {
    cwd_mode: input.cwd_mode === "home" ? "home" : "recent",
    font_size: size(input.font_size),
    theme: theme(input.theme),
    skin: skin(input.skin ?? old(input)),
    color: color(input.color),
    status_closed: input.status_closed !== false,
    status_open: status(input.status_open),
  } satisfies Prefs;
}

function size(input?: number) {
  const n =
    typeof input === "number" && Number.isFinite(input)
      ? Math.round(input)
      : defaults.font_size;
  return Math.min(32, Math.max(10, n));
}

function theme(input?: Prefs["theme"]) {
  if (input === "light" || input === "dark") return input;
  return "system";
}

function skin(input?: Prefs["skin"]) {
  if (input === "glass") return input;
  return "warm";
}

function color(input?: Prefs["color"]) {
  if (input === "symbolic") return input;
  return "local";
}

function status(input?: Prefs["status_open"]) {
  if (input === "bottom") return input;
  return "sidebar";
}

function old(input: Legacy) {
  if (input.light_skin === "glass" || input.dark_skin === "glass")
    return "glass";
  return "warm";
}

function cleanCustoms(input: Custom[]) {
  return input.flatMap((item) => {
    const name = text(item.name);
    const cmd = text(item.cmd);
    if (!name || !cmd) return [];
    return [
      {
        id: text(item.id) ?? crypto.randomUUID(),
        name,
        cmd,
      } satisfies Custom,
    ];
  });
}

function cleanDirs(input: unknown[]) {
  return input.flatMap((item) => {
    if (typeof item === "string") return [{ cwd: item, launch: symbolic }];
    if (!item || typeof item !== "object") return [];
    const cwd = text((item as { cwd?: unknown }).cwd);
    if (!cwd) return [];
    return [
      {
        cwd,
        launch: cleanLaunch((item as { launch?: unknown }).launch),
      } satisfies Recent,
    ];
  });
}

function cleanLaunch(input: unknown): Launch {
  if (!input || typeof input !== "object") return symbolic;
  const id = text((input as { id?: unknown }).id);
  const name = text((input as { name?: unknown }).name);
  if (!id || !name) return symbolic;
  return {
    id,
    name,
    cmd: text((input as { cmd?: unknown }).cmd) ?? null,
  };
}

function text(input: unknown) {
  if (typeof input !== "string") return null;
  const item = input.trim();
  return item ? item : null;
}

function body(data: unknown) {
  if (data === undefined) return "";
  try {
    return ` ${JSON.stringify(data)}`;
  } catch {
    return " [unserializable]";
  }
}
