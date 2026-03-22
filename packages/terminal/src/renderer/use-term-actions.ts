import { useCallback } from "react";

import type { Color, Prefs, Skin } from "../shared/api";

import { label, pick } from "./term-util";
import type { Core } from "./use-term-core";
import { useTermMenu } from "./use-term-menu";
import type { Model } from "./use-term-model";
import { useTermTabs } from "./use-term-tabs";

type Fail = (msg: string, err?: unknown) => void;

export function useTermActions(model: Model, core: Core, fail: Fail) {
  const tab = useTermTabs(model, fail);

  const close = useCallback(async () => {
    const session = model.cur();
    if (!session) return;
    model.setErr(null);
    model.setBusy(`Closing ${label(session)}`);
    try {
      await window.api.close(session.id);
    } catch (err) {
      fail("Could not close session", err);
    } finally {
      model.setBusy(null);
    }
  }, [fail, model.cur, model.setBusy, model.setErr]);

  const requestClose = useCallback(async () => {
    const run = model.listRef.current.filter((item) => model.live(item.state));
    if (run.length > 0) {
      const text =
        run.length === 1
          ? `Close ${label(run[0])}? This window is still running.`
          : `Close this window? ${run.length} sessions are still running.`;
      if (!window.confirm(text)) return;
    }
    await close();
  }, [close, model.listRef, model.live]);

  const restart = useCallback(async (id?: string) => {
    const session = pick(model.listRef.current, id ?? model.activeRef.current);
    if (!session) return;
    model.setErr(null);
    model.setBusy("Restarting session");
    try {
      if (session.id !== model.activeRef.current) {
        core.sync(await window.api.restart(session.id), model.activeRef.current ?? session.id);
        return;
      }
      const el = model.host.current ?? model.rec.current?.el ?? null;
      model.setLoad(true);
      core.dispose();
      core.sync(await window.api.restart(session.id), session.id);
      if (el) {
        core.mount(el);
        await core.tick();
        await core.size();
      }
      await core.settle(10, 100, "restart");
    } catch (err) {
      fail("Could not restart session", err);
    } finally {
      model.setBusy(null);
    }
  }, [
    core.dispose,
    core.mount,
    core.settle,
    core.size,
    core.sync,
    core.tick,
    fail,
    model.activeRef,
    model.host,
    model.listRef,
    model.rec,
    model.setBusy,
    model.setErr,
    model.setLoad,
  ]);

  const focus = useCallback(async (id: string) => {
    if (id === model.activeRef.current) {
      core.refresh(true);
      return;
    }
    model.setErr(null);
    model.setLoad(true);
    try {
      await window.api.focus(id);
    } catch (err) {
      model.setLoad(false);
      fail("Could not switch tabs", err);
    }
  }, [core.refresh, fail, model.activeRef, model.setErr, model.setLoad]);

  const remove = useCallback(async (id: string) => {
    const session = pick(model.listRef.current, id);
    if (!session) return;
    if (model.live(session.state) && !window.confirm(`Close ${label(session)}? This session is still running.`))
      return;
    model.setErr(null);
    model.setBusy(`Closing ${label(session)}`);
    try {
      await window.api.remove(id);
    } catch (err) {
      fail("Could not close tab", err);
    } finally {
      model.setBusy(null);
    }
  }, [fail, model.listRef, model.live, model.setBusy, model.setErr]);

  const save = useCallback(async (next: Partial<Prefs>) => {
    model.setErr(null);
    try {
      model.setPrefs(await window.api.set_prefs(next));
    } catch (err) {
      fail("Could not save settings", err);
    }
  }, [fail, model.setErr, model.setPrefs]);

  const setSkin = useCallback((skin: Skin) => {
    model.setPrefs((prefs) => ({ ...prefs, skin }));
    void save({ skin });
  }, [model.setPrefs, save]);

  const setColor = useCallback((color: Color) => {
    model.setPrefs((prefs) => ({ ...prefs, color }));
    void save({ color });
  }, [model.setPrefs, save]);

  const flip = useCallback(() => {
    const theme =
      model.prefsRef.current.theme === "system"
        ? "light"
        : model.prefsRef.current.theme === "light"
          ? "dark"
          : "system";
    void save({ theme });
  }, [model.prefsRef, save]);

  const loadDiag = useCallback(async () => {
    model.setErr(null);
    model.setBusy("Loading diagnostics");
    try {
      model.setDiag(await window.api.get_diag());
    } catch (err) {
      fail("Could not load diagnostics", err);
    } finally {
      model.setBusy(null);
    }
  }, [fail, model.setBusy, model.setDiag, model.setErr]);

  const copy = useCallback(async () => {
    const text = model.rec.current?.term.getSelection();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch (err) {
      fail("Copy failed", err);
    }
  }, [fail, model.rec]);

  const paste = useCallback(async () => {
    try {
      const data = await navigator.clipboard.readText();
      if (!data) return;
      await core.send(data, "paste");
    } catch (err) {
      fail("Paste failed", err);
    }
  }, [core.send, fail]);

  const select = useCallback(() => {
    model.rec.current?.term.selectAll();
  }, [model.rec]);

  const refresh = useCallback(() => {
    core.refresh(true);
  }, [core.refresh]);

  const menu = useTermMenu(
    { active: model.activeRef, panel: model.setPanel },
    {
      create: tab.create,
      add: tab.add,
      open: tab.open,
      diag: loadDiag,
      choose: tab.choose,
      remove,
      close: requestClose,
      restart,
      refresh,
      copy,
      paste,
      select,
    },
  );

  return {
    create: tab.create,
    tab: tab.tab,
    close,
    requestClose,
    restart,
    open: tab.open,
    add: tab.add,
    choose: tab.choose,
    focus,
    remove,
    loadApps: tab.loadApps,
    loadCustoms: tab.loadCustoms,
    saveCustoms: tab.saveCustoms,
    save,
    setSkin,
    setColor,
    flip,
    loadDiag,
    copy,
    paste,
    select,
    menu,
  };
}

export type Act = ReturnType<typeof useTermActions>;
