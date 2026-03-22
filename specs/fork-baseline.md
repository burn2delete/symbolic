## fork baseline

This document inventories the current monorepo as legacy.

The goal is not to preserve the existing Symbolic shape. The goal is to make it easy to decide what to keep, replace, split, or delete as the fork moves to a new stack and new working conventions.

### repo posture

- Package manager and runtime: Bun at the repo root.
- Workspace orchestration: Turborepo.
- Language baseline: TypeScript, mostly run through `tsgo` instead of `tsc`.
- Primary frontend framework: Solid.
- Primary backend frameworks: Hono, SolidStart server routes, SST.
- Primary deployment target today: Cloudflare via SST v3.
- Current data split:
  - local product state in Bun SQLite + Drizzle inside `packages/symbolic`
  - hosted product/business state in PlanetScale MySQL + Drizzle inside `packages/console/core`

### workspace map

#### core product runtime

- `packages/symbolic`
  - main CLI binary and core runtime
  - includes the terminal UI, headless server, session engine, tools, MCP support, provider integrations, local storage, project/worktree handling, and permissions
  - key files:
    - `packages/symbolic/src/index.ts`
    - `packages/symbolic/src/server/server.ts`
    - `packages/symbolic/src/cli/cmd/tui/app.tsx`
    - `packages/symbolic/src/session/index.ts`
    - `packages/symbolic/src/provider/provider.ts`
    - `packages/symbolic/src/storage/db.ts`

#### product client

- `packages/app`
  - shared product app shell used by the browser app and both desktop shells
  - owns routing, providers, session views, settings, terminal/file contexts, notifications, and server connection behavior
  - key files:
    - `packages/app/src/app.tsx`
    - `packages/app/src/context/server.tsx`
    - `packages/app/src/context/global-sdk.tsx`
    - `packages/app/src/context/global-sync.tsx`

- `packages/ui`
  - shared UI package, but not a clean design system boundary
  - mixes reusable components with product-specific contexts, file rendering, markdown, theme runtime, fonts, audio, and review UI
  - likely a split candidate rather than a package to preserve as-is

#### desktop shells

- `packages/desktop`
  - Tauri shell around `packages/app`
  - integrates native APIs, local storage, updater, WSL path handling, and local sidecar behavior
  - key files:
    - `packages/desktop/src/index.tsx`
    - `packages/desktop/src/bindings.ts`

- `packages/desktop-electron`
  - Electron shell around the same app
  - starts a local sidecar process before rendering the app
  - key files:
    - `packages/desktop-electron/src/main/index.ts`
    - `packages/desktop-electron/src/main/server.ts`
    - `packages/desktop-electron/src/preload/index.ts`
    - `packages/desktop-electron/src/renderer/index.tsx`

#### docs and public web

- `packages/web-legacy`
  - renamed as a legacy package and marked for deprecation
  - Astro + Starlight docs site with Solid islands
  - also hosts the share viewer page
  - deployed separately from the main app
  - key files:
    - `packages/web-legacy/astro.config.mjs`
    - `packages/web-legacy/src/pages/s/[id].astro`

#### hosted backend and commercial surfaces

- `packages/console/app`
  - not just a console UI
  - currently acts as a major backend surface via SolidStart server routes
  - contains auth/session handling, billing-adjacent pages, and the `/zen/v1/*` gateway behavior
  - key files:
    - `packages/console/app/src/context/auth.ts`
    - `packages/console/app/src/routes/zen/util/handler.ts`

- `packages/console/core`
  - business/data layer for hosted services
  - accounts, workspaces, auth identities, billing, provider/model catalogs, usage, limits, and relational schema
  - key files:
    - `packages/console/core/src/drizzle/index.ts`
    - `packages/console/core/src/workspace.ts`
    - `packages/console/core/src/user.ts`
    - `packages/console/core/src/schema/*.sql.ts`

- `packages/console/function`
  - separate auth/logging workers
  - GitHub and Google auth via OpenAuth on Cloudflare KV
  - key files:
    - `packages/console/function/src/auth.ts`
    - `packages/console/function/src/log-processor.ts`

