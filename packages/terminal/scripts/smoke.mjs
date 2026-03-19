import { mkdir, mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import net from "node:net";
import { fileURLToPath } from "node:url";
import electron from "electron";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const mode = process.argv[2];

if (mode !== "dev" && mode !== "mac")
  throw new Error(
    "Use `node ./scripts/smoke.mjs dev` or `node ./scripts/smoke.mjs mac`",
  );
if (process.platform !== "darwin")
  throw new Error("terminal smoke scripts currently run on macOS only");

await main(mode);

async function main(mode) {
  const tmp = await mkdtemp(join(tmpdir(), "symbolic-terminal-smoke-"));
  console.log(`smoke:${mode}:start`);

  try {
    if (mode === "dev") {
      await hit({
        args: [join(root, "out/main/index.js")],
        cwd: root,
        home: join(tmp, "dev-home"),
        name: "Electron",
      });
      return;
    }

    const zip = await pickZip();
    const dir = join(tmp, "app");
    await run(["ditto", "-xk", zip, dir]);
    const app = await pickApp(dir);
    const bin = await check(app, join(tmp, "runtime-home"));
    await hit({
      cwd: tmp,
      executablePath: join(app, "Contents", "MacOS", await pickBin(app)),
      home: join(tmp, "app-home"),
      name: basename(app, ".app"),
      runtime: bin,
    });
  } finally {
    await rm(tmp, { force: true, recursive: true });
  }
}

async function hit(input) {
  console.log(`smoke:launch:${input.name}`);
  const env = await seed(input.home);
  const port = await pickPort();
  const proc = spawn(
    input.executablePath ?? electron,
    [`--remote-debugging-port=${port}`, ...(input.args ?? [])],
    {
      cwd: input.cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const err = [];

  proc.stderr.on("data", (data) => err.push(Buffer.from(data)));

  try {
    await wait(
      async () => live(proc, err),
      `${input.name} exited during launch`,
    );
    const target = await waitFor(
      () => page(port),
      `${input.name} never opened a window`,
    );
    const sock = await open(target.webSocketDebuggerUrl);
    await send(sock, "Page.enable");
    await send(sock, "Page.bringToFront");
    await wait(
      async () => (await ready(sock)) && (await live(proc, err)),
      `${input.name} never finished loading`,
    );
    console.log(`smoke:window:${input.name}`);

    await wait(
      async () => (await count(sock)) > 0,
      `${input.name} never opened a session`,
    );
    const mark = `smoke${Math.random().toString(36).slice(2, 8)}`;
    await feed(sock, await activeId(sock), `echo ${mark}\r`);
    await wait(
      async () => (await buffer(sock)).includes(mark),
      `${input.name} input hook did not reach the session`,
    );
    console.log(`smoke:input:${input.name}`);

    await size(sock, 1180, 820);
    await wait(async () => {
      const box = await bounds(sock);
      return box.width >= 1180 && box.height >= 820;
    }, `${input.name} window did not resize`);
    console.log(`smoke:resize:${input.name}`);

    const seen = await ids(port);
    const peer = await spawnWindow(port, sock, seen);
    console.log(`smoke:window:${input.name}:new`);

    await wait(
      async () => (await count(peer.sock)) > 0,
      `${input.name} new window did not open a session`,
    );
    const mark2 = `win${Math.random().toString(36).slice(2, 8)}`;
    await feed(peer.sock, await activeId(peer.sock), `echo ${mark2}\r`);
    await wait(
      async () => (await buffer(peer.sock)).includes(mark2),
      `${input.name} new window input hook did not reach the session`,
    );
    console.log(`smoke:session:${input.name}:new-window`);

    await quit(proc, port, input.name);
    console.log(`smoke:quit:${input.name}`);

    if (input.runtime) console.log(`smoke:runtime:${basename(input.runtime)}`);
  } finally {
    if (proc.exitCode === null) {
      proc.kill("SIGTERM");
      await waitForExit(proc);
    }
  }
}

async function wait(fn, msg, timeout = 30_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((done) => setTimeout(done, 250));
  }
  throw new Error(msg);
}

async function race(job, msg, timeout = 30_000) {
  return Promise.race([
    job,
    new Promise((_, fail) => setTimeout(() => fail(new Error(msg)), timeout)),
  ]);
}

function live(proc, err) {
  if (proc.exitCode === null) return true;
  throw new Error(
    Buffer.concat(err).toString("utf8") ||
      `app exited with code ${proc.exitCode}`,
  );
}

async function waitForExit(proc, timeout = 5_000) {
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

async function page(port) {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`).catch(
    () => null,
  );
  if (!res) return null;
  if (!res.ok) return null;
  const list = await res.json();
  return list.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
}

async function browser(port) {
  const res = await fetch(`http://127.0.0.1:${port}/json/version`).catch(
    () => null,
  );
  if (!res?.ok) return null;
  const info = await res.json();
  return typeof info.webSocketDebuggerUrl === "string"
    ? info.webSocketDebuggerUrl
    : null;
}

async function open(url) {
  const sock = new WebSocket(url);
  await race(
    new Promise((done, fail) => {
      sock.addEventListener("open", () => done(null), { once: true });
      sock.addEventListener(
        "error",
        () => fail(new Error(`failed to open ${url}`)),
        { once: true },
      );
    }),
    `failed to open ${url}`,
  );
  return sock;
}

async function send(sock, method, params) {
  send.id = (send.id ?? 0) + 1;
  const id = send.id;
  sock.send(JSON.stringify({ id, method, params }));
  return race(
    new Promise((done, fail) => {
      const on = (event) => {
        const msg = JSON.parse(String(event.data));
        if (msg.id !== id) return;
        sock.removeEventListener("message", on);
        sock.removeEventListener("close", boom);
        sock.removeEventListener("error", boom);
        if (msg.error) {
          fail(new Error(msg.error.message || method));
          return;
        }
        done(msg.result);
      };
      const boom = () => {
        sock.removeEventListener("message", on);
        sock.removeEventListener("close", boom);
        sock.removeEventListener("error", boom);
        fail(new Error(`socket closed during ${method}`));
      };
      sock.addEventListener("message", on);
      sock.addEventListener("close", boom, { once: true });
      sock.addEventListener("error", boom, { once: true });
    }),
    `${method} timed out`,
  );
}

async function ready(sock) {
  const out = await js(sock, "document.readyState");
  return out === "interactive" || out === "complete";
}

async function active(sock) {
  const out = await js(
    sock,
    `window.api.boot().then((snap) => snap.list.find((item) => item.id === snap.active) ?? snap.list[0] ?? null)`,
  );
  return out ?? null;
}

async function activeId(sock) {
  return (await active(sock))?.id ?? null;
}

async function list(sock) {
  const out = await js(sock, "window.api.boot().then((snap) => snap.list)");
  return Array.isArray(out) ? out : [];
}

async function count(sock) {
  return (await list(sock)).length;
}

async function buffer(sock) {
  return (await active(sock))?.buffer ?? "";
}

async function pages(port) {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`).catch(
    () => null,
  );
  if (!res?.ok) return [];
  const list = await res.json();
  return list.filter(
    (item) => item.type === "page" && item.webSocketDebuggerUrl,
  );
}

async function ids(port) {
  return new Set((await pages(port)).map((item) => item.id));
}

async function attach(target) {
  const sock = await open(target.webSocketDebuggerUrl);
  await send(sock, "Page.enable");
  await send(sock, "Page.bringToFront");
  await wait(async () => ready(sock), "new window never finished loading");
  return { sock };
}

async function spawnWindow(port, sock, seen) {
  await js(sock, "window.api.create()");
  return waitFor(
    async () => {
      const next = (await pages(port)).find((item) => !seen.has(item.id));
      if (next) return attach(next);
      return null;
    },
    "new window action did not open a window",
    15_000,
  );
}

async function feed(sock, id, data) {
  if (!id) throw new Error("missing active session");
  await js(
    sock,
    `window.api.input({ id: ${JSON.stringify(id)}, data: ${JSON.stringify(data)} })`,
  );
}

async function quit(proc, port, name) {
  const url = await browser(port);
  if (!url) throw new Error(`missing browser target for ${name}`);
  const sock = await open(url);
  sock.send(JSON.stringify({ id: 0, method: "Browser.close" }));
  const code = await Promise.race([
    new Promise((done, fail) => {
      proc.once("error", fail);
      proc.once("exit", done);
    }),
    new Promise((done) => setTimeout(() => done(null), 5_000)),
  ]);
  if (code === null) {
    proc.kill("SIGTERM");
    await waitForExit(proc, 10_000);
  }
  if (proc.exitCode === null) return;
  if (proc.exitCode !== 0)
    throw new Error(`${name} exited with code ${proc.exitCode}`);
}

async function size(sock, width, height) {
  await js(
    sock,
    `(() => {
      window.resizeTo(${width}, ${height})
      return { height: window.outerHeight, width: window.outerWidth }
    })()`,
  );
}

async function bounds(sock) {
  const out = await js(
    sock,
    "({ height: window.outerHeight, width: window.outerWidth })",
  );
  return { height: out?.height ?? 0, width: out?.width ?? 0 };
}

async function js(sock, expression) {
  const out = await send(sock, "Runtime.evaluate", {
    awaitPromise: true,
    expression,
    returnByValue: true,
  });
  return out.result?.value;
}

async function pickZip() {
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

async function pickApp(dir) {
  const list = await readdir(dir, { recursive: true });
  const hit = list.find(
    (file) => typeof file === "string" && file.endsWith(".app"),
  );
  if (!hit) throw new Error(`missing app bundle in ${dir}`);
  return join(dir, hit);
}

async function pickBin(app) {
  const dir = join(app, "Contents", "MacOS");
  const list = await readdir(dir);
  const file = list[0];
  if (!file) throw new Error(`missing app binary in ${dir}`);
  return file;
}

async function check(app, home) {
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

async function run(args) {
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

async function waitFor(fn, msg, timeout = 30_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const out = await fn();
    if (out) return out;
    await new Promise((done) => setTimeout(done, 250));
  }
  throw new Error(msg);
}

async function seed(home) {
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

async function pickPort() {
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
