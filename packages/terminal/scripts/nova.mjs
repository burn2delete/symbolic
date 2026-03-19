import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const cfg = Bun.file(path.join(root, "components.json"));
const css = Bun.file(path.join(root, "src/renderer/index.css"));
const pkg = Bun.file(path.join(root, "package.json"));

const ready =
  (await cfg.exists()) &&
  (await css.exists()) &&
  (await cfg.json()).style === "base-nova" &&
  (await css.text()).includes('@import "shadcn/tailwind.css";') &&
  Boolean((await pkg.json()).dependencies?.shadcn);

if (ready) {
  console.log("shadcn nova preset already installed");
  process.exit(0);
}

if (await cfg.exists()) {
  console.error(
    "components.json already exists but does not match the expected nova preset setup",
  );
  process.exit(1);
}

const proc = Bun.spawn(
  [
    "bunx",
    "shadcn",
    "init",
    "--preset",
    "nova",
    "--template",
    "vite",
    "--base",
    "base",
    "--yes",
  ],
  {
    cwd: root,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  },
);

process.exit(await proc.exited);
