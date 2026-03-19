# Symbolic Terminal

Standalone Electron host for the real Symbolic TUI.

## Local setup

- Use Bun from the workspace toolchain. Dev launch resolves Bun from `PATH`, `$BUN`, `~/.bun/bin`, `/opt/homebrew/bin`, or `/usr/local/bin`.
- Run `bun install` from the repo root so Electron, `node-pty`, and package-local deps are installed together.
- If native deps drift after an Electron upgrade, rerun `bun install --cwd packages/terminal` to trigger `electron-builder install-app-deps` again.
- The renderer uses the shadcn `nova` preset. Run `bun run ui:init` to verify the preset is present or bootstrap it in a clean package checkout.
- Smoke scripts use Electron's remote debugging hooks, page target discovery, renderer-side `window.api` state, and an isolated temp home, so they do not need `System Events` Automation or Accessibility approval.
- First launch defaults to a deterministic cwd from the package store or your home directory. Finder inheritance is not required.
- Packaged builds expect a prebuilt Symbolic runtime under `packages/symbolic/dist` and bundle it into the app resources.

## Useful scripts

- `bun run dev` starts the Electron host with the renderer.
- `bun run build` builds the Electron app into `out/`.
- `bun run lint` runs `oxlint` across the package source, scripts, and Vite/Electron config files.
- `bun run format` formats the package TypeScript, config, and JSON files with `oxfmt`.
- `bun run format:check` verifies those `oxfmt` targets are already formatted.
- `bun run ui:init` verifies the shadcn `nova` preset setup and installs it when the package is missing `components.json`.
- `bun run build:runtime` builds the packaged Symbolic runtime from `packages/symbolic`.
- `bun run smoke:dev` launches the built local app, verifies typed terminal input reaches the active session, resizes the window through Chromium DevTools, opens a second session, confirms it appears as a new page target with a working session, and confirms the app can quit cleanly after the sessions exit.
- `bun run package:mac` builds the runtime and produces unsigned macOS artifacts in `dist/`.
- `bun run smoke:packaged` extracts the latest macOS zip to a temp dir, validates the bundled runtime with `symbolic --version`, and runs the same input, second-window session creation, resize, and clean-quit smoke outside the repo cwd.
- `bun run smoke:package` packages the app first, then runs `smoke:packaged`.
- `bun run check` runs typecheck, build, and local smoke coverage.

## Launch assumptions

- Dev mode launches Symbolic with `bun run --conditions=browser ./src/index.ts` from `packages/symbolic`.
- Packaged mode launches the bundled `symbolic` artifact from `Contents/Resources/symbolic`.
- The host sets `TERM=xterm-256color`, `COLORTERM=truecolor`, `TERM_PROGRAM=Symbolic Terminal`, and `SYMBOLIC_TERMINAL=1` before spawning Symbolic.
- The app extends `PATH` with common Bun and system locations to reduce Finder-vs-shell drift on macOS.

## Packaging notes

- `electron-builder.config.ts` unpacks `node-pty` from ASAR and includes the Symbolic runtime as an extra resource.
- Hardened runtime and notarization only turn on when signing credentials are present in the environment.
- Automated packaged smoke still does not replace a final Finder launch and Gatekeeper pass, since smoke launches the app binary directly.
- Notes on overlap with `packages/desktop-electron` live in `packages/terminal/docs/desktop-overlap.md`.
- Release prerequisites and manual verification steps live in `packages/terminal/docs/release-checklist.md`.
