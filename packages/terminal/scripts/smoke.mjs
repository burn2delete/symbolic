import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { spawn } from "node:child_process";
import electron from "electron";

import { check, pickApp, pickBin, pickZip } from "./smoke-pack.mjs";
import { root } from "./smoke-paths.mjs";
import { wait, waitFor, live, pickPort, run, seed, waitForExit } from "./smoke-proc.mjs";
import {
  buffer,
  count,
  ids,
  open,
  page,
  quit,
  ready,
  size,
  bounds,
  send,
  spawnWindow,
} from "./smoke-cdp.mjs";
import { enter, focus, term, type } from "./smoke-ui.mjs";

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
    await wait(
      async () => (await live(proc, err)) && ((await term(sock))?.live ?? false),
      `${input.name} never mounted xterm`,
    );
    const mark = `smoke${Math.random().toString(36).slice(2, 8)}`;
    await wait(
      async () => (await live(proc, err)) && (await focus(sock)),
      `${input.name} terminal never focused`,
    );
    await type(sock, `echo ${mark}`);
    await enter(sock);
    await wait(
      async () => (await buffer(sock)).includes(mark),
      `${input.name} typed input did not reach the session`,
    );
    console.log(`smoke:type:${input.name}`);

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
    await wait(
      async () => (await live(proc, err)) && ((await term(peer.sock))?.live ?? false),
      `${input.name} new window never mounted xterm`,
    );
    const mark2 = `win${Math.random().toString(36).slice(2, 8)}`;
    await wait(
      async () => (await live(proc, err)) && (await focus(peer.sock)),
      `${input.name} new window terminal never focused`,
    );
    await type(peer.sock, `echo ${mark2}`);
    await enter(peer.sock);
    await wait(
      async () => (await buffer(peer.sock)).includes(mark2),
      `${input.name} new window typed input did not reach the session`,
    );
    console.log(`smoke:type:${input.name}:new-window`);

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
