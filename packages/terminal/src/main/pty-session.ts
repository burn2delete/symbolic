import type * as pty from "node-pty";

import type { Create, Event, Host, Recent, Session, Snapshot } from "../shared/api";
import { dirs, prefs, write } from "./store";
import { copy } from "./pty-utils";
import { spawn } from "./pty-spawn";

export type Live = {
  proc: pty.IPty | null;
  session: Session;
};

export type Size = {
  cols: number;
  rows: number;
};

export type State = {
  list: Live[];
  host: Host | null;
  active: string | null;
  idx: number;
  init: Create | undefined;
  ready: Promise<Snapshot> | null;
  seed: boolean;
  size: Size;
};

export type Deps = {
  send: (event: Event) => void;
  dirs?: (dirs: Recent[]) => void;
  host: () => Promise<{ url: string; password: string }>;
  title?: (session: Session | null) => void;
};

export async function boot(s: State, d: Deps) {
  if (s.ready) return s.ready;
  const job = (async () => {
    if (s.list.length === 0 && s.seed) await create(s, d, s.init);
    s.seed = false;
    s.init = undefined;
    return {
      list: s.list.map((item) => copy(item.session)),
      active: s.active,
      dirs: dirs(),
      prefs: prefs(),
      host: s.host,
    } satisfies Snapshot;
  })();
  s.ready = job;
  return job.finally(() => {
    if (s.ready === job) s.ready = null;
  });
}

export async function create(s: State, d: Deps, input?: Create) {
  const id = crypto.randomUUID();
  const live = await spawn(s, d, id, input, next(s));
  s.list = [...s.list, live];
  s.active = live.session.id;
  emit(s, d, live.session, true);
  title(s, d);
  return copy(live.session);
}

export async function remove(s: State, d: Deps, id: string) {
  const idx = s.list.findIndex((item) => item.session.id === id);
  if (idx === -1) return;
  const live = s.list[idx];
  const next = s.list.filter((item) => item.session.id !== id);
  const active =
    s.active === id
      ? next[idx]?.session.id ?? next[idx - 1]?.session.id ?? null
      : s.active;
  s.list = next;
  s.active = active;
  live.proc?.kill();
  d.send({ type: "remove", id, active });
  title(s, d);
  if (!active) return;
  const session = view(s, active)?.session;
  if (!session) return;
  emit(s, d, session);
}

export async function restart(s: State, d: Deps, id: string) {
  const prev = view(s, id);
  if (!prev) throw new Error(`Unknown session: ${id}`);
  const proc = prev.proc;
  prev.proc = null;
  proc?.kill();
  const next = await spawn(
    s,
    d,
    id,
    { cwd: prev.session.cwd, launch: prev.session.launch },
    prev.session.idx,
  );
  s.list = s.list.map((item) => (item.session.id === id ? next : item));
  emit(s, d, next.session);
  if (s.active === id) title(s, d);
  return copy(next.session);
}

export async function focus(s: State, d: Deps, id: string) {
  const live = view(s, id);
  if (!live) return;
  s.active = id;
  emit(s, d, live.session);
  title(s, d);
}

export async function nextTab(s: State, d: Deps) {
  if (s.list.length < 2) return;
  const idx = s.list.findIndex((item) => item.session.id === s.active);
  const next = s.list[(idx + 1 + s.list.length) % s.list.length];
  if (!next) return;
  await focus(s, d, next.session.id);
}

export async function prevTab(s: State, d: Deps) {
  if (s.list.length < 2) return;
  const idx = s.list.findIndex((item) => item.session.id === s.active);
  const prev = s.list[(idx - 1 + s.list.length) % s.list.length];
  if (!prev) return;
  await focus(s, d, prev.session.id);
}

export async function input(s: State, d: Deps, id: string, data: string) {
  const live = view(s, id);
  if (!live || s.active !== id) return;
  try {
    live.proc?.write(data);
  } catch (err) {
    write("session.write.fail", {
      id,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

export function current(s: State) {
  return s.active;
}

export function session(s: State) {
  const live = cur(s);
  return live ? copy(live.session) : null;
}

export function cwd(s: State) {
  return cur(s)?.session.cwd ?? s.init?.cwd ?? null;
}

export async function resize(s: State, d: Deps, id: string, cols: number, rows: number) {
  const live = view(s, id);
  if (!live || s.active !== id || cols < 1 || rows < 1) return;
  s.size = { cols, rows };
  write("session.resize", {
    id,
    cols,
    rows,
  });
  try {
    live.proc?.resize(cols, rows);
  } catch (err) {
    write("session.resize.fail", {
      id,
      cols,
      rows,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

export function menu(d: Deps, id: string) {
  d.send({ type: "menu", id });
}

export function dispose(s: State) {
  const list = s.list;
  s.list = [];
  s.active = null;
  list.forEach((item) => item.proc?.kill());
}

function next(s: State) {
  s.idx += 1;
  return s.idx;
}

function cur(s: State) {
  return view(s, s.active);
}

function view(s: State, id: string | null) {
  return s.list.find((item) => item.session.id === id) ?? null;
}

function title(s: State, d: Deps) {
  d.title?.(session(s));
}

function emit(s: State, d: Deps, session: Session, withDirs = false) {
  d.send({
    type: "update",
    session: copy(session),
    active: s.active,
    host: s.host,
    ...(withDirs ? { dirs: dirs() } : {}),
  });
}
