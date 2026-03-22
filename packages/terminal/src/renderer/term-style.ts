import type { Terminal } from "@xterm/xterm";

import type { Prefs, Skin, Tui, TuiTone } from "../shared/api";

import { shell, tone } from "./term-data";

export type Paint = {
  look: Look;
  mode: Mode;
  skin: Skin;
  surface: string;
  term: NonNullable<Terminal["options"]["theme"]>;
  wash: [string, string, string, string];
};

type Mode = "light" | "dark";
type Look = {
  body: string;
  bg: string;
  panel: string;
  stage: string;
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
};

export const body =
  'm-0 h-full overflow-hidden font-["SF_Pro_Text","Helvetica_Neue",sans-serif] bg-[radial-gradient(circle_at_top_left,var(--wash-a)_0,transparent_34%),radial-gradient(circle_at_top_right,var(--wash-b)_0,transparent_28%),linear-gradient(180deg,var(--wash-c)_0%,var(--wash-d)_100%)] text-[var(--app-text)]';

export const chrome =
  "rounded-xl border-transparent bg-transparent text-[var(--muted)] shadow-none backdrop-blur-0 hover:bg-[var(--ghost-bg)] hover:text-[var(--app-text)] aria-expanded:bg-[var(--ghost-bg)] aria-expanded:text-[var(--app-text)]";

export const spot =
  "size-1.5 rounded-full bg-[#7f8a8d] group-data-[state=running]:animate-pulse group-data-[state=running]:bg-[#35a365] group-data-[state=running]:shadow-[0_0_0_3px_rgba(53,163,101,0.16)] group-data-[state=starting]:bg-[#e2ac38] group-data-[state=failed]:bg-[#c06249] group-data-[state=exited]:bg-[#c06249]";

export function style(prefs: Prefs, tui: Tui | null): Paint {
  const mode = pickTheme(prefs.theme);
  const skin = pickSkin(prefs);
  const term = baseTone(mode);
  if (prefs.color === "symbolic" && tui) {
    const look = paintLook(tui[mode], mode, skin);
    return {
      look,
      mode,
      skin,
      surface: paintSurface(tui[mode], mode, skin),
      term,
      wash: [
        fade(tui[mode].primary, skin === "glass" ? 0.18 : 0.22),
        fade(tui[mode].accent, skin === "glass" ? 0.12 : 0.16),
        skin === "glass"
          ? fade(tui[mode].backgroundPanel, mode === "dark" ? 0.56 : 0.66)
          : mix(tui[mode].backgroundPanel, tui[mode].background, 0.32),
        skin === "glass"
          ? fade(tui[mode].background, mode === "dark" ? 0.38 : 0.5)
          : tui[mode].background,
      ],
    };
  }
  return {
    look: shell[mode][skin],
    mode,
    skin,
    surface: tone[mode][skin].background ?? shell[mode][skin].stage,
    term,
    wash: ["transparent", "transparent", "transparent", "transparent"],
  };
}

export function paintLook(tui: TuiTone, mode: Mode, skin: Skin): Look {
  return {
    body,
    bg:
      skin === "glass"
        ? fade(tui.background, mode === "dark" ? 0.38 : 0.46)
        : tui.background,
    panel: fade(
      tui.backgroundPanel,
      skin === "glass"
        ? mode === "dark"
          ? 0.48
          : 0.54
        : mode === "dark"
          ? 0.86
          : 0.9,
    ),
    stage: fade(
      tui.backgroundElement,
      skin === "glass"
        ? mode === "dark"
          ? 0.18
          : 0.24
        : mode === "dark"
          ? 0.76
          : 0.68,
    ),
    text: tui.text,
    muted: tui.textMuted,
    field: fade(
      tui.backgroundElement,
      skin === "glass"
        ? mode === "dark"
          ? 0.14
          : 0.22
        : mode === "dark"
          ? 0.32
          : 0.72,
    ),
    line: fade(tui.border, mode === "dark" ? 0.74 : 0.82),
    ghost: fade(tui.primary, skin === "glass" ? 0.12 : 0.08),
    empty: fade(
      tui.backgroundElement,
      skin === "glass"
        ? mode === "dark"
          ? 0.14
          : 0.18
        : mode === "dark"
          ? 0.16
          : 0.26,
    ),
    sidebar: fade(
      tui.backgroundPanel,
      skin === "glass"
        ? mode === "dark"
          ? 0.46
          : 0.42
        : mode === "dark"
          ? 0.92
          : 0.95,
    ),
    primary: tui.primary,
    primary_text: ink(tui.primary),
    accent: fade(
      tui.backgroundElement,
      skin === "glass"
        ? mode === "dark"
          ? 0.34
          : 0.44
        : mode === "dark"
          ? 0.94
          : 1,
    ),
    ring: fade(tui.borderActive, 0.24),
  };
}

export function paintSurface(tui: TuiTone, mode: Mode, skin: Skin) {
  return skin === "glass"
    ? fade(tui.backgroundElement, mode === "dark" ? 0.34 : 0.62)
    : mix(tui.backgroundElement, tui.backgroundPanel, 0.58);
}

function baseTone(mode: Mode) {
  return tone[mode].warm;
}

export function pickTheme(theme: Prefs["theme"]) {
  if (theme !== "system") return theme;
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function pickSkin(prefs: Prefs) {
  return prefs.skin;
}

export function fade(input: string, alpha: number) {
  const rgb = read(input);
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

export function mix(left: string, right: string, alpha: number) {
  const a = read(left);
  const b = read(right);
  const blend = (idx: 0 | 1 | 2) => Math.round(a[idx] + (b[idx] - a[idx]) * alpha);
  return `rgb(${blend(0)}, ${blend(1)}, ${blend(2)})`;
}

export function ink(input: string) {
  const rgb = read(input);
  const lum = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
  return lum > 160 ? "#0f1114" : "#fbfaf5";
}

export function read(input: string) {
  const body = input.replace("#", "");
  const size = body.length === 3 ? 1 : 2;
  const unit = (idx: number) => {
    const part = body.slice(idx, idx + size);
    return Number.parseInt(size === 1 ? `${part}${part}` : part, 16);
  };
  return [unit(0), unit(size), unit(size * 2)] as const;
}
