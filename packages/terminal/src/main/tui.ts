import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import aura from "../../../symbolic/src/cli/cmd/tui/context/theme/aura.json" with { type: "json" };
import ayu from "../../../symbolic/src/cli/cmd/tui/context/theme/ayu.json" with { type: "json" };
import catppuccin from "../../../symbolic/src/cli/cmd/tui/context/theme/catppuccin.json" with { type: "json" };
import catppuccinFrappe from "../../../symbolic/src/cli/cmd/tui/context/theme/catppuccin-frappe.json" with { type: "json" };
import catppuccinMacchiato from "../../../symbolic/src/cli/cmd/tui/context/theme/catppuccin-macchiato.json" with { type: "json" };
import cobalt2 from "../../../symbolic/src/cli/cmd/tui/context/theme/cobalt2.json" with { type: "json" };
import cursor from "../../../symbolic/src/cli/cmd/tui/context/theme/cursor.json" with { type: "json" };
import dracula from "../../../symbolic/src/cli/cmd/tui/context/theme/dracula.json" with { type: "json" };
import everforest from "../../../symbolic/src/cli/cmd/tui/context/theme/everforest.json" with { type: "json" };
import flexoki from "../../../symbolic/src/cli/cmd/tui/context/theme/flexoki.json" with { type: "json" };
import github from "../../../symbolic/src/cli/cmd/tui/context/theme/github.json" with { type: "json" };
import gruvbox from "../../../symbolic/src/cli/cmd/tui/context/theme/gruvbox.json" with { type: "json" };
import kanagawa from "../../../symbolic/src/cli/cmd/tui/context/theme/kanagawa.json" with { type: "json" };
import material from "../../../symbolic/src/cli/cmd/tui/context/theme/material.json" with { type: "json" };
import matrix from "../../../symbolic/src/cli/cmd/tui/context/theme/matrix.json" with { type: "json" };
import mercury from "../../../symbolic/src/cli/cmd/tui/context/theme/mercury.json" with { type: "json" };
import monokai from "../../../symbolic/src/cli/cmd/tui/context/theme/monokai.json" with { type: "json" };
import nightowl from "../../../symbolic/src/cli/cmd/tui/context/theme/nightowl.json" with { type: "json" };
import nord from "../../../symbolic/src/cli/cmd/tui/context/theme/nord.json" with { type: "json" };
import onedark from "../../../symbolic/src/cli/cmd/tui/context/theme/one-dark.json" with { type: "json" };
import orng from "../../../symbolic/src/cli/cmd/tui/context/theme/orng.json" with { type: "json" };
import osakaJade from "../../../symbolic/src/cli/cmd/tui/context/theme/osaka-jade.json" with { type: "json" };
import palenight from "../../../symbolic/src/cli/cmd/tui/context/theme/palenight.json" with { type: "json" };
import rosepine from "../../../symbolic/src/cli/cmd/tui/context/theme/rosepine.json" with { type: "json" };
import solarized from "../../../symbolic/src/cli/cmd/tui/context/theme/solarized.json" with { type: "json" };
import symbolic from "../../../symbolic/src/cli/cmd/tui/context/theme/symbolic.json" with { type: "json" };
import synthwave84 from "../../../symbolic/src/cli/cmd/tui/context/theme/synthwave84.json" with { type: "json" };
import tokyonight from "../../../symbolic/src/cli/cmd/tui/context/theme/tokyonight.json" with { type: "json" };
import lucentOrng from "../../../symbolic/src/cli/cmd/tui/context/theme/lucent-orng.json" with { type: "json" };
import vercel from "../../../symbolic/src/cli/cmd/tui/context/theme/vercel.json" with { type: "json" };
import vesper from "../../../symbolic/src/cli/cmd/tui/context/theme/vesper.json" with { type: "json" };
import zenburn from "../../../symbolic/src/cli/cmd/tui/context/theme/zenburn.json" with { type: "json" };
import carbonfox from "../../../symbolic/src/cli/cmd/tui/context/theme/carbonfox.json" with { type: "json" };

import type { Tui, TuiTone } from "../shared/api";

type Ref = string;
type Val = `#${string}` | Ref | Pair;
type Pair = {
  dark: Val;
  light: Val;
};
type Json = {
  defs?: Record<string, `#${string}` | Ref>;
  theme: Record<Key, Val> & Record<string, unknown>;
};

