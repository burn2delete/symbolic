import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import { themes as builtin } from "symbolic/tui-themes"

import type { Tui, TuiTone } from "../shared/api"

type Ref = string
type Val = `#${string}` | Ref | Pair
type Pair = {
  dark: Val
  light: Val
}
type Json = {
  defs?: Record<string, `#${string}` | Ref>
  theme: Record<Key, Val> & Record<string, unknown>
}

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
] as const satisfies Array<keyof TuiTone>

type Key = (typeof keys)[number]

const base: Record<string, Json> = builtin

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
  for (const file of look(name, cwd)) {
    const text = await readFile(file, "utf8").catch(() => null);
    if (!text) continue;
    const json = JSON.parse(text) as Json;
    return json;
  }
  return null;
}

function look(name: string, cwd: string | null) {
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
