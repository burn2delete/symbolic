import { readdir, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { basename, join } from "node:path";

import { root } from "./smoke-paths.mjs";
import { seed } from "./smoke-proc.mjs";

export async function pickZip() {
  const dir = join(root, "dist");
  const list = (await readdir(dir))
    .filter(
      (file) =>
        file.startsWith("symbolic-terminal-mac-") && file.endsWith(".zip"),
    )
    .sort();
  const zip = list.at(-1);
  if (!zip) throw new Error("missing mac zip in packages/terminal/dist");
  return join(dir, zip);
}

export async function pickApp(dir) {
  const list = await readdir(dir, { recursive: true });
  const hit = list.find(
    (file) => typeof file === "string" && file.endsWith(".app"),
  );
  if (!hit) throw new Error(`missing app bundle in ${dir}`);
  return join(dir, hit);
}

export async function pickBin(app) {
  const dir = join(app, "Contents", "MacOS");
  const list = await readdir(dir);
  const file = list[0];
  if (!file) throw new Error(`missing app binary in ${dir}`);
  return file;
}

export async function check(app, home) {
  const dir = join(app, "Contents", "Resources", "symbolic");
  const out = await stat(dir).catch(() => null);
  if (!out?.isDirectory())
    throw new Error(`missing packaged runtime at ${dir}`);

  const hits = await walk(dir);
  const bin = hits.find((file) => basename(file) === "symbolic");
  if (!bin) throw new Error(`missing symbolic runtime binary under ${dir}`);
  await probe(bin, home);
  return bin;
}

async function probe(bin, home) {
  const env = await seed(home);
  const proc = spawn(bin, ["--version"], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const out = [];
  const err = [];

  proc.stdout.on("data", (data) => out.push(Buffer.from(data)));
  proc.stderr.on("data", (data) => err.push(Buffer.from(data)));

  const code = await Promise.race([
    new Promise((done, fail) => {
      proc.on("error", fail);
      proc.on("close", done);
    }),
    new Promise((_, fail) =>
      setTimeout(
        () => fail(new Error("packaged runtime probe timed out")),
        30_000,
      ),
    ),
  ]);
  if (code !== 0)
    throw new Error(
      Buffer.concat(err).toString("utf8") || `runtime exited with code ${code}`,
    );
  if (!Buffer.concat(out).toString("utf8").trim())
    throw new Error("packaged runtime version output was empty");
}

async function walk(dir) {
  const list = await readdir(dir, { withFileTypes: true });
  return (
    await Promise.all(
      list.map((item) =>
        item.isDirectory()
          ? walk(join(dir, item.name))
          : [join(dir, item.name)],
      ),
    )
  ).flat();
}
