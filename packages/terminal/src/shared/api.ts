export type State = "starting" | "running" | "exited" | "failed";

export type Theme = "system" | "light" | "dark";

export type CwdMode = "recent" | "home";

export type Prefs = {
  cwd_mode: CwdMode;
  font_size: number;
  theme: Theme;
};

export type Diag = {
  path: string;
  tail: string;
};

export type Host = {
  url: string;
  port: number;
};

export type Session = {
  id: string;
  idx: number;
  title: string;
  cwd: string;
  pid: number | null;
  state: State;
  exit_code: number | null;
  note: string | null;
  buffer: string;
};

export type Snapshot = {
  list: Session[];
  active: string | null;
  dirs: string[];
  prefs: Prefs;
  host: Host | null;
};

export type Create = {
  cwd?: string | null;
};

export type Input = {
  id: string;
  data: string;
};

export type Size = {
  id: string;
  cols: number;
  rows: number;
};

export type Event =
  | {
      type: "data";
      id: string;
      data: string;
    }
  | {
      type: "update";
      session: Session;
      active: string | null;
      dirs?: string[];
      host?: Host | null;
    }
  | {
      type: "remove";
      id: string;
      active: string | null;
    }
  | {
      type: "menu";
      id: string;
    };

export type Api = {
  boot: () => Promise<Snapshot>;
  create: (input?: Create) => Promise<Session>;
  close: (id: string) => Promise<void>;
  restart: (id: string) => Promise<Session>;
  focus: (id: string) => Promise<void>;
  next: () => Promise<void>;
  prev: () => Promise<void>;
  input: (input: Input) => Promise<void>;
  resize: (input: Size) => Promise<void>;
  pick_dir: (dir?: string | null) => Promise<string | null>;
  get_prefs: () => Promise<Prefs>;
  set_prefs: (input: Partial<Prefs>) => Promise<Prefs>;
  get_diag: () => Promise<Diag>;
  on: (cb: (event: Event) => void) => () => void;
};
