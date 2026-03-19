import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { networkInterfaces } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { app } from "electron";
import { Bonjour } from "bonjour-service";

import { secret, write } from "./store";

const root = dirname(fileURLToPath(import.meta.url));
const domain = "symbolic-terminal.local";

type Info = {
  url: string;
  password: string;
};

export class Host {
  private proc: ReturnType<typeof spawn> | null = null;
  private info: Info | null = null;
  private job: Promise<Info> | null = null;

  async ensure() {
    if (await this.alive(this.info)) return this.info!;
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

  private async resolve() {
    const info = (await this.discover()) ?? (await this.launch());
    this.info = info;
    return info;
  }

  private async alive(info: Info | null) {
    if (!info) return false;
    try {
      const res = await fetch(new URL("/global/health", info.url), {
        headers: auth(info.password),
        signal: AbortSignal.timeout(1_000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  private async discover() {
    const hits = local();
    const pass = secret();
    if (hits.size === 0) return null;

    return await new Promise<Info | null>((resolve) => {
      const bonjour = new Bonjour();
      const browser = bonjour.find({ type: "http" });
      const stop = (info: Info | null) => {
        browser.stop();
        bonjour.destroy();
        resolve(info);
      };
      const done = setTimeout(() => stop(null), 900);

      browser.on("up", async (service) => {
        if (service.host !== domain) return;
        if (!service.addresses.some((item: string) => hits.has(item))) return;
        const info = {
          url: `http://127.0.0.1:${service.port}`,
          password: pass,
        };
        if (!(await this.alive(info))) return;
        clearTimeout(done);
        stop(info);
      });

      browser.on("error", () => {
        clearTimeout(done);
        stop(null);
      });
    });
  }

  private async launch() {
    const pass = secret();
    const cmd = run(pass);
    if (!cmd) throw new Error("Missing runtime for shared host launch");

    write("host.spawn", {
      file: cmd.file,
      args: cmd.args,
      cwd: cmd.cwd,
      path: cmd.env.PATH,
    });

    const proc = spawn(cmd.file, cmd.args, {
      cwd: cmd.cwd,
      env: cmd.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const info = await new Promise<Info>((resolve, reject) => {
      const fail = (msg: string) => {
        reject(new Error(msg));
      };
      const time = setTimeout(
        () => fail("Timeout waiting for shared host"),
        10_000,
      );
      let out = "";
      const parse = (line: string) => {
        if (!line.startsWith("symbolic server listening")) return;
        const match = line.match(/:(\d+)/);
        if (!match) return;
        clearTimeout(time);
        resolve({
          url: `http://127.0.0.1:${match[1]}`,
          password: pass,
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
        signal: signal ?? null,
      });
      if (this.proc === proc) {
        this.proc = null;
        this.info = null;
      }
    });

    return info;
  }
}

function auth(password: string) {
  return {
    Authorization: `Basic ${Buffer.from(`symbolic:${password}`).toString("base64")}`,
  };
}

function run(password: string) {
  const env = {
    ...process.env,
    PATH: path(),
    SYMBOLIC_SERVER_PASSWORD: password,
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
        "serve",
        "--port=0",
        "--mdns",
        `--mdns-domain=${domain}`,
      ],
      cwd: repo("packages/symbolic"),
      env,
    };
  }

  const file = exists(process.env.SYMBOLIC_BIN_PATH ?? "")
    ? process.env.SYMBOLIC_BIN_PATH!
    : packaged();
  if (!exists(file)) return null;
  return {
    file,
    args: ["serve", "--port=0", "--mdns", `--mdns-domain=${domain}`],
    cwd: app.getPath("home"),
    env,
  };
}

function local() {
  return new Set(
    Object.values(networkInterfaces())
      .flatMap((list) => list ?? [])
      .filter((item) => !item.internal)
      .map((item) => item.address),
  );
}

function bun() {
  const hits = [
    process.env.BUN,
    ...path().split(delimiter),
    join(app.getPath("home"), ".bun", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ].flatMap((dir) => {
    if (!dir) return [];
    const file = dir.endsWith("/bun") ? dir : join(dir, bin("bun"));
    return exists(file) ? [file] : [];
  });
  return hits[0] ?? null;
}

function path() {
  const base = process.env.PATH?.split(delimiter) ?? [];
  const list = [
    ...base,
    join(app.getPath("home"), ".bun", "bin"),
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
  for (const name of names()) {
    const file = join(root, name, "bin", bin());
    if (exists(file)) return file;
  }
  const direct = join(root, bin());
  if (exists(direct)) return direct;
  return direct;
}

function names() {
  const os = process.platform === "win32" ? "windows" : process.platform;
  const base = `symbolic-${os}-${process.arch}`;
  if (process.arch === "x64") return [base, `${base}-baseline`];
  return [base];
}

function exists(file: string) {
  return !!file && existsSync(file);
}

function bin(name = "symbolic") {
  return process.platform === "win32" ? `${name}.exe` : name;
}
