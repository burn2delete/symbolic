import "./index.css";

import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Diag, Event, Host, Prefs, Session, Theme } from "../shared/api";

type Rec = {
  term: Terminal;
  fit: FitAddon;
  seen: number;
  id: string | null;
  obs: ResizeObserver | null;
  el: HTMLDivElement;
  cols: number;
  rows: number;
  raf: number | null;
  focus: boolean;
};

const cap = 200_000;
const live = (state: Session["state"]) =>
  state === "starting" || state === "running";
const fresh: Prefs = { cwd_mode: "recent", font_size: 13, theme: "system" };
const trim = (session: Session): Session => ({
  ...session,
  buffer: session.buffer.slice(-cap),
});

const shell = {
  light: {
    bg: "#f7f3eb",
    panel: "rgba(255, 250, 242, 0.82)",
    stage: "rgba(255, 252, 246, 0.62)",
    text: "#3b4648",
  },
  dark: {
    bg: "#13161b",
    panel: "rgba(23, 27, 33, 0.82)",
    stage: "rgba(17, 21, 27, 0.76)",
    text: "#ebe4d8",
  },
} satisfies Record<
  Exclude<Theme, "system">,
  { bg: string; panel: string; stage: string; text: string }
>;

const tone = {
  light: {
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
  dark: {
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
} satisfies Record<
  Exclude<Theme, "system">,
  NonNullable<Terminal["options"]["theme"]>
>;

const plain = (session: Session) => /^Session \d+$/.test(session.title);
const trail = (dir: string) => dir.replace(/^\/Users\/[^/]+/, "~");
const clip = (text: string, size = 24) =>
  text.replace(/\s+/g, " ").trim().slice(0, size);

const leaf = (dir: string) => {
  const list = dir.split("/").filter(Boolean);
  return list.at(-1) || dir || "Home";
};

const hint = (session: Session) => {
  if (live(session.state) && session.pid) return `PID ${session.pid}`;
  if (session.state === "exited" && session.exit_code !== null)
    return `Exit ${session.exit_code}`;
  if (session.state === "failed" && session.note) return clip(session.note);
  return null;
};

const label = (session: Session) => {
  if (session.title && !plain(session)) return session.title;
  return leaf(session.cwd);
};

const meta = (session: Session) => {
  const list = [plain(session) ? `Session ${session.idx}` : trail(session.cwd)];
  const bit = hint(session);
  if (bit) list.push(bit);
  return list.join(" · ");
};

const keep = (list: Session[], id: string | null) => {
  const session = pick(list, id);
  return session ? [session] : [];
};

const pick = (list: Session[], id: string | null) =>
  list.find((item) => item.id === id) ?? list[0] ?? null;

function App() {
  const mac = navigator.userAgent.includes("Mac");
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
  const dirsRef = useRef<string[]>([]);
  const prefsRef = useRef<Prefs>(fresh);
  const loadRef = useRef(true);

  const [list, setList] = useState<Session[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [dirs, setDirs] = useState<string[]>([]);
  const [hostInfo, setHostInfo] = useState<Host | null>(null);
  const [prefs, setPrefs] = useState<Prefs>(fresh);
  const [diag, setDiag] = useState<Diag | null>(null);
  const [, setErr] = useState<string | null>(null);
  const [, setBusy] = useState<string | null>(null);
  const [load, setLoad] = useState(true);
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
    loadRef.current = load;
  }, [load]);

  const now = useMemo(() => pick(list, active), [list, active]);
  const recent = useMemo(() => dirs.slice(0, 5), [dirs]);
  const hostText = useMemo(() => {
    if (!hostInfo) return null;
    return hostInfo.url.replace(/\/$/, "");
  }, [hostInfo]);
  const tip = useMemo(() => {
    const line = [hostText, now?.pid ? `xterm pid ${now.pid}` : null].filter(
      Boolean,
    );
    if (line.length === 0) return null;
    return line as string[];
  }, [hostText, now]);
  const proc = useMemo(() => {
    if (!now) return { state: "idle", text: "Idle" } as const;
    if (now.state === "starting")
      return { state: "starting", text: "Starting" } as const;
    if (now.state === "running")
      return {
        state: "running",
        text: "Running",
      } as const;
    if (now.state === "failed")
      return { state: "failed", text: "Failed" } as const;
    return {
      state: "exited",
      text: now.exit_code === null ? "Exited" : `Exited ${now.exit_code}`,
    } as const;
  }, [now]);

  const cur = useCallback(() => pick(listRef.current, activeRef.current), []);

  const fail = useCallback((msg: string, err?: unknown) => {
    const tail = err instanceof Error ? `: ${err.message}` : "";
    setErr(`${msg}${tail}`);
  }, []);

  const paint = useCallback((session?: Session | null) => {
    const box = rec.current;
    if (!session || !box) return;
    if (box.id !== session.id || session.buffer.length < box.seen) {
      box.term.reset();
      box.seen = 0;
      box.id = session.id;
      box.el.dataset.session = session.id;
    }
    if (session.buffer.length === box.seen) return;
    box.term.write(session.buffer.slice(box.seen));
    box.seen = session.buffer.length;
  }, []);

  const sync = useCallback(
    (session: Session) => {
      const next = trim(session);
      setList([next]);
      setActive(session.id);
      paint(next);
    },
    [paint],
  );

  const mark = useCallback((id: string | null, ok: boolean) => {
    if (!id) return;
    probe.current.last_focus = { id, ok, at: Date.now() };
    probe.current.focused = ok ? id : probe.current.focused;
  }, []);

  const aim = useCallback(
    async (left = 6): Promise<boolean> => {
      const session = cur();
      const box = rec.current;
      if (!session || !box) return false;
      box.el.focus();
      box.term.focus();
      await new Promise((done) => requestAnimationFrame(() => done(undefined)));
      const ok = box.el.contains(document.activeElement);
      mark(session.id, ok);
      if (ok || left <= 1) return ok;
      return aim(left - 1);
    },
    [cur, mark],
  );

  useEffect(() => {
    probe.current.focus = async () => aim();
  }, [aim]);

  const send = useCallback(
    async (data: string, source: "key" | "paste") => {
      const session = cur();
      if (!session) return;
      const tap = {
        seq: (probe.current.last_input?.seq ?? 0) + 1,
        id: session.id,
        source,
        size: data.length,
        text: clip(data),
        at: Date.now(),
        ok: null,
      };
      probe.current.last_input = tap;
      try {
        await window.api.input({ id: session.id, data });
        probe.current.last_input = { ...tap, ok: true };
      } catch (err) {
        probe.current.last_input = { ...tap, ok: false };
        fail("Input failed", err);
      }
    },
    [cur, fail],
  );

  const dispose = useCallback(() => {
    const box = rec.current;
    if (!box) return;
    setLoad(true);
    if (box.raf !== null) cancelAnimationFrame(box.raf);
    box.obs?.disconnect();
    box.term.dispose();
    rec.current = null;
  }, []);

  const frame = useCallback(
    () => new Promise<void>((done) => requestAnimationFrame(() => done())),
    [],
  );
  const sleep = useCallback(
    (ms: number) => new Promise<void>((done) => setTimeout(() => done(), ms)),
    [],
  );

  const snap = useCallback((why: string) => {
    const box = rec.current;
    if (!box) return;
    const next = {
      why,
      at: Date.now(),
      host_w: Math.round(box.el.clientWidth),
      host_h: Math.round(box.el.clientHeight),
      cols: box.term.cols,
      rows: box.term.rows,
    };
    probe.current.last_size = next;
    probe.current.sizes = [...probe.current.sizes.slice(-23), next];
  }, []);

  const size = useCallback(async () => {
    const session = cur();
    const box = rec.current;
    if (!session || !box) return;
    snap("before-fit");
    box.fit.fit();
    snap("after-fit");
    if (box.term.cols === box.cols && box.term.rows === box.rows) return;
    box.cols = box.term.cols;
    box.rows = box.term.rows;
    snap("after-size");
    await window.api.resize({ id: session.id, cols: box.cols, rows: box.rows });
  }, [cur, snap]);

  const settle = useCallback(
    async (left = 8, gap = 80, why = "settle") => {
      const box = rec.current;
      if (!box) return;
      await frame();
      await size();
      if (box.rows > 0) box.term.refresh(0, box.rows - 1);
      snap(why);
      if (left <= 1) return;
      await sleep(gap);
      await settle(left - 1, gap, why);
    },
    [frame, size, sleep, snap],
  );

  const refresh = useCallback(
    (focus = false) => {
      const box = rec.current;
      if (!box) return;
      box.focus ||= focus;
      if (box.raf !== null) return;
      box.raf = requestAnimationFrame(() => {
        const node = rec.current;
        if (!node) return;
        node.raf = null;
        if (document.visibilityState === "hidden") return;
        void size().catch((err) => fail("Resize failed", err));
        if (node.rows > 0) node.term.refresh(0, node.rows - 1);
        if (loadRef.current) setLoad(false);
        if (!node.focus) return;
        node.focus = false;
        void aim();
      });
    },
    [aim, fail, size],
  );

  const mount = useCallback(
    (el: HTMLDivElement | null) => {
      if (!el) return;
      host.current = el;
      probe.current.host = el;
      const box = rec.current;
      if (box) {
        setLoad(true);
        box.el = el;
        box.el.tabIndex = -1;
        box.obs?.disconnect();
        box.obs = new ResizeObserver(() => {
          snap("observer");
          refresh();
        });
        box.obs.observe(el);
        paint(cur());
        refresh(true);
        return;
      }

      const cfg = prefsRef.current;
      setLoad(true);
      el.tabIndex = -1;
      const term = new Terminal({
        allowProposedApi: false,
        fontSize: cfg.font_size,
        macOptionIsMeta: true,
        scrollback: 5000,
        theme: tone[pickTheme(cfg.theme)],
      });
      const fit = new FitAddon();
      const obs = new ResizeObserver(() => {
        snap("observer");
        refresh();
      });

      term.loadAddon(fit);
      term.open(el);
      term.onData((data) => {
        void send(data, "key");
      });
      obs.observe(el);
      rec.current = {
        term,
        fit,
        seen: 0,
        id: null,
        obs,
        el,
        cols: 0,
        rows: 0,
        raf: null,
        focus: false,
      };
      paint(cur());
      refresh(true);
    },
    [cur, paint, refresh, send, snap],
  );

  const create = useCallback(
    async (cwd?: string | null) => {
      setErr(null);
      setBusy(cwd ? "Opening folder" : "Opening window");
      try {
        await window.api.create(cwd ? { cwd } : undefined);
      } catch (err) {
        fail("Could not create session", err);
      } finally {
        setBusy(null);
      }
    },
    [fail],
  );

  const close = useCallback(async () => {
    const session = cur();
    if (!session) return;
    setErr(null);
    setBusy(`Closing ${label(session)}`);
    try {
      await window.api.close(session.id);
    } catch (err) {
      fail("Could not close session", err);
    } finally {
      setBusy(null);
    }
  }, [cur, fail]);

  const requestClose = useCallback(async () => {
    const session = cur();
    if (!session) return;
    if (live(session.state)) {
      const ok = window.confirm(
        `Close ${label(session)}? This window is still running.`,
      );
      if (!ok) return;
    }
    await close();
  }, [close, cur]);

  const restart = useCallback(async () => {
    const session = cur();
    if (!session) return;
    setErr(null);
    setBusy("Restarting session");
    try {
      const el = host.current ?? rec.current?.el ?? null;
      if (rec.current) {
        rec.current.cols = 0;
        rec.current.rows = 0;
      }
      setLoad(true);
      sync(await window.api.restart(session.id));
      dispose();
      if (el) mount(el);
      refresh(true);
      await settle(10, 100, "restart");
    } catch (err) {
      fail("Could not restart session", err);
    } finally {
      setBusy(null);
    }
  }, [cur, dispose, fail, mount, refresh, settle, sync]);

  const open = useCallback(async () => {
    setErr(null);
    const dir = await window.api.pick_dir(
      cur()?.cwd ?? dirsRef.current[0] ?? null,
    );
    if (!dir) return;
    setDirs((list) => [dir, ...list.filter((item) => item !== dir)]);
    await create(dir);
  }, [create, cur]);

  const choose = useCallback(
    async (dir: string) => {
      await create(dir);
    },
    [create],
  );

  const save = useCallback(
    async (next: Partial<Prefs>) => {
      setErr(null);
      try {
        setPrefs(await window.api.set_prefs(next));
      } catch (err) {
        fail("Could not save settings", err);
      }
    },
    [fail],
  );

  const loadDiag = useCallback(async () => {
    setErr(null);
    setBusy("Loading diagnostics");
    try {
      setDiag(await window.api.get_diag());
    } catch (err) {
      fail("Could not load diagnostics", err);
    } finally {
      setBusy(null);
    }
  }, [fail]);

  const copy = useCallback(async () => {
    const text = rec.current?.term.getSelection();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch (err) {
      fail("Copy failed", err);
    }
  }, [fail]);

  const paste = useCallback(async () => {
    try {
      const data = await navigator.clipboard.readText();
      if (!data) return;
      await send(data, "paste");
    } catch (err) {
      fail("Paste failed", err);
    }
  }, [fail, send]);

  const select = useCallback(() => {
    rec.current?.term.selectAll();
  }, []);

  const menu = useCallback(
    (id: string) => {
      if (
        [
          "new-window",
          "new_window",
          "window:new",
          "session:new",
          "new-tab",
          "new_tab",
          "tab:new",
        ].includes(id)
      )
        return void create();
      if (
        [
          "open-folder",
          "open_folder",
          "file:open-folder",
          "session:open-folder",
        ].includes(id)
      )
        return void open();
      if (
        [
          "settings",
          "prefs",
          "preferences",
          "window:settings",
          "app:settings",
        ].includes(id)
      ) {
        setPanel("prefs");
        return;
      }
      if (["diagnostics", "diag", "help:diagnostics"].includes(id)) {
        setPanel("diag");
        void loadDiag();
        return;
      }
      if (
        [
          "close-window",
          "close_window",
          "window:close",
          "session:close",
          "window:close-request",
          "close-tab",
          "close_tab",
          "tab:close",
        ].includes(id)
      )
        return void requestClose();
      if (id.startsWith("recent:")) return void choose(unpack(id.slice(7)));
      if (id.startsWith("open-recent:"))
        return void choose(unpack(id.slice(12)));
      if (
        [
          "restart",
          "restart-window",
          "restart_window",
          "session:restart",
          "restart-tab",
          "restart_tab",
        ].includes(id)
      )
        return void restart();
      if (["window:refresh", "refresh", "tab:refresh"].includes(id))
        return void refresh(true);
      if (["copy", "edit:copy"].includes(id)) return void copy();
      if (["paste", "edit:paste"].includes(id)) return void paste();
      if (["select_all", "select-all", "edit:select-all"].includes(id))
        return void select();
    },
    [
      choose,
      copy,
      create,
      loadDiag,
      open,
      paste,
      refresh,
      requestClose,
      restart,
      select,
    ],
  );

  useEffect(() => {
    let dead = false;
    document.documentElement.dataset.platform = mac ? "darwin" : "other";
    const root = document.getElementById("root");
    if (root)
      root.className = mac
        ? "relative grid h-full grid-rows-[minmax(0,1fr)_auto] gap-2.5 px-3 pb-3 pt-11 max-[720px]:px-2 max-[720px]:pb-2 max-[720px]:pt-3.5"
        : "relative grid h-full grid-rows-[minmax(0,1fr)_auto] gap-2.5 p-3 max-[720px]:p-2";
    window.__symbolic_terminal = probe.current;
    const off = window.api.on((event: Event) => {
      if (event.type === "data") {
        const session = cur();
        const box = rec.current;
        if (session?.id !== event.id || !box) return;
        box.term.write(event.data);
        box.seen += event.data.length;
        return;
      }
      if (event.type === "update") {
        sync(event.session);
        setActive(event.active ?? event.session.id);
        if (event.dirs) setDirs(event.dirs);
        if (event.host !== undefined) setHostInfo(event.host);
        return;
      }
      if (event.type === "remove") {
        setList([]);
        setActive(event.active);
        const box = rec.current;
        if (!pick([], event.active) && box) {
          box.term.reset();
          box.seen = 0;
          box.id = null;
          box.el.dataset.session = "";
        }
        return;
      }
      menu(event.id);
    });

    void window.api
      .boot()
      .then((snap) => {
        if (dead) return;
        setList(keep(snap.list, snap.active).map(trim));
        setActive(pick(snap.list, snap.active)?.id ?? null);
        setDirs(snap.dirs);
        setHostInfo(snap.host);
        setPrefs(snap.prefs);
      })
      .catch((err) => fail("Could not boot terminal", err));

    const wake = () => {
      if (document.visibilityState === "hidden") return;
      snap("focus");
      refresh(document.hasFocus());
      void settle(4, 60, "focus");
    };
    const page = () => {
      snap("pageshow");
      refresh(true);
      void settle(6, 80, "pageshow");
    };
    const resize = () => {
      snap("window-resize");
      refresh(true);
      void settle(10, 100, "window-resize");
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);
    window.addEventListener("pageshow", page);
    window.addEventListener("resize", resize);
    return () => {
      dead = true;
      delete window.__symbolic_terminal;
      off();
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("focus", wake);
      window.removeEventListener("pageshow", page);
      window.removeEventListener("resize", resize);
      dispose();
    };
  }, [cur, dispose, fail, mac, menu, refresh, settle, snap, sync]);

  useEffect(() => {
    const cfg = prefs;
    const mode = pickTheme(cfg.theme);
    const root = document.documentElement;
    root.dataset.theme = mode;
    root.className =
      mode === "dark" ? "dark h-full scheme-dark" : "h-full scheme-light";
    document.body.className =
      mode === "dark"
        ? 'm-0 h-full overflow-hidden font-["SF_Pro_Text","Helvetica_Neue",sans-serif] bg-[radial-gradient(circle_at_top_left,rgba(198,139,60,0.18)_0,transparent_28%),radial-gradient(circle_at_top_right,rgba(58,122,128,0.18)_0,transparent_28%),linear-gradient(180deg,#161b21_0%,#0d1015_100%)] text-[var(--app-text)]'
        : 'm-0 h-full overflow-hidden font-["SF_Pro_Text","Helvetica_Neue",sans-serif] bg-[radial-gradient(circle_at_top_left,#f4dcc0_0,transparent_30%),radial-gradient(circle_at_top_right,#d7e9e3_0,transparent_28%),linear-gradient(180deg,#f7f3eb_0%,#ece5d8_100%)] text-[var(--app-text)]';
    root.style.setProperty("--font-size", `${cfg.font_size}px`);
    root.style.setProperty("--app-bg", shell[mode].bg);
    root.style.setProperty("--panel-bg", shell[mode].panel);
    root.style.setProperty("--stage-bg", shell[mode].stage);
    root.style.setProperty(
      "--term-surface",
      tone[mode].background ?? "#111315",
    );
    root.style.setProperty("--app-text", shell[mode].text);
    root.style.setProperty("--muted", mode === "dark" ? "#a9b5bf" : "#5f6d70");
    root.style.setProperty(
      "--field-bg",
      mode === "dark"
        ? "rgba(255, 255, 255, 0.05)"
        : "rgba(255, 255, 255, 0.52)",
    );
    root.style.setProperty(
      "--field-line",
      mode === "dark" ? "rgba(255, 255, 255, 0.08)" : "rgba(24, 32, 34, 0.1)",
    );
    root.style.setProperty(
      "--ghost-bg",
      mode === "dark" ? "rgba(255, 255, 255, 0.08)" : "rgba(24, 32, 34, 0.06)",
    );
    root.style.setProperty(
      "--empty-bg",
      mode === "dark"
        ? "rgba(255, 255, 255, 0.05)"
        : "rgba(255, 255, 255, 0.22)",
    );
  }, [prefs]);

  useEffect(() => {
    const theme = tone[pickTheme(prefs.theme)];
    const box = rec.current;
    if (!box) return;
    box.term.options.fontSize = prefs.font_size;
    box.term.options.theme = theme;
    refresh();
  }, [prefs, refresh]);

  useEffect(() => {
    paint(now);
    const box = rec.current;
    if (!box) return;
    box.el.dataset.session = now?.id ?? "";
    box.el.dataset.state = now?.state ?? "";
    if (!now) {
      seen.current = null;
      return;
    }
    if (now.id === seen.current) return;
    seen.current = now.id;
    refresh(true);
  }, [now, paint, refresh]);

  useEffect(() => {
    probe.current.active = now?.id ?? null;
    probe.current.session = now
      ? {
          id: now.id,
          idx: now.idx,
          label: label(now),
          meta: meta(now),
          hint: hint(now),
          cwd: now.cwd,
          pid: now.pid,
          state: now.state,
          active: true,
        }
      : null;
    probe.current.sessions = probe.current.session
      ? [probe.current.session]
      : [];
    probe.current.host = host.current ?? rec.current?.el ?? null;
  }, [now]);

  return (
    <>
      <div
        className="min-h-0 h-full w-full min-w-0 overflow-hidden rounded-2xl border border-[rgba(24,32,34,0.1)] bg-[var(--term-surface)] p-2.5 shadow-[0_24px_60px_rgba(104,83,56,0.14)] data-[empty=true]:opacity-[0.18] [&_.xterm]:h-full [&_.xterm]:w-full [&_.xterm]:min-w-0 [&_.xterm-viewport]:!bg-transparent [&_.xterm-viewport::-webkit-scrollbar-track]:bg-transparent"
        data-empty={now ? "false" : "true"}
        data-host="terminal"
        ref={mount}
      />
      {tip ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <div
                className="group flex min-h-7 items-center gap-2 self-end justify-self-end px-0.5 text-[11px] font-medium text-[var(--muted)] max-[720px]:justify-self-start"
                data-state={proc.state}
              />
            }
          >
            <span className="size-1.5 rounded-full bg-[#7f8a8d] group-data-[state=running]:animate-pulse group-data-[state=running]:bg-[#35a365] group-data-[state=running]:shadow-[0_0_0_3px_rgba(53,163,101,0.16)] group-data-[state=starting]:bg-[#e2ac38] group-data-[state=failed]:bg-[#c06249] group-data-[state=exited]:bg-[#c06249]" />
            <span>{proc.text}</span>
          </TooltipTrigger>
          <TooltipContent align="end" side="top" sideOffset={8}>
            <div className="grid gap-1.5 font-mono text-[11px] leading-4">
              {tip.map((item, idx) => (
                <span key={`${item}-${idx}`}>{item}</span>
              ))}
            </div>
          </TooltipContent>
        </Tooltip>
      ) : (
        <div
          className="group flex min-h-7 items-center gap-2 self-end justify-self-end px-0.5 text-[11px] font-medium text-[var(--muted)] max-[720px]:justify-self-start"
          data-state={proc.state}
        >
          <span className="size-1.5 rounded-full bg-[#7f8a8d] group-data-[state=running]:animate-pulse group-data-[state=running]:bg-[#35a365] group-data-[state=running]:shadow-[0_0_0_3px_rgba(53,163,101,0.16)] group-data-[state=starting]:bg-[#e2ac38] group-data-[state=failed]:bg-[#c06249] group-data-[state=exited]:bg-[#c06249]" />
          <span>{proc.text}</span>
        </div>
      )}
      {now && load ? (
        <section
          className={
            mac
              ? "absolute inset-x-3 bottom-14 top-11 grid place-items-center content-center gap-3.5 rounded-2xl bg-[color-mix(in_srgb,var(--term-surface)_88%,transparent)] text-center text-[rgba(251,250,245,0.88)] backdrop-blur-[12px] max-[720px]:inset-x-2 max-[720px]:bottom-12 max-[720px]:top-3.5"
              : "absolute inset-x-3 bottom-14 top-3 grid place-items-center content-center gap-3.5 rounded-2xl bg-[color-mix(in_srgb,var(--term-surface)_88%,transparent)] text-center text-[rgba(251,250,245,0.88)] backdrop-blur-[12px] max-[720px]:inset-x-2 max-[720px]:bottom-12 max-[720px]:top-2"
          }
        >
          <div className="size-6 animate-spin rounded-full border-2 border-[rgba(255,255,255,0.18)] border-t-[rgba(255,255,255,0.82)]" />
          <p>Loading terminal...</p>
        </section>
      ) : null}
      {!now ? (
        <section
          className={
            mac
              ? "absolute inset-x-3 bottom-14 top-11 grid place-items-center content-center gap-3.5 rounded-2xl border border-dashed border-[var(--field-line)] bg-[var(--empty-bg)] p-6 text-center backdrop-blur-[12px] max-[720px]:inset-x-2 max-[720px]:bottom-12 max-[720px]:top-3.5"
              : "absolute inset-x-3 bottom-14 top-3 grid place-items-center content-center gap-3.5 rounded-2xl border border-dashed border-[var(--field-line)] bg-[var(--empty-bg)] p-6 text-center backdrop-blur-[12px] max-[720px]:inset-x-2 max-[720px]:bottom-12 max-[720px]:top-2"
          }
        >
          <p className="m-0">No session in this window yet.</p>
          {recent.length ? (
            <div className="flex flex-wrap items-center justify-center gap-2">
              {recent.map((dir) => (
                <button
                  className="rounded-xl border border-[var(--field-line)] bg-[var(--field-bg)] px-3 py-2 text-[12px] text-inherit transition duration-150 ease-out hover:-translate-y-px"
                  key={dir}
                  onClick={() => void choose(dir)}
                  type="button"
                >
                  {leaf(dir)}
                </button>
              ))}
            </div>
          ) : null}
          <div className="flex items-center gap-2">
            <button
              className="rounded-xl bg-[#1c4c46] px-3.5 py-2.5 text-[#fbfaf5] transition duration-150 ease-out hover:-translate-y-px"
              onClick={() => void create()}
              type="button"
            >
              Open Window
            </button>
            <button
              className="rounded-xl bg-[var(--ghost-bg)] px-3.5 py-2.5 text-[var(--app-text)] transition duration-150 ease-out hover:-translate-y-px"
              onClick={() => void open()}
              type="button"
            >
              Start From Folder
            </button>
          </div>
        </section>
      ) : null}

      {panel ? (
        <aside className="absolute right-2.5 top-2.5 z-10 w-[min(380px,calc(100%-20px))] max-[720px]:inset-x-0 max-[720px]:bottom-0 max-[720px]:top-auto max-[720px]:w-full">
          <section className="grid gap-4 rounded-[18px] border border-[var(--field-line)] bg-[var(--panel-bg)] p-4 shadow-[0_24px_60px_rgba(14,18,24,0.18)] backdrop-blur-[24px] max-[720px]:rounded-b-none max-[720px]:rounded-t-2xl">
            <div className="flex items-start justify-between gap-2.5">
              <div>
                <h2>{panel === "prefs" ? "Settings" : "Diagnostics"}</h2>
                <p className="mt-1 text-[13px] text-[var(--muted)]">
                  {panel === "prefs"
                    ? "Keep the shell readable and close to the terminal."
                    : "Quick launch details for debugging startup issues."}
                </p>
              </div>
              <button
                className="rounded-xl bg-[var(--ghost-bg)] px-3 py-2 text-[var(--app-text)] transition duration-150 ease-out hover:-translate-y-px"
                onClick={() => setPanel(null)}
                type="button"
              >
                Close
              </button>
            </div>

            {panel === "prefs" ? (
              <div className="grid gap-3.5">
                <label className="flex flex-col items-stretch gap-2.5">
                  <span className="text-[13px] font-semibold">Theme</span>
                  <select
                    className="min-h-10 rounded-xl border border-[var(--field-line)] bg-[var(--field-bg)] px-3 text-[12px] text-inherit"
                    onChange={(event) =>
                      void save({
                        theme: event.currentTarget.value as Theme,
                      })
                    }
                    value={prefs.theme}
                  >
                    <option value="system">System</option>
                    <option value="light">Light</option>
                    <option value="dark">Dark</option>
                  </select>
                </label>

                <label className="flex flex-col items-stretch gap-2.5">
                  <span className="text-[13px] font-semibold">Font size</span>
                  <div className="flex items-center justify-between gap-2.5 rounded-xl border border-[var(--field-line)] bg-[var(--field-bg)] px-3 py-2 text-[12px]">
                    <input
                      className="flex-1"
                      max="18"
                      min="11"
                      onChange={(event) =>
                        void save({
                          font_size: Number(event.currentTarget.value),
                        })
                      }
                      onInput={(event) =>
                        setPrefs((prefs) => ({
                          ...prefs,
                          font_size: Number(event.currentTarget.value),
                        }))
                      }
                      type="range"
                      value={prefs.font_size}
                    />
                    <output>{prefs.font_size}px</output>
                  </div>
                </label>

                <label className="flex flex-col items-stretch gap-2.5">
                  <span className="text-[13px] font-semibold">
                    Default folder
                  </span>
                  <select
                    className="min-h-10 rounded-xl border border-[var(--field-line)] bg-[var(--field-bg)] px-3 text-[12px] text-inherit"
                    onChange={(event) =>
                      void save({
                        cwd_mode: event.currentTarget
                          .value as Prefs["cwd_mode"],
                      })
                    }
                    value={prefs.cwd_mode}
                  >
                    <option value="recent">Most recent folder</option>
                    <option value="home">Home folder</option>
                  </select>
                </label>

                <div className="flex flex-col items-stretch gap-2.5">
                  <span className="text-[13px] font-semibold">
                    Recent folders
                  </span>
                  <div className="grid gap-3.5">
                    {recent.length ? (
                      recent.map((dir) => (
                        <button
                          className="grid w-full justify-items-start rounded-xl border border-[var(--field-line)] bg-[var(--field-bg)] px-3 py-2 text-left text-[12px] text-inherit transition duration-150 ease-out hover:-translate-y-px"
                          key={dir}
                          onClick={() => void choose(dir)}
                          title={dir}
                          type="button"
                        >
                          <span>{leaf(dir)}</span>
                          <span className='font-["SF_Mono","JetBrains_Mono",Menlo,monospace] text-[var(--muted)]'>
                            {trail(dir)}
                          </span>
                        </button>
                      ))
                    ) : (
                      <span className="text-[var(--muted)]">
                        No recent folders yet.
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="grid gap-3.5">
                <div className="flex items-center justify-between gap-2.5">
                  <span className="text-[var(--muted)]">Log file</span>
                  <span className='font-["SF_Mono","JetBrains_Mono",Menlo,monospace] text-[12px]'>
                    {diag?.path ?? "Not available"}
                  </span>
                </div>
                <button
                  className="w-fit rounded-xl bg-[var(--ghost-bg)] px-3 py-2 text-[var(--app-text)] transition duration-150 ease-out hover:-translate-y-px"
                  onClick={() => void loadDiag()}
                  type="button"
                >
                  Refresh
                </button>
                <pre className='m-0 max-h-[300px] min-h-[180px] overflow-auto rounded-[14px] bg-[#0f1114] p-3 font-["SF_Mono","JetBrains_Mono",Menlo,monospace] text-[12px] text-[#ece4d7] whitespace-pre-wrap break-words'>
                  {diag?.tail ?? "No diagnostics loaded yet."}
                </pre>
              </div>
            )}
          </section>
        </aside>
      ) : null}
    </>
  );
}

function pickTheme(theme: Theme) {
  if (theme !== "system") return theme;
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function unpack(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

const root = document.getElementById("root");

if (!root) throw new Error("Root element not found");

createRoot(root).render(
  <TooltipProvider delay={0}>
    <App />
  </TooltipProvider>,
);
