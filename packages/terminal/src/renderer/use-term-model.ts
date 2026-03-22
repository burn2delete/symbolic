import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Choice, Custom, Diag, Frame, Host, Prefs, Recent, Session, Tui } from "../shared/api";

import { live, type Rec } from "./term-data";
import { boot } from "./term-cache";
import { pick } from "./term-util";
import { stock } from "../shared/launch";

export function useTermModel() {
  const mac = navigator.userAgent.includes("Mac");
  const seed = boot();
  const probe = useRef<NonNullable<Window["__symbolic_terminal"]>>({
    version: 2,
    active: null,
    focused: null,
    last_focus: null,
    last_input: null,
    last_size: null,
    sizes: [],
    session: null,
    sessions: [],
    host: null,
    focus: async () => false,
  });
  const host = useRef<HTMLDivElement | null>(null);
  const rec = useRef<Rec | null>(null);
  const seen = useRef<string | null>(null);
  const listRef = useRef<Session[]>([]);
  const activeRef = useRef<string | null>(null);
  const dirsRef = useRef<Recent[]>([]);
  const prefsRef = useRef<Prefs>(seed.prefs);
  const tuiRef = useRef<Tui | null>(null);
  const loadRef = useRef(true);

  const [list, setList] = useState<Session[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [dirs, setDirs] = useState<Recent[]>([]);
  const [frame, setFrame] = useState<Frame>({ full: false, lights: mac });
  const [side, setSide] = useState(true);
  const [hostInfo, setHostInfo] = useState<Host | null>(null);
  const [prefs, setPrefs] = useState<Prefs>(seed.prefs);
  const [tui, setTui] = useState<Tui | null>(null);
  const [apps, setApps] = useState<Choice[]>(stock);
  const [customs, setCustoms] = useState<Custom[]>([]);
  const [customsReady, setCustomsReady] = useState(false);
  const [diag, setDiag] = useState<Diag | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [load, setLoad] = useState(true);
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const [panel, setPanel] = useState<"prefs" | "diag" | null>(null);

  useEffect(() => {
    listRef.current = list;
  }, [list]);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  useEffect(() => {
    dirsRef.current = dirs;
  }, [dirs]);

  useEffect(() => {
    prefsRef.current = prefs;
  }, [prefs]);

  useEffect(() => {
    tuiRef.current = tui;
  }, [tui]);

  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  const now = useMemo(() => pick(list, active), [active, list]);
  const recent = useMemo(() => dirs.slice(0, 5), [dirs]);
  const hostText = useMemo(
    () => (hostInfo ? hostInfo.url.replace(/\/$/, "") : null),
    [hostInfo],
  );
  const tip = useMemo(() => {
    const list = [hostText, now?.pid ? `xterm pid ${now.pid}` : null].filter(
      Boolean,
    );
    return list.length ? (list as string[]) : null;
  }, [hostText, now]);
  const proc = useMemo(() => {
    if (!now) return { state: "idle", text: "Idle" } as const;
    if (now.state === "starting")
      return { state: "starting", text: "Starting" } as const;
    if (now.state === "running")
      return { state: "running", text: "Running" } as const;
    if (now.state === "failed")
      return { state: "failed", text: "Failed" } as const;
    return {
      state: "exited",
      text: now.exit_code === null ? "Exited" : `Exited ${now.exit_code}`,
    } as const;
  }, [now]);

  const cur = useCallback(() => pick(listRef.current, activeRef.current), []);

  return {
    mac,
    probe,
    host,
    rec,
    seen,
    listRef,
    activeRef,
    dirsRef,
    prefsRef,
    tuiRef,
    loadRef,
    list,
    setList,
    active,
    setActive,
    dirs,
    setDirs,
    frame,
    setFrame,
    side,
    setSide,
    hostInfo,
    setHostInfo,
    prefs,
    setPrefs,
    tui,
    setTui,
    apps,
    setApps,
    customs,
    setCustoms,
    customsReady,
    setCustomsReady,
    diag,
    setDiag,
    err,
    setErr,
    busy,
    setBusy,
    load,
    setLoad,
    node,
    setNode,
    panel,
    setPanel,
    now,
    recent,
    hostText,
    tip,
    proc,
    cur,
    live,
  };
}

export type Model = ReturnType<typeof useTermModel>;
