import { useEffect, useLayoutEffect } from "react";

import type { Event } from "../shared/api";

import { cap } from "./term-data";
import { savePaint, savePrefs } from "./term-cache";
import { style } from "./term-style";
import { label, line, meta, pick, plain } from "./term-util";
import type { Act } from "./use-term-actions";
import type { Core } from "./use-term-core";
import type { Model } from "./use-term-model";

type Fail = (msg: string, err?: unknown) => void;

export function useTermEffects(model: Model, core: Core, act: Act, fail: Fail) {
  useEffect(() => {
    model.probe.current.focus = async () => core.aim();
  }, [core.aim, model.probe]);

  useEffect(() => {
    if (!model.node) return;
    core.mount(model.node);
  }, [model.node]);

  useEffect(() => {
    let dead = false;
    document.documentElement.dataset.platform = model.mac ? "darwin" : "other";
    const root = document.getElementById("root");
    if (root) root.className = "h-full";
    window.__symbolic_terminal = model.probe.current;
    const off = window.api.on((event: Event) => {
      if (event.type === "data") {
        const session = model.cur();
        const box = model.rec.current;
        if (session?.id !== event.id || !box) return;
        box.term.write(event.data);
        box.seen += event.data.length;
        return;
      }
      if (event.type === "update") {
        core.sync(event.session, event.active ?? event.session.id);
        if (event.dirs) model.setDirs(event.dirs);
        if (event.host !== undefined) model.setHostInfo(event.host);
        if (model.node) model.setLoad(false);
        return;
      }
      if (event.type === "remove") {
        model.setList((list) => list.filter((item) => item.id !== event.id));
        model.setActive(event.active);
        const box = model.rec.current;
        if (!event.active || !box) return;
        box.term.reset();
        box.seen = 0;
        box.id = null;
        box.el.dataset.session = "";
        return;
      }
      if (event.type === "frame") return void model.setFrame(event.frame);
      if (event.type === "prefs") return void model.setPrefs(event.prefs);
      if (event.type === "tui") return void model.setTui(event.tui);
      act.menu(event.id);
    });

    void window.api.seed().then((data) => {
      if (dead) return;
      model.setPrefs(data.prefs);
      model.setFrame(data.frame);
      model.setTui(data.tui);
    }).catch((err) => fail("Could not load theme", err));

    void window.api.boot().then((snap) => {
      if (dead) return;
      model.setList(snap.list.map((item) => ({ ...item, buffer: item.buffer.slice(-cap) })));
      model.setActive(pick(snap.list, snap.active)?.id ?? null);
      model.setDirs(snap.dirs);
      if (snap.frame) model.setFrame(snap.frame);
      model.setHostInfo(snap.host);
      model.setPrefs(snap.prefs);
      if (snap.tui !== undefined) model.setTui(snap.tui);
      if (model.node) model.setLoad(false);
    }).catch((err) => fail("Could not boot terminal", err));

    const wake = () => {
      if (document.visibilityState === "hidden") return;
      core.snap("focus");
      core.refresh(document.hasFocus());
      void core.settle(4, 60, "focus");
    };
    const page = () => {
      core.snap("pageshow");
      core.refresh(true);
      void core.settle(6, 80, "pageshow");
    };
    const resize = () => {
      core.snap("window-resize");
      core.refresh(true);
      void core.settle(10, 100, "window-resize");
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
      core.dispose();
    };
  }, [
    act.menu,
    core.dispose,
    core.refresh,
    core.settle,
    core.snap,
    core.sync,
    fail,
    model.cur,
    model.mac,
    model.probe,
    model.rec,
    model.setActive,
    model.setDirs,
    model.setFrame,
    model.setHostInfo,
    model.setList,
    model.setPrefs,
    model.setTui,
  ]);

  useLayoutEffect(() => {
    const cfg = style(model.prefs, model.tui);
    const seed = model.prefs.color === "symbolic"
      ? style({ ...model.prefs, color: "local" }, null)
      : cfg;
    const look = cfg.look;
    const root = document.documentElement;
    root.dataset.theme = cfg.mode;
    root.dataset.skin = cfg.skin;
    root.dataset.color = model.prefs.color;
    root.className = cfg.mode === "dark" ? "dark h-full scheme-dark" : "h-full scheme-light";
    root.style.backgroundColor = "";
    document.body.className = look.body;
    document.body.style.backgroundColor = "";
    root.style.setProperty("--font-size", `${model.prefs.font_size}px`);
    root.style.setProperty("--app-bg", look.bg);
    root.style.setProperty("--panel-bg", look.panel);
    root.style.setProperty("--stage-bg", look.stage);
    root.style.setProperty("--term-surface", cfg.surface);
    root.style.setProperty("--app-text", look.text);
    root.style.setProperty("--muted", look.muted);
    root.style.setProperty("--field-bg", look.field);
    root.style.setProperty("--field-line", look.line);
    root.style.setProperty("--ghost-bg", look.ghost);
    root.style.setProperty("--empty-bg", look.empty);
    root.style.setProperty("--sidebar", look.sidebar);
    root.style.setProperty("--sidebar-foreground", look.text);
    root.style.setProperty("--sidebar-primary", look.primary);
    root.style.setProperty("--sidebar-primary-foreground", look.primary_text);
    root.style.setProperty("--sidebar-accent", look.accent);
    root.style.setProperty("--sidebar-accent-foreground", look.text);
    root.style.setProperty("--sidebar-border", look.line);
    root.style.setProperty("--sidebar-ring", look.ring);
    root.style.setProperty("--wash-a", cfg.wash[0]);
    root.style.setProperty("--wash-b", cfg.wash[1]);
    root.style.setProperty("--wash-c", cfg.wash[2]);
    root.style.setProperty("--wash-d", cfg.wash[3]);
    savePaint({
      mode: seed.mode,
      skin: seed.skin,
      color: "local",
      font: model.prefs.font_size,
      body: seed.look.body,
      bg: seed.look.bg,
      panel: seed.look.panel,
      stage: seed.look.stage,
      term: seed.surface,
      text: seed.look.text,
      muted: seed.look.muted,
      field: seed.look.field,
      line: seed.look.line,
      ghost: seed.look.ghost,
      empty: seed.look.empty,
      sidebar: seed.look.sidebar,
      primary: seed.look.primary,
      primary_text: seed.look.primary_text,
      accent: seed.look.accent,
      ring: seed.look.ring,
      wash: seed.wash,
    });
  }, [model.prefs, model.tui]);

  useEffect(() => {
    savePrefs(model.prefs);
  }, [model.prefs]);

  useEffect(() => {
    const cfg = style(model.prefs, model.tui);
    const box = model.rec.current;
    if (!box) return;
    box.term.options.fontSize = model.prefs.font_size;
    box.term.options.theme = cfg.term;
    core.refresh();
  }, [core.refresh, model.prefs, model.rec, model.tui]);

  useEffect(() => {
    const box = model.rec.current;
    if (!box) return;
    if (!model.now) {
      model.seen.current = null;
      return;
    }
    box.el.dataset.session = model.now.id;
    box.el.dataset.state = model.now.state;
    if (model.now.id === model.seen.current) return;
    model.seen.current = model.now.id;
    core.refresh(true);
  }, [core.refresh, model.now, model.rec, model.seen]);

  useEffect(() => {
    const list = model.list.map((session) => ({
      id: session.id,
      idx: session.idx,
      label: label(session),
      meta: meta(session),
      hint: plain(session) ? null : line(session),
      cwd: session.cwd,
      pid: session.pid,
      state: session.state,
      active: session.id === model.now?.id,
    }));
    model.probe.current.active = model.now?.id ?? null;
    model.probe.current.session = list.find((item) => item.active) ?? null;
    model.probe.current.sessions = list;
    model.probe.current.host = model.host.current ?? model.rec.current?.el ?? null;
  }, [model.host, model.list, model.now, model.probe, model.rec]);
}