const keys = [
  "primary",
  "secondary",
  "accent",
  "error",
  "warning",
  "success",
  "info",
  "text",
  "textMuted",
  "background",
  "backgroundPanel",
  "backgroundElement",
  "border",
  "borderActive",
  "borderSubtle",
] as const satisfies Array<keyof TuiTone>;

type Key = (typeof keys)[number];

const base: Record<string, Json> = {
  aura,
  ayu,
  catppuccin,
  ["catppuccin-frappe"]: catppuccinFrappe,
  ["catppuccin-macchiato"]: catppuccinMacchiato,
  cobalt2,
  cursor,
  dracula,
  everforest,
  flexoki,
  github,
  gruvbox,
  kanagawa,
  material,
  matrix,
  mercury,
  monokai,
  nightowl,
  nord,
  ["one-dark"]: onedark,
  ["osaka-jade"]: osakaJade,
  orng,
  ["lucent-orng"]: lucentOrng,
  palenight,
  rosepine,
  solarized,
  symbolic,
  synthwave84,
  tokyonight,
  vercel,
  vesper,
  zenburn,
  carbonfox,
} satisfies Record<string, Json>;

export async function read(cwd: string | null) {
  const name = await pick(cwd);
  if (!name || name === "system") return null;
  const json = (await custom(name, cwd)) ?? base[name];
  if (!json) return null;
  return {
    name,
    dark: solve(json, "dark"),
    light: solve(json, "light"),
  } satisfies Tui;
}

async function pick(cwd: string | null) {
  let name = await kv();
  for (const file of cfgs(cwd)) {
    const next = await pref(file);
    if (next) name = next;
  }
  return name ?? "symbolic";
}

async function kv() {
  const text = await readFile(path.join(state(), "kv.json"), "utf8").catch(() => null);
  if (!text) return null;
  const hit = text.match(/"theme"\s*:\s*"([^"]+)"/);
  return hit?.[1] ?? null;
}

function cfgs(cwd: string | null) {
  const seen = new Set<string>();
  const list = [
    ...files(cfg()),
    ...rise(cwd).flatMap((dir) => files(dir)),
    ...rise(cwd).flatMap((dir) => files(path.join(dir, ".symbolic"))),
  ];
  return list.filter((file) => {
    if (seen.has(file)) return false;
    seen.add(file);
    return true;
  });
}

async function pref(file: string) {
  const text = await readFile(file, "utf8").catch(() => null);
  if (!text) return null;
  const body = text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  return body.match(/"theme"\s*:\s*"([^"]+)"/)?.[1] ?? null;
}

async function custom(name: string, cwd: string | null) {
  for (const file of themes(name, cwd)) {
    const text = await readFile(file, "utf8").catch(() => null);
    if (!text) continue;
    const json = JSON.parse(text) as Json;
    return json;
  }
  return null;
}

function themes(name: string, cwd: string | null) {
  return [...fall(cwd).map((dir) => path.join(dir, ".symbolic", "themes", `${name}.json`)), path.join(cfg(), "themes", `${name}.json`)];
}

function solve(json: Json, mode: "dark" | "light") {
  const defs = json.defs ?? {};
  const map = (val: Val): string => {
    if (typeof val === "string") {
      if (val === "transparent" || val === "none") return "#000000";
      if (val.startsWith("#")) return val;
      const hit = defs[val] ?? (json.theme[val as Key] as Val | undefined);
      return hit ? map(hit) : "#000000";
    }
    return map(val[mode]);
  };

  return Object.fromEntries(keys.map((key) => [key, map(json.theme[key])])) as TuiTone;
}

function files(dir: string) {
  return [path.join(dir, "tui.jsonc"), path.join(dir, "tui.json")];
}

function rise(cwd: string | null) {
  if (!cwd) return [];
  const dir = path.resolve(cwd);
  const list: string[] = [];
  let cur = dir;
  while (true) {
    list.unshift(cur);
    const next = path.dirname(cur);
    if (next === cur) break;
    cur = next;
  }
  return list;
}

function fall(cwd: string | null) {
  return rise(cwd).toReversed();
}

function cfg() {
  return path.join(process.env.XDG_CONFIG_HOME || path.join(homedir(), ".config"), "symbolic");
}

function state() {
  return path.join(process.env.XDG_STATE_HOME || path.join(homedir(), ".local", "state"), "symbolic");
}
