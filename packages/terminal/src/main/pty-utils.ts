import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { app } from "electron";
import * as pty from "node-pty";

import type { Host, Session } from "../shared/api";
import { defaultDir } from "./store";

const cap = 200_000;

export function copy(session: Session) {
  return { ...session };
}

export function joinBuffer(buffer: string, data: string) {
  return `${buffer}${data}`.slice(-cap);
}

export function hostInfo(url: string): Host | null {
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

export function dir(input: string | null) {
  const list = [input, defaultDir(), app.getPath("home"), homedir()];
  for (const item of list) {
    if (!item) continue;
    if (existsSync(item)) return item;
  }
  return homedir();
}

export function launch(cwd: string, host: { url: string; password: string }) {
  const env = vars(cwd, {
    SYMBOLIC_SERVER_PASSWORD: host.password,
  });

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

export function vars(
  cwd: string,
  extra?: Record<string, string | undefined>,
) {
  return {
    ...process.env,
    PATH: path(),
    PWD: cwd,
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    TERM_PROGRAM: "Symbolic Terminal",
    SYMBOLIC_TERMINAL: "1",
    ...extra,
  };
}

export function shell(cmd: string) {
  if (process.platform === "win32") {
    return {
      file: process.env.ComSpec ?? "cmd.exe",
      args: ["/d", "/s", "/c", cmd],
    };
  }
  return {
    file: process.env.SHELL || "/bin/zsh",
    args: ["-lc", `exec ${cmd}`],
  };
}

export function spawn(
  cmd: {
    file: string;
    args: string[];
    env: Record<string, string | undefined>;
    cwd: string;
  },
  size: { cols: number; rows: number },
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

export function bun() {
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
  return join(root(), "../../../../", ...parts);
}

export function packaged() {
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

function names() {
  const os = process.platform === "win32" ? "windows" : process.platform;
  const base = `symbolic-${os}-${process.arch}`;
  if (process.arch === "x64") return [base, `${base}-baseline`];
  return [base];
}

function bin(name = "symbolic") {
  return process.platform === "win32" ? `${name}.exe` : name;
}

function root() {
  return dirname(fileURLToPath(import.meta.url));
}
