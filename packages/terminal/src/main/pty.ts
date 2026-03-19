import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as pty from "node-pty";
import { app } from "electron";

import type { Create, Event, Host, Session, Snapshot } from "../shared/api";
import { defaultDir, dirs, prefs, pushDir, write } from "./store";

const root = dirname(fileURLToPath(import.meta.url));
const cap = 200_000;

type Live = {
  proc: pty.IPty | null;
  session: Session;
};

type Size = {
  cols: number;
  rows: number;
};

type Deps = {
  send: (event: Event) => void;
  dirs?: (dirs: string[]) => void;
  host: () => Promise<{ url: string; password: string }>;
};

export class Sessions {
  private live: Live | null = null;
  private host: Host | null = null;
  private idx = 0;
  private init: Create | undefined;
  private seed = true;
  private size: Size = { cols: 80, rows: 24 };

  constructor(
    private deps: Deps,
    input?: Create,
  ) {
    this.init = input;
  }

  async boot() {
    if (!this.live && this.seed) await this.create(this.init);
    this.seed = false;
    this.init = undefined;
    return {
      list: this.live ? [copy(this.live.session)] : [],
      active: this.live?.session.id ?? null,
      dirs: dirs(),
      prefs: prefs(),
      host: this.host,
    } satisfies Snapshot;
  }

  async create(input?: Create) {
    if (this.live) return copy(this.live.session);
    const id = crypto.randomUUID();
    const live = await this.spawn(id, input?.cwd ?? null, this.next());
    this.live = live;
    this.emit(live.session, true);
    return copy(live.session);
  }

  async close(id: string) {
    if (this.live?.session.id !== id) return;
    const live = this.live;
    this.live = null;
    live.proc?.kill();
    this.deps.send({ type: "remove", id, active: null });
  }

  async restart(id: string) {
    const prev = this.live;
    if (!prev || prev.session.id !== id)
      throw new Error(`Unknown session: ${id}`);
    prev.proc?.kill();
    const next = await this.spawn(id, prev.session.cwd, prev.session.idx);
    this.live = next;
    this.emit(next.session);
    return copy(next.session);
  }

  async focus(id: string) {
    if (this.live?.session.id !== id) return;
    this.emit(this.live.session);
  }

  async nextTab() {}

  async prevTab() {}

