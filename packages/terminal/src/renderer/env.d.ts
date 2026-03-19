import type { Api } from "../shared/api";

type Tap = {
  seq: number;
  id: string;
  source: "key" | "paste";
  size: number;
  text: string;
  at: number;
  ok: boolean | null;
};

type Focus = {
  id: string;
  at: number;
  ok: boolean;
};

type Peek = {
  id: string;
  idx: number;
  label: string;
  meta: string;
  hint: string | null;
  cwd: string;
  pid: number | null;
  state: "starting" | "running" | "exited" | "failed";
  active: boolean;
};

type Debug = {
  version: 2;
  active: string | null;
  focused: string | null;
  last_focus: Focus | null;
  last_input: Tap | null;
  last_size: {
    why: string;
    at: number;
    host_w: number;
    host_h: number;
    cols: number;
    rows: number;
  } | null;
  sizes: Array<{
    why: string;
    at: number;
    host_w: number;
    host_h: number;
    cols: number;
    rows: number;
  }>;
  session: Peek | null;
  sessions: Peek[];
  host: HTMLDivElement | null;
  focus: () => Promise<boolean>;
};

declare global {
  interface Window {
    api: Api;
    __symbolic_terminal?: Debug;
  }
}

export {};
