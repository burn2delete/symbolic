import { app } from "electron";

import type { Create, Session } from "../shared/api";
import { pick } from "./main-apps";
import { bun, dir, hostInfo, joinBuffer, launch, packaged, shell, spawn as run, vars } from "./pty-utils";
import type { Deps, State } from "./pty-session";
import { pushDir, write } from "./store";

export async function spawn(
  s: State,
  d: Deps,
  id: string,
  input: Create | undefined,
  idx: number,
) {
  const cwd = dir(input?.cwd ?? null);
  const item = pick(input?.launch);
  const session: Session = {
    id,
    idx,
    title: `Session ${idx}`,
    cwd,
    launch: item,
    pid: null,
    state: "starting",
    exit_code: null,
    note: null,
    buffer: "",
  };

  if (item.id !== "symbolic" && item.cmd) {
    return cli(s, d, session, item.cmd);
  }

  const host = await d.host().catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    write("host.ensure.fail", { id, cwd, err: msg });
    return null;
  });
  s.host = host ? hostInfo(host.url) : null;
  const cmd = host ? launch(cwd, host) : null;
  if (!cmd) {
    session.state = "failed";
    session.note = app.isPackaged
      ? "Missing shared symbolic host runtime"
      : "Missing Bun runtime for shared symbolic host";
    write("session.launch.missing", {
      id,
      cwd,
      packaged: app.isPackaged,
      bun: bun(),
      bin: process.env.SYMBOLIC_BIN_PATH ?? packaged(),
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
    cols: s.size.cols,
    rows: s.size.rows,
    path: cmd.env.PATH,
  });

  const res = run(cmd, s.size);
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
  if (s.size.cols > 0 && s.size.rows > 0) {
    try {
      proc.resize(s.size.cols, s.size.rows);
    } catch (err) {
      write("session.spawn.resize.fail", {
        id,
        cols: s.size.cols,
        rows: s.size.rows,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }
  session.pid = proc.pid;
  session.state = "running";
  session.note = null;
  d.dirs?.(pushDir(cwd, item));

  proc.onData((data: string) => {
    const live = view(s, id);
    if (!live || live.proc !== proc) return;
    live.session.buffer = joinBuffer(live.session.buffer, data);
    d.send({ type: "data", id, data });
  });

  proc.onExit(({ exitCode, signal }: { exitCode: number; signal?: number }) => {
    const live = view(s, id);
    if (!live || live.proc !== proc) return;
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
    d.send({
      type: "update",
      session: { ...live.session },
      active: s.active,
      host: s.host,
    });
  });

  return { proc, session };
}

function cli(
  s: State,
  d: Deps,
  session: Session,
  cmd: string,
) {
  const next = {
    ...shell(cmd),
    cwd: session.cwd,
    env: vars(session.cwd),
  };

  write("session.spawn", {
    id: session.id,
    cwd: session.cwd,
    file: next.file,
    args: next.args,
    launch_cwd: next.cwd,
    cols: s.size.cols,
    rows: s.size.rows,
    path: next.env.PATH,
    app: session.launch.id,
  });

  const res = run(next, s.size);
  if (!res.proc) {
    session.state = "failed";
    session.note = `Failed to launch ${session.launch.name}`;
    write("session.spawn.fail", {
      id: session.id,
      cwd: session.cwd,
      file: next.file,
      err: res.err,
      app: session.launch.id,
    });
    return { proc: null, session };
  }

  session.pid = res.proc.pid;
  session.state = "running";
  d.dirs?.(pushDir(session.cwd, session.launch));

  res.proc.onData((data: string) => {
    const live = view(s, session.id);
    if (!live || live.proc !== res.proc) return;
    live.session.buffer = joinBuffer(live.session.buffer, data);
    d.send({ type: "data", id: session.id, data });
  });

  res.proc.onExit(({ exitCode, signal }: { exitCode: number; signal?: number }) => {
    const live = view(s, session.id);
    if (!live || live.proc !== res.proc) return;
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
      id: session.id,
      cwd: live.session.cwd,
      exit_code: exitCode,
      signal: signal ?? null,
    });
    d.send({
      type: "update",
      session: { ...live.session },
      active: s.active,
      host: s.host,
    });
  });

  return { proc: res.proc, session };
}

function view(s: State, id: string | null) {
  return s.list.find((item) => item.session.id === id) ?? null;
}