  async input(id: string, data: string) {
    if (this.live?.session.id !== id) return;
    try {
      this.live.proc?.write(data);
    } catch (err) {
      write("session.write.fail", {
        id,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  current() {
    return this.live?.session.id ?? null;
  }

  session() {
    return this.live ? copy(this.live.session) : null;
  }

  async resize(id: string, cols: number, rows: number) {
    if (this.live?.session.id !== id || cols < 1 || rows < 1) return;
    this.size = { cols, rows };
    write("session.resize", {
      id,
      cols,
      rows,
    });
    try {
      this.live.proc?.resize(cols, rows);
    } catch (err) {
      write("session.resize.fail", {
        id,
        cols,
        rows,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  menu(id: string) {
    this.deps.send({ type: "menu", id });
  }

  dispose() {
    const live = this.live;
    this.live = null;
    live?.proc?.kill();
  }

  private next() {
    this.idx += 1;
    return this.idx;
  }

  private async spawn(id: string, input: string | null, idx: number) {
    const cwd = dir(input);
    const session: Session = {
      id,
      idx,
      title: `Session ${idx}`,
      cwd,
      pid: null,
      state: "starting",
      exit_code: null,
      note: null,
      buffer: "",
    };

    const host = await this.deps.host().catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      write("host.ensure.fail", { id, cwd, err: msg });
      return null;
    });
    this.host = host ? hostInfo(host.url) : null;
    const cmd = host ? launch(cwd, host) : null;
    if (!cmd) {
      const bin = process.env.SYMBOLIC_BIN_PATH ?? packaged();
      session.state = "failed";
      session.note = app.isPackaged
        ? "Missing shared symbolic host runtime"
        : "Missing Bun runtime for shared symbolic host";
      write("session.launch.missing", {
        id,
        cwd,
        packaged: app.isPackaged,
        bun: bun(),
        bin,
        host: host?.url ?? null,
      });
      return { proc: null, session };
    }

    write("session.spawn", {
      id,
      cwd,
      file: cmd.file,
      args: cmd.args,
      launch_cwd: cmd.cwd,
      cols: this.size.cols,
      rows: this.size.rows,
      path: cmd.env.PATH,
    });

    const res = spawn(cmd, this.size);
    if (!res.proc) {
      session.state = "failed";
      session.note = `Failed to launch ${cmd.file}`;
      write("session.spawn.fail", {
        id,
        cwd,
        file: cmd.file,
        err: res.err,
      });
      return { proc: null, session };
    }

    const proc = res.proc;
    if (this.size.cols > 0 && this.size.rows > 0) {
      try {
        proc.resize(this.size.cols, this.size.rows);
      } catch (err) {
        write("session.spawn.resize.fail", {
          id,
          cols: this.size.cols,
          rows: this.size.rows,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }
    session.pid = proc.pid;
    session.state = "running";
    session.note = null;
    this.deps.dirs?.(pushDir(cwd));

    proc.onData((data: string) => {
      const live = this.live;
      if (!live || live.proc !== proc || live.session.id !== id) return;
      live.session.buffer = joinBuffer(live.session.buffer, data);
      this.deps.send({ type: "data", id, data });
    });

    proc.onExit(
      ({ exitCode, signal }: { exitCode: number; signal?: number }) => {
        const live = this.live;
        if (!live || live.proc !== proc || live.session.id !== id) return;
        live.proc = null;
        live.session.pid = null;
        live.session.exit_code = exitCode;
        live.session.state = exitCode === 0 ? "exited" : "failed";
        live.session.note = signal
          ? `signal ${signal}`
          : exitCode === 0
            ? null
            : `exit ${exitCode}`;
        write("session.exit", {
          id,
          cwd: live.session.cwd,
          exit_code: exitCode,
          signal: signal ?? null,
        });
        this.emit(live.session);
      },
    );

    return { proc, session };
  }

  private emit(session: Session, withDirs = false) {
    this.deps.send({
      type: "update",
      session: copy(session),
      active: this.live?.session.id ?? null,
      host: this.host,
      ...(withDirs ? { dirs: dirs() } : {}),
    });
  }
}

function copy(session: Session) {
  return { ...session };
}

function joinBuffer(buffer: string, data: string) {
  return `${buffer}${data}`.slice(-cap);
}

function hostInfo(url: string): Host | null {
  try {
    const next = new URL(url);
    return {
      url: next.toString(),
      port: Number(next.port || (next.protocol === "https:" ? 443 : 80)),
    };
  } catch {
    return null;
  }
}

function launch(cwd: string, host: { url: string; password: string }) {
  const env = {
    ...process.env,
    PATH: path(),
    PWD: cwd,
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    TERM_PROGRAM: "Symbolic Terminal",
    SYMBOLIC_TERMINAL: "1",
    SYMBOLIC_SERVER_PASSWORD: host.password,
  };

  if (!app.isPackaged) {
    const file = bun();
    if (!file) return null;
    return {
      file,
      args: [
        "run",
        "--conditions=browser",
        "./src/index.ts",
        "attach",
        host.url,
        `--dir=${cwd}`,
        `--password=${host.password}`,
      ],
      env,
      cwd: repo("packages/symbolic"),
    };
  }

  const file = existsSync(process.env.SYMBOLIC_BIN_PATH ?? "")
    ? process.env.SYMBOLIC_BIN_PATH!
    : packaged();
  if (!existsSync(file)) return null;
  return {
    file,
    args: ["attach", host.url, `--dir=${cwd}`, `--password=${host.password}`],
    env,
    cwd,
  };
}

function spawn(
  cmd: {
    file: string;
    args: string[];
    env: Record<string, string | undefined>;
    cwd: string;
  },
  size: Size,
) {
  try {
    return {
      proc: pty.spawn(cmd.file, cmd.args, {
        cwd: cmd.cwd,
        cols: size.cols,
        rows: size.rows,
        name: "xterm-256color",
        env: cmd.env,
      }),
      err: null,
    };
  } catch (err) {
    return {
      proc: null,
      err: err instanceof Error ? err.message : String(err),
    };
  }
}

function bun() {
  const hits = [
    process.env.BUN,
    ...path().split(delimiter),
    join(homedir(), ".bun", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ].flatMap((dir) => {
    if (!dir) return [];
    const file = dir.endsWith("/bun") ? dir : join(dir, bin("bun"));
    return existsSync(file) ? [file] : [];
  });

  return hits[0] ?? null;
}

function path() {
  const base = process.env.PATH?.split(delimiter) ?? [];
  const list = [
    ...base,
    join(homedir(), ".bun", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
  ];
  return [...new Set(list.filter(Boolean))].join(delimiter);
}

function repo(...parts: string[]) {
  return join(root, "../../../../", ...parts);
}

function packaged() {
  const root = join(process.resourcesPath, "symbolic");
  const direct = join(root, bin());
  if (!existsSync(root)) return direct;
  if (existsSync(direct)) return direct;

  for (const name of names()) {
    const file = join(root, name, "bin", bin());
    if (existsSync(file)) return file;
  }

  return direct;
}

function dir(input: string | null) {
  const list = [input, defaultDir(), app.getPath("home"), homedir()];
  for (const item of list) {
    if (!item) continue;
    if (existsSync(item)) return item;
  }
  return homedir();
}

function names() {
  const os = process.platform === "win32" ? "windows" : process.platform;
  const base = `symbolic-${os}-${process.arch}`;
  if (process.arch === "x64") return [base, `${base}-baseline`];
  return [base];
}

function bin(name = "symbolic") {
  return process.platform === "win32" ? `${name}.exe` : name;
}