- `packages/function`
  - small Cloudflare Worker API for share sync and a few integrations
  - uses Durable Objects + R2 for shared session artifacts
  - key file:
    - `packages/function/src/api.ts`

- `packages/enterprise`
  - separate SolidStart app
  - appears to be a share/storage/public-facing surface rather than a core transactional backend

#### support packages

- `packages/sdk/js`
  - generated JavaScript SDK for the `symbolic` HTTP API
  - regenerated with `./packages/sdk/js/script/build.ts`

- `packages/plugin`
  - plugin-facing types and helpers

- `packages/util`
  - small shared utilities

- `packages/script`
  - support script package

#### optional integrations and distribution extras

- `github`
  - GitHub Action wrapper around the SDK

- `packages/slack`
  - Slack bot integration

- `sdks/vscode`
  - VS Code extension

- `packages/storybook`
  - Storybook harness for UI work

### current architecture

#### 1. local-first product runtime

The main product is built around `packages/symbolic`, not around the hosted console stack.

That package contains:

- the CLI command surface
- the TUI built with `@opentui/*` and Solid
- the headless HTTP server built with Hono
- the agent/session engine
- the tool registry
- local project/worktree state
- local Bun SQLite storage with Drizzle migrations
- provider integrations through the Vercel AI SDK ecosystem and custom loaders
- MCP, LSP, PTY, permissions, config, skill loading, and workspace sync

The most important architectural fact is that the TUI, CLI, and HTTP server are one product runtime, not separate products.

The second important fact is that this runtime is feature-dense by default. Sessions, streaming parts, tools, permissions, config layering, plugins, MCP, LSP, PTY, remote workspaces, and provider breadth are all part of the same application container. A simpler fork will likely need to cut entire subsystems, not just swap libraries.

#### 2. shared app across browser and desktop

`packages/app` is the product UI and both desktop shells mount it directly.

That means:

- the desktop apps are thin shells, not separate frontends
- the app package is tightly coupled to the Symbolic SDK and server semantics
- replacing the backend contract will force changes in `packages/app`, not only in the desktop wrappers

#### 3. dual desktop strategy

The repo currently maintains both Tauri and Electron.

This is a major complexity source because both shells:

- provide native integration
- manage local storage/state
- handle deep links
- manage update flows
- deal with platform-specific path logic
- bootstrap local sidecar behavior

If the fork only wants one desktop story, this is one of the cleanest early deletions.

#### 4. split hosted backend

The hosted backend is fragmented across:

- SST infra definitions in `sst.config.ts` and `infra/*`
- a small Cloudflare Worker in `packages/function`
- a much larger SolidStart server app in `packages/console/app`
- business logic and schema in `packages/console/core`
- auth worker logic in `packages/console/function`

This means the current hosted architecture is not a single API service. It is a composed platform with UI routes, server routes, workers, billing logic, auth, and data split across packages.

#### 5. mixed package boundaries

Several boundaries are blurry:

- `packages/ui` is not only presentational
- `packages/console/app` is not only an app
- `packages/web-legacy` is not only docs because it also serves the share viewer
- desktop shells are not only wrappers because they manage sidecar lifecycle

If the fork wants clearer ownership and replaceable subsystems, these boundaries should not be inherited blindly.

#### 6. product-specific external coupling

The current runtime still has hard product coupling that a fork should review early:

- provider/model metadata is refreshed from `models.dev`
- parts of the local server behavior still assume Symbolic-hosted web surfaces
- share/public flows assume the current session/share model

These are not foundational architecture choices. They are legacy product couplings and should be removed or replaced as soon as the fork decides its own hosted story.

### deployment stack today

Top-level infra is SST v3 with `home: "cloudflare"`.

The current deployment shape is:

- `infra/app.ts`
  - Cloudflare Worker API on `api.<domain>`
  - Astro docs on `docs.<domain>`
  - static site app on `app.<domain>`

- `infra/console.ts`
  - PlanetScale database branch + password
  - auth worker
  - Stripe products + webhook
  - Cloudflare KV
  - R2 buckets
  - Honeycomb log processor
  - SolidStart app on the root domain

