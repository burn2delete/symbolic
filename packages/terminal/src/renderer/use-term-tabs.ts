import { useCallback } from "react";

import type { Custom, Launch, Recent } from "../shared/api";
import { choice, symbolic } from "../shared/launch";
import type { Model } from "./use-term-model";

type Fail = (msg: string, err?: unknown) => void;

export function useTermTabs(model: Model, fail: Fail) {
  const create = useCallback(
    async (cwd?: string | null, launch: Launch = symbolic) => {
      model.setErr(null);
      model.setBusy(cwd ? "Opening folder" : "Opening window");
      try {
        await window.api.create(cwd ? { cwd, launch } : { launch });
      } catch (err) {
        fail("Could not create session", err);
      } finally {
        model.setBusy(null);
      }
    },
    [fail, model.setBusy, model.setErr],
  );

  const tab = useCallback(
    async (cwd: string, launch: Launch = symbolic) => {
      model.setErr(null);
      model.setBusy("Opening tab");
      model.setLoad(true);
      try {
        model.setDirs((list) => [
          { cwd, launch },
          ...list.filter((item) => item.cwd !== cwd),
        ]);
        await window.api.tab({ cwd, launch });
      } catch (err) {
        model.setLoad(false);
        fail("Could not create tab", err);
      } finally {
        model.setBusy(null);
      }
    },
    [fail, model.setBusy, model.setDirs, model.setErr, model.setLoad],
  );

  const open = useCallback(async () => {
    model.setErr(null);
    const dir = await window.api.pick_dir(
      model.cur()?.cwd ?? model.dirsRef.current[0]?.cwd ?? null,
    );
    if (!dir) return;
    model.setDirs((list) => [
      { cwd: dir, launch: symbolic },
      ...list.filter((item) => item.cwd !== dir),
    ]);
    await create(dir);
  }, [create, model.cur, model.dirsRef, model.setDirs, model.setErr]);

  const add = useCallback(
    async (launch: Launch = symbolic) => {
      model.setErr(null);
      const dir = await window.api.pick_dir(
        model.cur()?.cwd ?? model.dirsRef.current[0]?.cwd ?? null,
      );
      if (!dir) return;
      await tab(dir, launch);
    },
    [model.cur, model.dirsRef, model.setErr, tab],
  );

  const choose = useCallback(
    async (item: Recent | string) => {
      const next =
        typeof item === "string" ? { cwd: item, launch: symbolic } : item;
      await tab(next.cwd, next.launch);
    },
    [tab],
  );

  const loadApps = useCallback(async () => {
    try {
      model.setApps(await window.api.apps());
    } catch (err) {
      fail("Could not load tab apps", err);
    }
  }, [fail, model.setApps]);

  const loadCustoms = useCallback(async () => {
    try {
      model.setCustoms(await window.api.get_customs());
      model.setCustomsReady(true);
    } catch (err) {
      fail("Could not load tab apps", err);
    }
  }, [fail, model.setCustoms, model.setCustomsReady]);

  const saveCustoms = useCallback(
    async (input: Custom[]) => {
      try {
        const next = await window.api.set_customs(input);
        model.setCustoms(next);
        model.setCustomsReady(true);
        model.setApps((list) => [
          ...list.filter((item) => item.built),
          ...next.map(choice),
        ]);
      } catch (err) {
        fail("Could not save tab apps", err);
      }
    },
    [fail, model.setApps, model.setCustoms, model.setCustomsReady],
  );

  return {
    create,
    tab,
    open,
    add,
    choose,
    loadApps,
    loadCustoms,
    saveCustoms,
  };
}

export type Tabs = ReturnType<typeof useTermTabs>;
