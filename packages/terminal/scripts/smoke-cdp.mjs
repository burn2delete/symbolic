import { wait, waitFor, race, waitForExit } from "./smoke-proc.mjs";

export async function page(port) {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`).catch(
    () => null,
  );
  if (!res) return null;
  if (!res.ok) return null;
  const list = await res.json();
  return list.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
}

export async function browser(port) {
  const res = await fetch(`http://127.0.0.1:${port}/json/version`).catch(
    () => null,
  );
  if (!res?.ok) return null;
  const info = await res.json();
  return typeof info.webSocketDebuggerUrl === "string"
    ? info.webSocketDebuggerUrl
    : null;
}

export async function open(url) {
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

export async function send(sock, method, params) {
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

export async function ready(sock) {
  const out = await js(sock, "document.readyState");
  return out === "interactive" || out === "complete";
}

export async function active(sock) {
  const out = await js(
    sock,
    `window.api.boot().then((snap) => snap.list.find((item) => item.id === snap.active) ?? snap.list[0] ?? null)`,
  );
  return out ?? null;
}

export async function activeId(sock) {
  return (await active(sock))?.id ?? null;
}

export async function list(sock) {
  const out = await js(sock, "window.api.boot().then((snap) => snap.list)");
  return Array.isArray(out) ? out : [];
}

export async function count(sock) {
  return (await list(sock)).length;
}

export async function buffer(sock) {
  return (await active(sock))?.buffer ?? "";
}

export async function pages(port) {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`).catch(
    () => null,
  );
  if (!res?.ok) return [];
  const list = await res.json();
  return list.filter(
    (item) => item.type === "page" && item.webSocketDebuggerUrl,
  );
}

export async function ids(port) {
  return new Set((await pages(port)).map((item) => item.id));
}

export async function attach(target) {
  const sock = await open(target.webSocketDebuggerUrl);
  await send(sock, "Page.enable");
  await send(sock, "Page.bringToFront");
  await wait(async () => ready(sock), "new window never finished loading");
  return { sock };
}

export async function spawnWindow(port, sock, seen) {
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

export async function feed(sock, id, data) {
  if (!id) throw new Error("missing active session");
  await js(
    sock,
    `window.api.input({ id: ${JSON.stringify(id)}, data: ${JSON.stringify(data)} })`,
  );
}

export async function quit(proc, port, name) {
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

export async function size(sock, width, height) {
  await js(
    sock,
    `(() => {
      window.resizeTo(${width}, ${height})
      return { height: window.outerHeight, width: window.outerWidth }
    })()`,
  );
}

export async function bounds(sock) {
  const out = await js(
    sock,
    "({ height: window.outerHeight, width: window.outerWidth })",
  );
  return { height: out?.height ?? 0, width: out?.width ?? 0 };
}

export async function js(sock, expression) {
  const out = await send(sock, "Runtime.evaluate", {
    awaitPromise: true,
    expression,
    returnByValue: true,
  });
  return out.result?.value;
}
