import type { Prefs, Skin } from "../shared/api";

import { fresh } from "./term-data";

type Paint = {
  version: number;
  mode: "light" | "dark";
  skin: Skin;
  color: Prefs["color"];
  font: number;
  body: string;
  bg: string;
  panel: string;
  stage: string;
  term: string;
  text: string;
  muted: string;
  field: string;
  line: string;
  ghost: string;
  empty: string;
  sidebar: string;
  primary: string;
  primary_text: string;
  accent: string;
  ring: string;
  wash: [string, string, string, string];
};

const prefsKey = "symbolic-terminal:prefs";
const paintKey = "symbolic-terminal:paint";
const paintVer = 2;

export function boot() {
  return {
    prefs: read(prefsKey, fresh),
    paint: readPaint(),
  };
}

export function savePrefs(prefs: Prefs) {
  save(prefsKey, prefs);
}

export function savePaint(paint: Omit<Paint, "version">) {
  save(paintKey, { ...paint, version: paintVer });
}

export function paint() {
  return readPaint();
}

function readPaint() {
  const paint = read<Paint | null>(paintKey, null);
  if (!paint || paint.version !== paintVer) return null;
  return paint;
}

function read<T>(key: string, fallback: T) {
  const text = window.localStorage.getItem(key);
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

function save(key: string, val: unknown) {
  window.localStorage.setItem(key, JSON.stringify(val));
}