- `infra/enterprise.ts`
  - separate SolidStart app with object storage credentials

If Cloudflare, SST, PlanetScale, or Stripe are not part of the fork strategy, the entire `infra` + `console` + `function` shape should be treated as replaceable, not foundational.

### data and state model

#### local product state

Inside `packages/symbolic`:

- Bun SQLite
- Drizzle migrations
- sessions, messages, parts, projects, workspaces, and local runtime state

Key file:

- `packages/symbolic/src/storage/db.ts`

#### hosted business state

Inside `packages/console/core`:

- PlanetScale MySQL
- Drizzle
- accounts
- auth identities
- workspaces
- users
- API keys
- provider/model catalogs
- billing
- usage
- limits

This is a clean seam if the fork wants to drop SaaS/commercial concerns entirely.

### remote and multi-workspace behavior

The current product assumes more than a single local client.

Inside `packages/symbolic` there is a control-plane/workspace layer for:

- multi-project state
- worktree-backed workspaces
- workspace servers
- SSE-based workspace sync

If the fork is local-first and single-client, this is one of the larger simplification levers inside `packages/symbolic`.

### tooling and working conventions inherited today

- `bun install` at the root
- `bun turbo typecheck` from the root
- typechecking usually runs through `tsgo`
- tests are package-scoped, not root-scoped
- root test command intentionally fails via `bunfig.toml`
- app package has unit tests with Bun + Happy DOM and e2e tests with Playwright
- `packages/symbolic` has a large Bun test suite
- Prettier exists at the root
- there is no repo-wide ESLint or Biome baseline for most packages
- the VS Code extension is the exception and has its own ESLint setup

Implication: the fork can redefine repo standards without fighting a deeply consistent existing standard. Today’s conventions are partial and uneven.

### highest-coupling areas

If large changes are planned, these are the areas with the most downstream impact:

#### 1. `packages/symbolic`

Changing this affects:

- CLI behavior
- TUI behavior
- desktop sidecars
- SDK generation
- app server contract
- local storage and session model

#### 2. `packages/app` + `packages/ui`

Changing this affects:

- browser app
- Tauri app
- Electron app
- Storybook
- server/client sync expectations

#### 3. `packages/console/app` + `packages/console/core` + `packages/console/function`

Changing this affects:

- hosted auth
- billing
- provider proxy/gateway behavior
- usage accounting
- relational data model

### likely deletion candidates

These look easiest to remove if they do not fit the fork:

- one of the desktop shells
- `packages/enterprise`
- `packages/slack`
- `github`
- `sdks/vscode`
- Feishu/Discord bridge code in `packages/function`
- public docs/share coupling in `packages/web-legacy`

### likely rewrite candidates

These are important enough that a fork may want to keep the capability but replace the implementation:

- `packages/ui`
- `packages/app`
- hosted auth stack in `packages/console/function`
- hosted billing/gateway stack in `packages/console/app`
- infra definitions in `infra/*`

### likely foundation candidates

These are the strongest candidates to survive in some form, depending on product direction:

- the core local runtime idea in `packages/symbolic`
- the session/tool/project model
- the Bun-based local server and SQLite storage pattern
- the generated SDK flow in `packages/sdk/js`

### concrete fork decisions to make next

#### product shape

Choose which of these are in scope:

- local CLI/TUI only
- local app + one desktop shell
- browser client
- hosted SaaS features
- share/public web
- enterprise/team features

#### platform shape

Choose whether to keep or replace:

- Bun
- Solid
- Hono
- SST
- Cloudflare
- PlanetScale
- Drizzle
- Tauri
- Electron

#### repo shape

Choose whether the fork should collapse into fewer packages, for example:

- `packages/symbolic`
- `packages/app`
- one desktop shell
- `packages/sdk/js`
- a single hosted backend package, if hosted features remain

### recommended next step

Before changing code broadly, define the target repo shape in one short spec:

- packages to keep
- packages to archive
- packages to replace
- chosen frontend stack
- chosen backend stack
- chosen desktop strategy
- chosen deployment target
- chosen test/lint/typecheck standards

That spec should become the filter for every removal and migration after this baseline.
