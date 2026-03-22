import { useCallback } from "react";

import { useTermActions } from "./use-term-actions";
import { useTermCore } from "./use-term-core";
import { useTermEffects } from "./use-term-effects";
import { useTermModel } from "./use-term-model";

export function useTerm() {
  const model = useTermModel();
  const fail = useCallback(
    (msg: string, err?: unknown) => {
      const tail = err instanceof Error ? `: ${err.message}` : "";
      model.setErr(`${msg}${tail}`);
    },
    [model.setErr],
  );
  const core = useTermCore(model, fail);
  const act = useTermActions(model, core, fail);

  useTermEffects(model, core, act, fail);

  return {
    mac: model.mac,
    list: model.list,
    now: model.now,
    recent: model.recent,
    hostText: model.hostText,
    tip: model.tip,
    proc: model.proc,
    prefs: model.prefs,
    tui: model.tui,
    apps: model.apps,
    customs: model.customs,
    customsReady: model.customsReady,
    diag: model.diag,
    frame: model.frame,
    side: model.side,
    load: model.load,
    panel: model.panel,
    setPanel: model.setPanel,
    setSide: model.setSide,
    mount: model.setNode,
    flip: act.flip,
    choose: act.choose,
    focus: act.focus,
    remove: act.remove,
    restart: act.restart,
    open: act.open,
    add: act.add,
    loadApps: act.loadApps,
    loadCustoms: act.loadCustoms,
    saveCustoms: act.saveCustoms,
    loadDiag: act.loadDiag,
    save: act.save,
    setSkin: act.setSkin,
    setColor: act.setColor,
  };
}

export type App = ReturnType<typeof useTerm>;
