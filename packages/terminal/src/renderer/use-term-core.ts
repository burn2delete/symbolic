import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useCallback } from "react";

import type { Session } from "../shared/api";

import { cap } from "./term-data";
import { style } from "./term-style";
import { merge } from "./term-util";
import type { Model } from "./use-term-model";

type Fail = (msg: string, err?: unknown) => void;

export function useTermCore(model: Model, fail: Fail) {
  const paint = useCallback((session?: Session | null) => {
    const box = model.rec.current;
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
  }, [model.rec]);

  const sync = useCallback((session: Session, active = model.activeRef.current ?? session.id) => {
    const next = { ...session, buffer: session.buffer.slice(-cap) };
    const list = merge(model.listRef.current, next);
    model.listRef.current = list;
    model.activeRef.current = active;
    model.setList(list);
    model.setActive(active);
    if (active === next.id) paint(next);
  }, [model.activeRef, model.listRef, model.setActive, model.setList, paint]);

  const mark = useCallback((id: string | null, ok: boolean) => {
    if (!id) return;
    model.probe.current.last_focus = { id, ok, at: Date.now() };
    model.probe.current.focused = ok ? id : model.probe.current.focused;
  }, [model.probe]);

  const aim = useCallback(async (left = 6): Promise<boolean> => {
    const session = model.cur();
    const box = model.rec.current;
    if (!session || !box) return false;
    box.el.focus();
    box.term.focus();
    await new Promise((done) => requestAnimationFrame(() => done(undefined)));
    const ok = box.el.contains(document.activeElement);
    mark(session.id, ok);
    if (ok || left <= 1) return ok;
    return aim(left - 1);
  }, [mark, model.cur, model.rec]);

  const send = useCallback(async (data: string, source: "key" | "paste") => {
    const session = model.cur();
    if (!session) return;
    const tap = {
      seq: (model.probe.current.last_input?.seq ?? 0) + 1,
      id: session.id,
      source,
      size: data.length,
      text: data.replace(/\s+/g, " ").trim().slice(0, 24),
      at: Date.now(),
      ok: null,
    };
    model.probe.current.last_input = tap;
    try {
      await window.api.input({ id: session.id, data });
      model.probe.current.last_input = { ...tap, ok: true };
    } catch (err) {
      model.probe.current.last_input = { ...tap, ok: false };
      fail("Input failed", err);
    }
  }, [fail, model.cur, model.probe]);

  const dispose = useCallback(() => {
    const box = model.rec.current;
    if (!box) return;
    model.setLoad(true);
    if (box.raf !== null) cancelAnimationFrame(box.raf);
    box.obs?.disconnect();
    box.term.dispose();
    model.rec.current = null;
  }, [model.rec, model.setLoad]);

  const tick = useCallback(
    () => new Promise<void>((done) => requestAnimationFrame(() => done())),
    [],
  );
  const sleep = useCallback(
    (ms: number) => new Promise<void>((done) => setTimeout(() => done(), ms)),
    [],
  );

  const snap = useCallback((why: string) => {
    const box = model.rec.current;
    if (!box) return;
    const next = {
      why,
      at: Date.now(),
      host_w: Math.round(box.el.clientWidth),
      host_h: Math.round(box.el.clientHeight),
      cols: box.term.cols,
      rows: box.term.rows,
    };
    model.probe.current.last_size = next;
    model.probe.current.sizes = [...model.probe.current.sizes.slice(-23), next];
  }, [model.probe, model.rec]);

  const size = useCallback(async () => {
    const session = model.cur();
    const box = model.rec.current;
    if (!session || !box) return;
    snap("before-fit");
    box.fit.fit();
    snap("after-fit");
    if (box.term.cols === box.cols && box.term.rows === box.rows) return;
    box.cols = box.term.cols;
    box.rows = box.term.rows;
    snap("after-size");
    await window.api.resize({ id: session.id, cols: box.cols, rows: box.rows });
  }, [model.cur, model.rec, snap]);

  const settle = useCallback(async (left = 8, gap = 80, why = "settle") => {
    const box = model.rec.current;
    if (!box) return;
    await tick();
    await size();
    if (box.rows > 0) box.term.refresh(0, box.rows - 1);
    snap(why);
    if (left <= 1) return;
    await sleep(gap);
    await settle(left - 1, gap, why);
  }, [model.rec, size, sleep, snap, tick]);

  const refresh = useCallback((focus = false) => {
    const box = model.rec.current;
    if (!box) return;
    box.focus ||= focus;
    if (box.raf !== null) return;
    box.raf = requestAnimationFrame(() => {
      const node = model.rec.current;
      if (!node) return;
      node.raf = null;
      if (document.visibilityState === "hidden") return;
      void size().catch((err) => fail("Resize failed", err));
      if (node.rows > 0) node.term.refresh(0, node.rows - 1);
      if (model.loadRef.current) model.setLoad(false);
      if (!node.focus) return;
      node.focus = false;
      void aim();
    });
  }, [aim, fail, model.loadRef, model.rec, model.setLoad, size]);

  const mount = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    model.host.current = el;
    model.probe.current.host = el;
    queueMicrotask(() => {
      if (model.host.current !== el) return;
      try {
        const box = model.rec.current;
        if (box) {
          model.setLoad(true);
          box.el = el;
          box.el.tabIndex = -1;
          box.obs?.disconnect();
        box.obs = new ResizeObserver(() => {
          snap("observer");
          refresh();
        });
        box.obs.observe(el);
        model.setLoad(false);
        paint(model.cur());
        refresh(true);
        return;
        }

        const cfg = style(model.prefsRef.current, model.tuiRef.current);
        model.setLoad(true);
        el.tabIndex = -1;
        const term = new Terminal({
          allowProposedApi: false,
          fontSize: model.prefsRef.current.font_size,
          macOptionIsMeta: true,
          scrollback: 5000,
          theme: cfg.term,
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
        model.rec.current = {
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
        model.setLoad(false);
        paint(model.cur());
        refresh(true);
      } catch (err) {
        model.setLoad(false);
        fail("Mount failed", err);
      }
    });
  }, [
    model.cur,
    model.host,
    model.prefsRef,
    model.probe,
    model.rec,
    model.setLoad,
    model.tuiRef,
    paint,
    refresh,
    send,
    snap,
  ]);

  return { paint, sync, aim, send, dispose, tick, snap, size, settle, refresh, mount };
}

export type Core = ReturnType<typeof useTermCore>;
