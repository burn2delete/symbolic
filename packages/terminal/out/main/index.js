import { mkdirSync, appendFileSync, existsSync, readFileSync, statSync } from "node:fs";
import { join, dirname, delimiter } from "node:path";
import { app, ipcMain, BrowserWindow, dialog, Menu } from "electron";
import { spawn as spawn$1 } from "node:child_process";
import { networkInterfaces, homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { Bonjour } from "bonjour-service";
import Store from "electron-store";
import * as pty from "node-pty";
import windowState from "electron-window-state";
const store = new Store({ name: "terminal" });
const log = join(app.getPath("userData"), "logs", "main.log");
const defaults = {
  cwd_mode: "recent",
  font_size: 14,
  theme: "system"
};
function dirs() {
  return store.get("dirs") ?? [];
}
function pushDir(dir2) {
  const list = [dir2, ...dirs().filter((item) => item !== dir2)].slice(
    0,
    12
  );
  store.set("dirs", list);
  return list;
}
function prefs() {
  return tidy(store.get("prefs") ?? defaults);
}
function secret() {
  const cur = store.get("secret");
  if (cur) return cur;
  const next = crypto.randomUUID();
  store.set("secret", next);
  write("secret.create");
  return next;
}
function setPrefs(input) {
  const next = tidy({ ...prefs(), ...input });
  store.set("prefs", next);
  write("prefs.set", next);
  return next;
}
function defaultDir() {
  if (prefs().cwd_mode === "home") return app.getPath("home");
  return dirs()[0] ?? app.getPath("home");
}
function write(tag, data) {
  try {
    mkdirSync(dirname(log), { recursive: true });
    appendFileSync(
      log,
      `${(/* @__PURE__ */ new Date()).toISOString()} ${tag}${body(data)}
`,
      "utf8"
    );
  } catch {
  }
}
function getDiag() {
  return {
    path: log,
    tail: existsSync(log) ? readFileSync(log, "utf8").slice(-16e3) : ""
  };
}
function tidy(input) {
  return {
    cwd_mode: input.cwd_mode === "home" ? "home" : "recent",
    font_size: size(input.font_size),
    theme: theme(input.theme)
  };
}
function size(input) {
  const n = Number.isFinite(input) ? Math.round(input) : defaults.font_size;
  return Math.min(32, Math.max(10, n));
}
function theme(input) {
  if (input === "light" || input === "dark") return input;
  return "system";
}
function body(data) {
  if (data === void 0) return "";
  try {
    return ` ${JSON.stringify(data)}`;
  } catch {
    return " [unserializable]";
  }
}
const root$2 = dirname(fileURLToPath(import.meta.url));
const domain = "symbolic-terminal.local";
class Host {
  proc = null;
  info = null;
  job = null;
  async ensure() {
    if (await this.alive(this.info)) return this.info;
    if (this.job) return this.job;
    const job = this.resolve().finally(() => {
      if (this.job === job) this.job = null;
    });
    this.job = job;
    return job;
  }
  dispose() {
    this.proc?.kill();
    this.proc = null;
    this.info = null;
  }
  async resolve() {
    const info = await this.discover() ?? await this.launch();
    this.info = info;
    return info;
  }
  async alive(info) {
    if (!info) return false;
    try {
      const res = await fetch(new URL("/global/health", info.url), {
        headers: auth(info.password),
        signal: AbortSignal.timeout(1e3)
      });
      return res.ok;
    } catch {
      return false;
    }
  }
  async discover() {
    const hits = local();
    const pass = secret();
    if (hits.size === 0) return null;
    return await new Promise((resolve) => {
      const bonjour = new Bonjour();
      const browser = bonjour.find({ type: "http" });
      const stop = (info) => {
        browser.stop();
        bonjour.destroy();
        resolve(info);
      };
      const done = setTimeout(() => stop(null), 900);
      browser.on("up", async (service) => {
        if (service.host !== domain) return;
        if (!service.addresses.some((item) => hits.has(item))) return;
        const info = {
          url: `http://127.0.0.1:${service.port}`,
          password: pass
        };
        if (!await this.alive(info)) return;
        clearTimeout(done);
        stop(info);
      });
      browser.on("error", () => {
        clearTimeout(done);
        stop(null);
      });
    });
  }
  async launch() {
    const pass = secret();
    const cmd = run(pass);
    if (!cmd) throw new Error("Missing runtime for shared host launch");
    write("host.spawn", {
      file: cmd.file,
      args: cmd.args,
      cwd: cmd.cwd,
      path: cmd.env.PATH
    });
    const proc = spawn$1(cmd.file, cmd.args, {
      cwd: cmd.cwd,
      env: cmd.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const info = await new Promise((resolve, reject) => {
      const fail = (msg) => {
        reject(new Error(msg));
      };
      const time = setTimeout(
        () => fail("Timeout waiting for shared host"),
        1e4
      );
      let out = "";
      const parse = (line) => {
        if (!line.startsWith("symbolic server listening")) return;
        const match = line.match(/:(\d+)/);
        if (!match) return;
        clearTimeout(time);
        resolve({
          url: `http://127.0.0.1:${match[1]}`,
          password: pass
        });
      };
      proc.stdout.on("data", (chunk) => {
        out += chunk.toString();
        for (const line of out.split("\n")) parse(line);
      });
      proc.stderr.on("data", (chunk) => {
        out += chunk.toString();
      });
      proc.once("error", (err) => {
        clearTimeout(time);
        reject(err);
      });
      proc.once("exit", (code) => {
        clearTimeout(time);
        fail(`Shared host exited with code ${code}`);
      });
    });
    this.proc = proc;
    proc.on("exit", (code, signal) => {
      write("host.exit", {
        code,
        signal: signal ?? null
      });
      if (this.proc === proc) {
        this.proc = null;
        this.info = null;
      }
    });
    return info;
  }
}
function auth(password) {
  return {
    Authorization: `Basic ${Buffer.from(`symbolic:${password}`).toString("base64")}`
  };
}
function run(password) {
  const env = {
    ...process.env,
    PATH: path$1(),
    SYMBOLIC_SERVER_PASSWORD: password
  };
  if (!app.isPackaged) {
    const file2 = bun$1();
    if (!file2) return null;
    return {
      file: file2,
      args: [
        "run",
        "--conditions=browser",
        "./src/index.ts",
        "serve",
        "--port=0",
        "--mdns",
        `--mdns-domain=${domain}`
      ],
      cwd: repo$1("packages/symbolic"),
      env
    };
  }
  const file = exists(process.env.SYMBOLIC_BIN_PATH ?? "") ? process.env.SYMBOLIC_BIN_PATH : packaged$1();
  if (!exists(file)) return null;
  return {
    file,
    args: ["serve", "--port=0", "--mdns", `--mdns-domain=${domain}`],
    cwd: app.getPath("home"),
    env
  };
}
function local() {
  return new Set(
    Object.values(networkInterfaces()).flatMap((list) => list ?? []).filter((item) => !item.internal).map((item) => item.address)
  );
}
function bun$1() {
  const hits = [
    process.env.BUN,
    ...path$1().split(delimiter),
    join(app.getPath("home"), ".bun", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin"
  ].flatMap((dir2) => {
    if (!dir2) return [];
    const file = dir2.endsWith("/bun") ? dir2 : join(dir2, bin$1("bun"));
    return exists(file) ? [file] : [];
  });
  return hits[0] ?? null;
}
function path$1() {
  const base = process.env.PATH?.split(delimiter) ?? [];
  const list = [
    ...base,
    join(app.getPath("home"), ".bun", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin"
  ];
  return [...new Set(list.filter(Boolean))].join(delimiter);
}
function repo$1(...parts) {
  return join(root$2, "../../../../", ...parts);
}
function packaged$1() {
  const root2 = join(process.resourcesPath, "symbolic");
  for (const name of names$1()) {
    const file = join(root2, name, "bin", bin$1());
    if (exists(file)) return file;
  }
  const direct = join(root2, bin$1());
  if (exists(direct)) return direct;
  return direct;
}
function names$1() {
  const os = process.platform === "win32" ? "windows" : process.platform;
  const base = `symbolic-${os}-${process.arch}`;
  if (process.arch === "x64") return [base, `${base}-baseline`];
  return [base];
}
function exists(file) {
  return !!file && existsSync(file);
}
function bin$1(name = "symbolic") {
  return process.platform === "win32" ? `${name}.exe` : name;
}
function registerIpcHandlers(deps) {
  ipcMain.handle(
    "terminal:boot",
    (event) => deps.boot(win(event))
  );
  ipcMain.handle(
    "terminal:create",
    (event, input) => deps.create(win(event), input)
  );
  ipcMain.handle(
    "terminal:close",
    (event, id) => deps.close(win(event), id)
  );
  ipcMain.handle(
    "terminal:restart",
    (event, id) => deps.restart(win(event), id)
  );
  ipcMain.handle(
    "terminal:focus",
    (event, id) => deps.focus(win(event), id)
  );
  ipcMain.handle(
    "terminal:next",
    (event) => deps.next(win(event))
  );
  ipcMain.handle(
    "terminal:prev",
    (event) => deps.prev(win(event))
  );
  ipcMain.on("terminal:input", (event, input) => {
    void deps.input(win(event), input);
  });
  ipcMain.on("terminal:resize", (event, input) => {
    void deps.resize(win(event), input);
  });
  ipcMain.handle(
    "terminal:pick-dir",
    (event, dir2) => deps.pickDir(win(event), dir2)
  );
  ipcMain.handle("terminal:get-prefs", () => deps.getPrefs());
  ipcMain.handle(
    "terminal:set-prefs",
    (_event, input) => deps.setPrefs(input)
  );
  ipcMain.handle("terminal:get-diag", () => deps.getDiag());
}
function win(event) {
  return BrowserWindow.fromWebContents(event.sender);
}
function send(win2, event) {
  if (win2.isDestroyed()) return;
  win2.webContents.send("terminal:event", event);
}
async function pickDir(win2, dir2) {
  const res = await (win2 ? dialog.showOpenDialog(win2, {
    properties: ["openDirectory", "createDirectory"],
    title: "Choose a folder",
    defaultPath: dir2 ?? void 0
  }) : dialog.showOpenDialog({
    properties: ["openDirectory", "createDirectory"],
    title: "Choose a folder",
    defaultPath: dir2 ?? void 0
  }));
  if (res.canceled) return null;
  return res.filePaths[0] ?? null;
}
function createMenu(deps) {
  const focused = () => BrowserWindow.getFocusedWindow();
  const recent = deps.dirs().map((dir2) => ({
    label: dir2,
    click: () => deps.recent(dir2)
  }));
  const view = [
    {
      label: "View",
      submenu: [
        {
          label: "Toggle Developer Tools",
          accelerator: "Alt+Cmd+I",
          click: () => BrowserWindow.getFocusedWindow()?.webContents.toggleDevTools()
        }
      ]
    }
  ];
  const template = [
    ...process.platform === "darwin" ? [
      {
        label: "Symbolic",
        submenu: [
          { role: "about" },
          { type: "separator" },
          {
            label: "Settings...",
            accelerator: "Cmd+,",
            click: () => deps.settings(focused())
          },
          { type: "separator" },
          { role: "hide" },
          { role: "hideOthers" },
          { role: "unhide" },
          { type: "separator" },
          { role: "quit" }
        ]
      }
    ] : [],
    {
      label: "File",
      submenu: [
        {
          label: "New Window",
          accelerator: "CmdOrCtrl+N",
          click: () => deps.create(focused())
        },
        {
          label: "Open Folder...",
          accelerator: "CmdOrCtrl+O",
          click: () => deps.open(focused())
        },
        {
          label: "Open Recent",
          submenu: recent.length > 0 ? recent : [{ label: "No Recent Folders", enabled: false }]
        },
        { type: "separator" },
        {
          label: "Settings...",
          accelerator: "CmdOrCtrl+,",
          click: () => deps.settings(focused())
        },
        { type: "separator" },
        {
          label: "Close Window",
          accelerator: "CmdOrCtrl+W",
          click: () => deps.close(focused())
        }
      ]
    },
    {
      label: "Edit",
      submenu: [
        {
          label: "Copy",
          accelerator: "CmdOrCtrl+C",
          click: () => deps.trigger(focused(), "copy")
        },
        {
          label: "Paste",
          accelerator: "CmdOrCtrl+V",
          click: () => deps.trigger(focused(), "paste")
        },
        {
          label: "Select All",
          accelerator: "CmdOrCtrl+A",
          click: () => deps.trigger(focused(), "select_all")
        }
      ]
    },
    {
      label: "Session",
      submenu: [
        {
          label: "Restart Session",
          accelerator: "Shift+CmdOrCtrl+R",
          click: () => deps.restart(focused())
        }
      ]
    },
    ...process.platform === "darwin" ? [
      {
        label: "Window",
        submenu: [
          { role: "minimize" },
          { role: "zoom" },
          { type: "separator" },
          { role: "front" }
        ]
      }
    ] : [],
    ...view
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
const root$1 = dirname(fileURLToPath(import.meta.url));
class Sessions {
  constructor(deps, input) {
    this.deps = deps;
    this.init = input;
  }
  live = null;
  host = null;
  idx = 0;
  init;
  seed = true;
  size = { cols: 80, rows: 24 };
  async boot() {
    if (!this.live && this.seed) await this.create(this.init);
    this.seed = false;
    this.init = void 0;
    return {
      list: this.live ? [copy(this.live.session)] : [],
      active: this.live?.session.id ?? null,
      dirs: dirs(),
      prefs: prefs(),
      host: this.host
    };
  }
  async create(input) {
    if (this.live) return copy(this.live.session);
    const id = crypto.randomUUID();
    const live = await this.spawn(id, input?.cwd ?? null, this.next());
    this.live = live;
    this.emit(live.session, true);
    return copy(live.session);
  }
  async close(id) {
    if (this.live?.session.id !== id) return;
    const live = this.live;
    this.live = null;
    live.proc?.kill();
    this.deps.send({ type: "remove", id, active: null });
  }
  async restart(id) {
    const prev = this.live;
    if (!prev || prev.session.id !== id)
      throw new Error(`Unknown session: ${id}`);
    prev.proc?.kill();
    const next = await this.spawn(id, prev.session.cwd, prev.session.idx);
    this.live = next;
    this.emit(next.session);
    return copy(next.session);
  }
  async focus(id) {
    if (this.live?.session.id !== id) return;
    this.emit(this.live.session);
  }
  async nextTab() {
  }
  async prevTab() {
  }
  async input(id, data) {
    if (this.live?.session.id !== id) return;
    try {
      this.live.proc?.write(data);
    } catch (err) {
      write("session.write.fail", {
        id,
        err: err instanceof Error ? err.message : String(err)
      });
    }
  }
  current() {
    return this.live?.session.id ?? null;
  }
  session() {
    return this.live ? copy(this.live.session) : null;
  }
  async resize(id, cols, rows) {
    if (this.live?.session.id !== id || cols < 1 || rows < 1) return;
    this.size = { cols, rows };
    write("session.resize", {
      id,
      cols,
      rows
    });
    try {
      this.live.proc?.resize(cols, rows);
    } catch (err) {
      write("session.resize.fail", {
        id,
        cols,
        rows,
        err: err instanceof Error ? err.message : String(err)
      });
    }
  }
  menu(id) {
    this.deps.send({ type: "menu", id });
  }
  dispose() {
    const live = this.live;
    this.live = null;
    live?.proc?.kill();
  }
  next() {
    this.idx += 1;
    return this.idx;
  }
  async spawn(id, input, idx) {
    const cwd = dir(input);
    const session2 = {
      id,
      idx,
      title: `Session ${idx}`,
      cwd,
      pid: null,
      state: "starting",
      exit_code: null,
      note: null,
      buffer: ""
    };
    const host = await this.deps.host().catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      write("host.ensure.fail", { id, cwd, err: msg });
      return null;
    });
    this.host = host ? hostInfo(host.url) : null;
    const cmd = host ? launch(cwd, host) : null;
    if (!cmd) {
      const bin2 = process.env.SYMBOLIC_BIN_PATH ?? packaged();
      session2.state = "failed";
      session2.note = app.isPackaged ? "Missing shared symbolic host runtime" : "Missing Bun runtime for shared symbolic host";
      write("session.launch.missing", {
        id,
        cwd,
        packaged: app.isPackaged,
        bun: bun(),
        bin: bin2,
        host: host?.url ?? null
      });
      return { proc: null, session: session2 };
    }
    write("session.spawn", {
      id,
      cwd,
      file: cmd.file,
      args: cmd.args,
      launch_cwd: cmd.cwd,
      cols: this.size.cols,
      rows: this.size.rows,
      path: cmd.env.PATH
    });
    const res = spawn(cmd, this.size);
    if (!res.proc) {
      session2.state = "failed";
      session2.note = `Failed to launch ${cmd.file}`;
      write("session.spawn.fail", {
        id,
        cwd,
        file: cmd.file,
        err: res.err
      });
      return { proc: null, session: session2 };
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
          err: err instanceof Error ? err.message : String(err)
        });
      }
    }
    session2.pid = proc.pid;
    session2.state = "running";
    session2.note = null;
    this.deps.dirs?.(pushDir(cwd));
    proc.onData((data) => {
      const live = this.live;
      if (!live || live.proc !== proc || live.session.id !== id) return;
      live.session.buffer = joinBuffer(live.session.buffer, data);
      this.deps.send({ type: "data", id, data });
    });
    proc.onExit(
      ({ exitCode, signal }) => {
        const live = this.live;
        if (!live || live.proc !== proc || live.session.id !== id) return;
        live.proc = null;
        live.session.pid = null;
        live.session.exit_code = exitCode;
        live.session.state = exitCode === 0 ? "exited" : "failed";
        live.session.note = signal ? `signal ${signal}` : exitCode === 0 ? null : `exit ${exitCode}`;
        write("session.exit", {
          id,
          cwd: live.session.cwd,
          exit_code: exitCode,
          signal: signal ?? null
        });
        this.emit(live.session);
      }
    );
    return { proc, session: session2 };
  }
  emit(session2, withDirs = false) {
    this.deps.send({
      type: "update",
      session: copy(session2),
      active: this.live?.session.id ?? null,
      host: this.host,
      ...withDirs ? { dirs: dirs() } : {}
    });
  }
}
function copy(session2) {
  return { ...session2 };
}
function joinBuffer(buffer, data) {
  return `${buffer}${data}`.slice(-2e5);
}
function hostInfo(url) {
  try {
    const next = new URL(url);
    return {
      url: next.toString(),
      port: Number(next.port || (next.protocol === "https:" ? 443 : 80))
    };
  } catch {
    return null;
  }
}
function launch(cwd, host) {
  const env = {
    ...process.env,
    PATH: path(),
    PWD: cwd,
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    TERM_PROGRAM: "Symbolic Terminal",
    SYMBOLIC_TERMINAL: "1",
    SYMBOLIC_SERVER_PASSWORD: host.password
  };
  if (!app.isPackaged) {
    const file2 = bun();
    if (!file2) return null;
    return {
      file: file2,
      args: [
        "run",
        "--conditions=browser",
        "./src/index.ts",
        "attach",
        host.url,
        `--dir=${cwd}`,
        `--password=${host.password}`
      ],
      env,
      cwd: repo("packages/symbolic")
    };
  }
  const file = existsSync(process.env.SYMBOLIC_BIN_PATH ?? "") ? process.env.SYMBOLIC_BIN_PATH : packaged();
  if (!existsSync(file)) return null;
  return {
    file,
    args: ["attach", host.url, `--dir=${cwd}`, `--password=${host.password}`],
    env,
    cwd
  };
}
function spawn(cmd, size2) {
  try {
    return {
      proc: pty.spawn(cmd.file, cmd.args, {
        cwd: cmd.cwd,
        cols: size2.cols,
        rows: size2.rows,
        name: "xterm-256color",
        env: cmd.env
      }),
      err: null
    };
  } catch (err) {
    return {
      proc: null,
      err: err instanceof Error ? err.message : String(err)
    };
  }
}
function bun() {
  const hits = [
    process.env.BUN,
    ...path().split(delimiter),
    join(homedir(), ".bun", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin"
  ].flatMap((dir2) => {
    if (!dir2) return [];
    const file = dir2.endsWith("/bun") ? dir2 : join(dir2, bin("bun"));
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
    "/sbin"
  ];
  return [...new Set(list.filter(Boolean))].join(delimiter);
}
function repo(...parts) {
  return join(root$1, "../../../../", ...parts);
}
function packaged() {
  const root2 = join(process.resourcesPath, "symbolic");
  const direct = join(root2, bin());
  if (!existsSync(root2)) return direct;
  if (existsSync(direct)) return direct;
  for (const name of names()) {
    const file = join(root2, name, "bin", bin());
    if (existsSync(file)) return file;
  }
  return direct;
}
function dir(input) {
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
const root = dirname(fileURLToPath(import.meta.url));
function createWindow(host) {
  const state = windowState({
    defaultWidth: 1280,
    defaultHeight: 800
  });
  return make(state, host);
}
function make(state, input) {
  const host = input && !input.isDestroyed() ? input : null;
  const box = host ? host.getBounds() : state;
  const win2 = new BrowserWindow({
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: "Symbolic",
    backgroundColor: "#0f1114",
    ...process.platform === "darwin" ? {
      titleBarStyle: "hiddenInset"
    } : {},
    webPreferences: {
      preload: join(root, "../preload/index.mjs"),
      contextIsolation: true,
      sandbox: false
    }
  });
  state.manage(win2);
  win2.once("ready-to-show", () => win2.show());
  load(win2);
  win2.webContents.setZoomFactor(1);
  win2.webContents.on("zoom-changed", () => win2.webContents.setZoomFactor(1));
  win2.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win2.webContents.on("will-navigate", (event) => event.preventDefault());
  return win2;
}
function load(win2) {
  const url = process.env.ELECTRON_RENDERER_URL;
  if (url) {
    void win2.loadURL(new URL("index.html", url).toString());
    return;
  }
  void win2.loadFile(join(root, "../renderer/index.html"));
}
const wait = [];
const map = /* @__PURE__ */ new Map();
const allow = /* @__PURE__ */ new Set();
const shared = new Host();
setup();
function setup() {
  hush();
  wireDiag();
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  app.on("second-instance", () => show());
  app.on("before-quit", () => {
    map.forEach((item) => item.dispose());
    shared.dispose();
  });
  app.on("open-file", (event, file) => {
    event.preventDefault();
    if (!app.isReady()) {
      wait.push(file);
      return;
    }
    void openPath(file);
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
  app.on("activate", () => {
    if (windows().length > 0) {
      show();
      return;
    }
    void openWindow();
  });
  void app.whenReady().then(() => {
    write("app.ready", {
      packaged: app.isPackaged,
      pid: process.pid,
      user_data: app.getPath("userData")
    });
    void openWindow();
    wire();
    void flush();
  });
}
function hush() {
  const raw = console.error;
  console.error = (...args) => {
    if (args[0] === "Unhandled pty write error") {
      const err = args[1];
      write("pty.write.error", {
        err: err instanceof Error ? { msg: err.message, stack: err.stack } : typeof err === "object" && err !== null ? JSON.parse(JSON.stringify(err)) : String(err)
      });
      return;
    }
    raw(...args);
  };
}
function wire() {
  registerIpcHandlers({
    boot: async (win2) => session(win2)?.boot() ?? empty(),
    create: async (win2, input) => {
      return openWindow(input, win2).then((item) => item.session);
    },
    close: async (win2, id) => close(win2, id),
    restart: async (win2, id) => {
      const item = session(win2);
      if (!item) throw new Error("Missing session");
      return item.restart(id);
    },
    focus: async (win2, id) => {
      await session(win2)?.focus(id);
    },
    next: async () => {
    },
    prev: async () => {
    },
    input: async (win2, input) => {
      const item = session(win2);
      if (!item || item.current() !== input.id) return;
      await item.input(input.id, input.data);
    },
    resize: async (win2, input) => {
      const item = session(win2);
      if (!item || item.current() !== input.id) return;
      await item.resize(input.id, input.cols, input.rows);
    },
    pickDir: async (win2, dir2) => {
      const next = await pickDir(win2, dir2 ?? defaultDir());
      if (next) {
        pushDir(next);
        menu();
      }
      return next;
    },
    getPrefs: async () => prefs(),
    setPrefs: async (input) => setPrefs(input),
    getDiag: async () => getDiag()
  });
  menu();
}
async function openWindow(input, host) {
  const win2 = createWindow(host);
  const item = new Sessions(
    {
      send: (event) => send(win2, event),
      dirs: () => menu(),
      host: () => shared.ensure()
    },
    input
  );
  map.set(win2.id, item);
  win2.on("focus", () => {
    menu();
    item.menu("window:refresh");
  });
  win2.on("show", () => {
    item.menu("window:refresh");
  });
  win2.on("close", (event) => {
    if (allow.delete(win2.id)) return;
    if (!item.current()) return;
    event.preventDefault();
    item.menu("window:close-request");
  });
  win2.on("closed", () => {
    map.get(win2.id)?.dispose();
    map.delete(win2.id);
    allow.delete(win2.id);
    menu();
  });
  const session2 = item.session() ?? await item.boot().then((data) => data.list[0]);
  if (!session2) throw new Error("Missing session");
  win2.setTitle(title(session2));
  menu();
  return { win: win2, session: session2 };
}
function close(win2, id) {
  const item = session(win2);
  if (!item || item.current() !== id) return Promise.resolve();
  if (win2) allow.add(win2.id);
  win2?.close();
  return Promise.resolve();
}
function show() {
  const win2 = focus();
  if (!win2) return;
  if (win2.isMinimized()) win2.restore();
  win2.show();
  win2.focus();
}
function menu() {
  createMenu({
    create: (win2) => {
      void openWindow(void 0, win2);
    },
    close: (win2) => {
      win2?.close();
    },
    restart: (win2) => {
      const item = session(win2);
      const id = item?.current();
      if (!item || !id) return;
      void item.restart(id);
    },
    open: (win2) => {
      void (async () => {
        const dir2 = await pickDir(win2, defaultDir());
        if (!dir2) return;
        await openDir(dir2, win2);
      })();
    },
    settings: (win2) => {
      session(win2)?.menu("settings");
    },
    recent: (dir2) => {
      void openDir(dir2, focus());
    },
    dirs: () => [defaultDir(), ...dirs()].filter(
      (dir2, idx, list) => dir2 && list.indexOf(dir2) === idx
    ),
    trigger: (win2, id) => {
      session(win2)?.menu(id);
    }
  });
}
function session(win2) {
  if (!win2 || win2.isDestroyed()) return null;
  return map.get(win2.id) ?? null;
}
function windows() {
  return BrowserWindow.getAllWindows().filter((win2) => !win2.isDestroyed());
}
function focus() {
  return BrowserWindow.getFocusedWindow() ?? windows().find((win2) => win2.isVisible()) ?? windows()[0] ?? null;
}
function empty() {
  return {
    list: [],
    active: null,
    dirs: dirs(),
    prefs: prefs(),
    host: null
  };
}
async function flush() {
  for (const file of wait.splice(0)) await openPath(file);
}
async function openPath(file) {
  show();
  const dir2 = pathDir(file);
  if (!dir2) return;
  await openDir(dir2, focus());
}
async function openDir(dir2, tab) {
  pushDir(dir2);
  menu();
  await openWindow({ cwd: dir2 }, tab);
}
function pathDir(file) {
  if (!existsSync(file)) return null;
  const stat = statSync(file);
  return stat.isDirectory() ? file : dirname(file);
}
function title(session2) {
  if (!/^Session \d+$/.test(session2.title)) return session2.title;
  const parts = session2.cwd.split("/").filter(Boolean);
  return parts.at(-1) || session2.cwd || "Symbolic";
}
function wireDiag() {
  process.on("uncaughtException", (err) => {
    write("process.uncaught", {
      msg: err.message,
      stack: err.stack
    });
  });
  process.on("unhandledRejection", (err) => {
    write("process.rejection", {
      err: err instanceof Error ? { msg: err.message, stack: err.stack } : String(err)
    });
  });
  app.on("render-process-gone", (_event, web, info) => {
    write("render.gone", {
      reason: info.reason,
      exit_code: info.exitCode,
      url: web.getURL()
    });
  });
  app.on("child-process-gone", (_event, info) => {
    write("child.gone", {
      type: info.type,
      reason: info.reason,
      name: info.name,
      service: info.serviceName,
      exit_code: info.exitCode
    });
  });
}
