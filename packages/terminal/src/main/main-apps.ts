import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

import type { Choice, Launch } from "../shared/api";
import { choice, stock, symbolic } from "../shared/launch";
import { customs } from "./store";

let seen: Choice[] | null = null;

export function apps() {
  return [...scan(), ...customs().map(choice)];
}

export function pick(input?: Launch) {
  if (!input || input.id === symbolic.id || !text(input.cmd)) return symbolic;
  return {
    id: text(input.id) ?? crypto.randomUUID(),
    name: text(input.name) ?? "Custom",
    cmd: text(input.cmd),
  } satisfies Launch;
}

function scan() {
  if (seen) return seen;
  seen = stock.map((item) => {
    if (item.id === symbolic.id) return item;
    const cmd = run(item.id);
    if (!cmd) return item;
    return { ...item, cmd, ok: true } satisfies Choice;
  });
  return seen;
}

function run(id: string) {
  if (id === "copilot") {
    const hit = find(["copilot", "github-copilot-cli"]);
    if (hit) return hit;
    const gh = where("gh");
    if (!gh || !copilot(gh)) return null;
    return "gh copilot";
  }
  return find(list(id));
}

function list(id: string) {
  if (id === "claude") return ["claude", "claude-code"];
  if (id === "gemini") return ["gemini", "gemini-cli"];
  if (id === "ghosty") return ["ghosty", "ghosty-terminal"];
  return [id];
}

function find(list: string[]) {
  return list.find((item) => !!where(item)) ?? null;
}

function copilot(file: string) {
  try {
    return /\bgh-copilot\b|\bcopilot\b/i.test(
      execFileSync(file, ["extension", "list"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 1500,
      }),
    );
  } catch {
    return false;
  }
}

function where(name: string) {
  const ext = process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  for (const dir of path().split(delimiter)) {
    if (!dir) continue;
    for (const bit of ext) {
      const file = join(dir, name.endsWith(bit) ? name : `${name}${bit}`);
      if (existsSync(file)) return file;
    }
  }
  return null;
}

function path() {
  return [
    process.env.PATH,
    join(homedir(), ".bun", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
  ]
    .flatMap((item) => (item ? item.split(delimiter) : []))
    .filter(Boolean)
    .filter((item, idx, list) => list.indexOf(item) === idx)
    .join(delimiter);
}

function text(input: unknown) {
  if (typeof input !== "string") return null;
  const item = input.trim();
  return item ? item : null;
}
