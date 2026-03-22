import type { Create } from "../shared/api";
import {
  boot,
  create,
  cwd,
  current,
  dispose,
  focus,
  input,
  menu,
  nextTab,
  prevTab,
  remove,
  restart,
  resize,
  session,
  State,
} from "./pty-session";

export class Sessions {
  private state: State = {
    list: [],
    host: null,
    active: null,
    idx: 0,
    init: undefined,
    ready: null,
    seed: true,
    size: { cols: 80, rows: 24 },
  };

  constructor(
    private deps: {
      send: (event: import("../shared/api").Event) => void;
      dirs?: (dirs: import("../shared/api").Recent[]) => void;
      host: () => Promise<{ url: string; password: string }>;
      title?: (session: import("../shared/api").Session | null) => void;
    },
    input?: Create,
  ) {
    this.state.init = input;
  }

  boot() {
    return boot(this.state, this.deps);
  }

  create(input?: Create) {
    return create(this.state, this.deps, input);
  }

  remove(id: string) {
    return remove(this.state, this.deps, id);
  }

  restart(id: string) {
    return restart(this.state, this.deps, id);
  }

  focus(id: string) {
    return focus(this.state, this.deps, id);
  }

  nextTab() {
    return nextTab(this.state, this.deps);
  }

  prevTab() {
    return prevTab(this.state, this.deps);
  }

  input(id: string, data: string) {
    return input(this.state, this.deps, id, data);
  }

  current() {
    return current(this.state);
  }

  session() {
    return session(this.state);
  }

  cwd() {
    return cwd(this.state);
  }

  resize(id: string, cols: number, rows: number) {
    return resize(this.state, this.deps, id, cols, rows);
  }

  menu(id: string) {
    menu(this.deps, id);
  }

  dispose() {
    dispose(this.state);
  }
}
