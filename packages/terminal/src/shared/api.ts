export type State = "starting" | "running" | "exited" | "failed";

export type Theme = "system" | "light" | "dark";
export type Skin = "warm" | "glass";
export type Color = "local" | "symbolic";
export type StatusOpen = "bottom" | "sidebar";

export type CwdMode = "recent" | "home";

export type Launch = {
  id: string;
  name: string;
  cmd: string | null;
};

export type Custom = {
  id: string;
  name: string;
  cmd: string;
};

export type Choice = Launch & {
  ok: boolean;
  built: boolean;
};

export type Prefs = {
  cwd_mode: CwdMode;
  font_size: number;
  theme: Theme;
  skin: Skin;
  color: Color;
  status_closed: boolean;
  status_open: StatusOpen;
};

export type TuiTone = {
  primary: string;
  secondary: string;
  accent: string;
  error: string;
  warning: string;
  success: string;
  info: string;
  text: string;
  textMuted: string;
  background: string;
  backgroundPanel: string;
  backgroundElement: string;
  border: string;
  borderActive: string;
  borderSubtle: string;
};

export type Tui = {
  name: string;
  dark: TuiTone;
  light: TuiTone;
};

export type Diag = {
  path: string;
  tail: string;
};

export type Host = {
  url: string;
  port: number;
};

export type Frame = {
  full: boolean;
  lights: boolean;
};

export type Session = {
  id: string;
  idx: number;
  title: string;
  cwd: string;
  launch: Launch;
  pid: number | null;
  state: State;
  exit_code: number | null;
  note: string | null;
  buffer: string;
};

export type Recent = {
  cwd: string;
  launch: Launch;
};

export type Snapshot = {
  list: Session[];
  active: string | null;
  dirs: Recent[];
  prefs: Prefs;
  host: Host | null;
  frame?: Frame;
  tui?: Tui | null;
};

export type Seed = {
  prefs: Prefs;
  frame: Frame;
  tui: Tui | null;
};

export type Create = {
  cwd?: string | null;
  launch?: Launch;
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
      dirs?: Recent[];
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
    }
  | {
      type: "frame";
      frame: Frame;
    }
  | {
      type: "prefs";
      prefs: Prefs;
    }
  | {
      type: "tui";
      tui: Tui | null;
    };

export type Api = {
  seed: () => Promise<Seed>;
  boot: () => Promise<Snapshot>;
  create: (input?: Create) => Promise<Session>;
  tab: (input?: Create) => Promise<Session>;
  close: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  restart: (id: string) => Promise<Session>;
  focus: (id: string) => Promise<void>;
  next: () => Promise<void>;
  prev: () => Promise<void>;
  input: (input: Input) => Promise<void>;
  resize: (input: Size) => Promise<void>;
  pick_dir: (dir?: string | null) => Promise<string | null>;
  apps: () => Promise<Choice[]>;
  get_customs: () => Promise<Custom[]>;
  set_customs: (input: Custom[]) => Promise<Custom[]>;
  get_prefs: () => Promise<Prefs>;
  set_prefs: (input: Partial<Prefs>) => Promise<Prefs>;
  get_diag: () => Promise<Diag>;
  on: (cb: (event: Event) => void) => () => void;
};
