import { mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import net from "node:net";
import { join } from "node:path";

export async function wait(fn, msg, timeout = 30_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((done) => setTimeout(done, 250));
  }
  throw new Error(msg);
}

export async function waitFor(fn, msg, timeout = 30_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const out = await fn();
    if (out) return out;
    await new Promise((done) => setTimeout(done, 250));
  }
  throw new Error(msg);
}

export async function race(job, msg, timeout = 30_000) {
  return Promise.race([
    job,
    new Promise((_, fail) => setTimeout(() => fail(new Error(msg)), timeout)),
  ]);
}

export function live(proc, err) {
  if (proc.exitCode === null) return true;
  throw new Error(
    Buffer.concat(err).toString("utf8") ||
      `app exited with code ${proc.exitCode}`,
  );
}

export async function waitForExit(proc, timeout = 5_000) {
  if (proc.exitCode !== null) return;
  await Promise.race([
    new Promise((done) => proc.once("exit", done)),
    new Promise((done) => setTimeout(done, timeout)),
  ]);
  if (proc.exitCode !== null) return;
  proc.kill("SIGKILL");
  await Promise.race([
    new Promise((done) => proc.once("exit", done)),
    new Promise((done) => setTimeout(done, 2_000)),
  ]);
}

export async function seed(home) {
  const dir = {
    cache: join(home, ".cache"),
    cfg: join(home, ".config"),
    data: join(home, ".local", "share"),
    state: join(home, ".local", "state"),
  };
  await Promise.all(
    [home, dir.cache, dir.cfg, dir.data, dir.state].map((item) =>
      mkdir(item, { recursive: true }),
    ),
  );
  return {
    ...process.env,
    CI: "1",
    HOME: home,
    SYMBOLIC_TEST_HOME: home,
    XDG_CACHE_HOME: dir.cache,
    XDG_CONFIG_HOME: dir.cfg,
    XDG_DATA_HOME: dir.data,
    XDG_STATE_HOME: dir.state,
  };
}

export async function run(args) {
  const proc = spawn(args[0], args.slice(1), {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const err = [];

  proc.stderr.on("data", (data) => err.push(Buffer.from(data)));

  await new Promise((done, fail) => {
    proc.on("error", fail);
    proc.on("close", (code) => {
      if (code === 0) return done(null);
      fail(
        new Error(
          Buffer.concat(err).toString("utf8") ||
            `${args[0]} exited with code ${code}`,
        ),
      );
    });
  });
}

export async function pickPort() {
  const srv = net.createServer();
  await new Promise((done, fail) => {
    srv.once("error", fail);
    srv.listen(0, "127.0.0.1", done);
  });
  const out = srv.address();
  if (!out || typeof out === "string")
    throw new Error("failed to allocate debug port");
  const port = out.port;
  await new Promise((done, fail) =>
    srv.close((err) => (err ? fail(err) : done(null))),
  );

  return port;
}
