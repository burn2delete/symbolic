import { FolderOpenIcon, MonitorIcon, MoonIcon, PlusIcon, RotateCcwIcon, Settings2Icon, SunIcon, SquareTerminalIcon, XIcon } from "lucide-react";
import type { ComponentProps, ComponentType } from "react";

import type { Color, Prefs, Skin, Theme } from "../shared/api";

export type Mode = Exclude<Theme, "system">;

export type Look = {
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

export type Rec = {
  term: import("@xterm/xterm").Terminal;
  fit: import("@xterm/addon-fit").FitAddon;
  seen: number;
  id: string | null;
  obs: ResizeObserver | null;
  el: HTMLDivElement;
  cols: number;
  rows: number;
  raf: number | null;
  focus: boolean;
};

export const cap = 200_000;
export const live = (state: "starting" | "running" | "exited" | "failed") =>
  state === "starting" || state === "running";

export const fresh: Prefs = {
  cwd_mode: "recent",
  font_size: 14,
  theme: "system",
  skin: "warm",
  color: "local",
  status_closed: true,
  status_open: "sidebar",
};

export const shell = {
  light: {
    warm: {
      body: 'm-0 h-full overflow-hidden font-["SF_Pro_Text","Helvetica_Neue",sans-serif] bg-[radial-gradient(circle_at_top_left,#f4dcc0_0,transparent_30%),radial-gradient(circle_at_top_right,#d7e9e3_0,transparent_28%),linear-gradient(180deg,#f7f3eb_0%,#ece5d8_100%)] text-[var(--app-text)]',
      bg: "#f7f3eb",
      panel: "rgba(255, 250, 242, 0.82)",
      stage: "rgba(255, 252, 246, 0.62)",
      text: "#3b4648",
      muted: "#5f6d70",
      field: "rgba(255, 255, 255, 0.52)",
      line: "rgba(24, 32, 34, 0.1)",
      ghost: "rgba(24, 32, 34, 0.06)",
      empty: "rgba(255, 255, 255, 0.22)",
      sidebar: "rgba(255, 250, 242, 0.92)",
      primary: "#1c4c46",
      primary_text: "#fbfaf5",
      accent: "rgba(24, 32, 34, 0.06)",
      ring: "rgba(28, 76, 70, 0.22)",
    },
    glass: {
      body: 'm-0 h-full overflow-hidden font-["SF_Pro_Text","Helvetica_Neue",sans-serif] bg-[radial-gradient(circle_at_top_left,rgba(173,211,219,0.28)_0,transparent_34%),radial-gradient(circle_at_top_right,rgba(255,255,255,0.34)_0,transparent_28%),linear-gradient(180deg,rgba(238,246,251,0.52)_0%,rgba(221,234,242,0.34)_100%)] text-[var(--app-text)]',
      bg: "rgba(236, 244, 248, 0.4)",
      panel: "rgba(248, 253, 255, 0.46)",
      stage: "rgba(255, 255, 255, 0.22)",
      text: "#234049",
      muted: "#60767d",
      field: "rgba(255, 255, 255, 0.2)",
      line: "rgba(44, 77, 88, 0.14)",
      ghost: "rgba(255, 255, 255, 0.22)",
      empty: "rgba(255, 255, 255, 0.14)",
      sidebar: "rgba(246, 251, 253, 0.38)",
      primary: "#145463",
      primary_text: "#f5fdff",
      accent: "rgba(255, 255, 255, 0.16)",
      ring: "rgba(20, 84, 99, 0.18)",
    },
  },
  dark: {
    warm: {
      body: 'm-0 h-full overflow-hidden font-["SF_Pro_Text","Helvetica_Neue",sans-serif] bg-[radial-gradient(circle_at_top_left,rgba(198,139,60,0.18)_0,transparent_28%),radial-gradient(circle_at_top_right,rgba(58,122,128,0.18)_0,transparent_28%),linear-gradient(180deg,#161b21_0%,#0d1015_100%)] text-[var(--app-text)]',
      bg: "#13161b",
      panel: "rgba(23, 27, 33, 0.82)",
      stage: "rgba(17, 21, 27, 0.76)",
      text: "#ebe4d8",
      muted: "#a9b5bf",
      field: "rgba(255, 255, 255, 0.05)",
      line: "rgba(255, 255, 255, 0.08)",
      ghost: "rgba(255, 255, 255, 0.08)",
      empty: "rgba(255, 255, 255, 0.05)",
      sidebar: "rgba(20, 24, 30, 0.86)",
      primary: "#f0cc68",
      primary_text: "#111315",
      accent: "rgba(255, 255, 255, 0.06)",
      ring: "rgba(240, 204, 104, 0.32)",
    },
    glass: {
      body: 'm-0 h-full overflow-hidden font-["SF_Pro_Text","Helvetica_Neue",sans-serif] bg-[radial-gradient(circle_at_top_left,rgba(86,155,175,0.16)_0,transparent_32%),radial-gradient(circle_at_top_right,rgba(163,221,230,0.1)_0,transparent_28%),linear-gradient(180deg,rgba(16,22,29,0.56)_0%,rgba(8,12,17,0.38)_100%)] text-[var(--app-text)]',
      bg: "rgba(13, 19, 24, 0.38)",
      panel: "rgba(17, 24, 30, 0.48)",
      stage: "rgba(10, 15, 20, 0.18)",
      text: "#ddeaf0",
      muted: "#9db0b8",
      field: "rgba(255, 255, 255, 0.08)",
      line: "rgba(148, 184, 196, 0.16)",
      ghost: "rgba(184, 223, 235, 0.08)",
      empty: "rgba(160, 205, 221, 0.08)",
      sidebar: "rgba(16, 22, 30, 0.44)",
      primary: "#86d7e5",
      primary_text: "#081217",
      accent: "rgba(255, 255, 255, 0.07)",
      ring: "rgba(134, 215, 229, 0.22)",
    },
  },
} satisfies Record<Mode, Record<Skin, Look>>;

export const tone = {
  light: {
    warm: {
      background: "#111315",
      foreground: "#f4efe4",
      cursor: "#ffcf5a",
      selectionBackground: "#3b4b5d88",
      black: "#202329",
      red: "#ff6b5e",
      green: "#8bd970",
      yellow: "#f4c95d",
      blue: "#79b8ff",
      magenta: "#d49fff",
      cyan: "#73daca",
      white: "#e5dfd0",
      brightBlack: "#5a6270",
      brightRed: "#ff8e7f",
      brightGreen: "#a7e887",
      brightYellow: "#ffd978",
      brightBlue: "#9ac9ff",
      brightMagenta: "#e3b4ff",
      brightCyan: "#97f2e3",
      brightWhite: "#fffaf0",
    },
    glass: {
      background: "rgba(247, 252, 255, 0.36)",
      foreground: "#1f4049",
      cursor: "#0c6f86",
      selectionBackground: "#79c3d55e",
      black: "#314b55",
      red: "#d56e67",
      green: "#6aa87a",
      yellow: "#caa257",
      blue: "#4e93cc",
      magenta: "#8772d0",
      cyan: "#45a7ba",
      white: "#edf5f8",
      brightBlack: "#55707a",
      brightRed: "#e89a92",
      brightGreen: "#89c198",
      brightYellow: "#ddc07a",
      brightBlue: "#78b6e6",
      brightMagenta: "#a790e1",
      brightCyan: "#71c8d8",
      brightWhite: "#ffffff",
    },
  },
  dark: {
    warm: {
      background: "#0b0e12",
      foreground: "#e9e1d3",
      cursor: "#ffcf5a",
      selectionBackground: "#50617488",
      black: "#1a1f28",
      red: "#ff8578",
      green: "#8de38f",
      yellow: "#f0cc68",
      blue: "#86bdff",
      magenta: "#d6a9ff",
      cyan: "#7be4da",
      white: "#dfe6ef",
      brightBlack: "#6b7582",
      brightRed: "#ffaaa0",
      brightGreen: "#b0efaf",
      brightYellow: "#ffdc8e",
      brightBlue: "#a9d2ff",
      brightMagenta: "#e7c7ff",
      brightCyan: "#a5f8ef",
      brightWhite: "#f7f9fc",
    },
    glass: {
      background: "rgba(9, 16, 22, 0.34)",
      foreground: "#d8e8ef",
      cursor: "#8de6ff",
      selectionBackground: "#5cc8de55",
      black: "#16212a",
      red: "#f19086",
      green: "#8fddb9",
      yellow: "#dcc578",
      blue: "#7dbdff",
      magenta: "#c1a3ff",
      cyan: "#7be6f4",
      white: "#dfedf4",
      brightBlack: "#6d8490",
      brightRed: "#ffb7ad",
      brightGreen: "#b6f0d1",
      brightYellow: "#ebdca2",
      brightBlue: "#abd8ff",
      brightMagenta: "#dcc4ff",
      brightCyan: "#abf6ff",
      brightWhite: "#f7fbff",
    },
  },
} satisfies Record<Mode, Record<Skin, NonNullable<import("@xterm/xterm").Terminal["options"]["theme"]>>>;

export const skins = [
  { id: "warm", label: "Warm", note: "Current paper-and-brass palette" },
  {
    id: "glass",
    label: "Translucent Glass",
    note: "Frosted layered panels with more transparency",
  },
] satisfies Array<{ id: Skin; label: string; note: string }>;

export const colors = [
  { id: "local", label: "Terminal", note: "Use the built-in window palette" },
  { id: "symbolic", label: "Match Symbolic", note: "Use the active Symbolic TUI theme" },
] satisfies Array<{ id: Color; label: string; note: string }>;

export const Desk = MonitorIcon as ComponentType<ComponentProps<"svg">>;
export const Dir = FolderOpenIcon as ComponentType<ComponentProps<"svg">>;
export const Gear = Settings2Icon as ComponentType<ComponentProps<"svg">>;
export const Moon = MoonIcon as ComponentType<ComponentProps<"svg">>;
export const Plus = PlusIcon as ComponentType<ComponentProps<"svg">>;
export const Sun = SunIcon as ComponentType<ComponentProps<"svg">>;
export const Turn = RotateCcwIcon as ComponentType<ComponentProps<"svg">>;
export const Term = SquareTerminalIcon as ComponentType<ComponentProps<"svg">>;
export const X = XIcon as ComponentType<ComponentProps<"svg">>;
