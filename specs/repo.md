# Repo map

Current monorepo shape and package links.

---

## Start here

This is a package-level map of the current repo. Notes on dependencies come from package manifests, not a full runtime architecture trace.

---

## Read core

- `packages/symbolic` - primary CLI and local runtime
- `packages/app` - shared product app shell
- `packages/ui` - shared UI and product-facing components
- `packages/sdk/js` - JavaScript SDK package
- `packages/plugin` - plugin support package
- `packages/codex-runtime` - runtime bridge package used by the core runtime
- `packages/util` - shared utilities
- `packages/script` - internal scripts and helpers

---

## Trace delivery

- `packages/desktop` - desktop shell
- `packages/desktop-electron` - Electron desktop shell
- `sdks/vscode` - VS Code extension
- `github` - GitHub integration surface
- `packages/slack` - Slack integration
- `packages/storybook` - Storybook workspace
- `packages/web` - active Next.js app-router web shell with Tailwind v4
- `packages/web-legacy` - deprecated Astro docs and share surface kept for reference

---

## Review hosted

- `packages/console/app` - hosted app and server routes
- `packages/console/core` - shared hosted business logic and data layer
- `packages/console/function` - hosted worker functions
- `packages/console/resource` - hosted resource package
- `packages/console/mail` - hosted mail package
- `packages/function` - additional function package
- `packages/enterprise` - enterprise-focused surface

---

## Follow links

- These are direct workspace relationships from `package.json` files, not a full runtime call graph
- Core chain: `packages/symbolic` -> `packages/sdk/js`, `packages/plugin`, `packages/util`, `packages/codex-runtime`, `packages/script`
- Core chain: `packages/app` -> `packages/sdk/js`, `packages/ui`, `packages/util`
- Core chain: `packages/ui` -> `packages/sdk/js`, `packages/util`
- Core chain: `packages/plugin` -> `packages/sdk/js`
- Core chain: `packages/codex-runtime` -> `packages/plugin`
- Delivery chain: `packages/desktop` -> `packages/app`, `packages/ui`
- Delivery chain: `packages/desktop-electron` -> `packages/app`, `packages/ui`
- Delivery chain: `packages/slack` -> `packages/sdk/js`
- Delivery chain: `github` -> `packages/sdk/js`
- Delivery chain: `packages/web` is mostly separate from the main workspace dependency chain
- Delivery chain: `packages/web-legacy` is mostly separate from the main workspace dependency chain and is deprecated
- Hosted chain: `packages/console/app` -> `packages/console/core`, `packages/console/mail`, `packages/console/resource`, `packages/ui`
- Hosted chain: `packages/console/core` -> `packages/console/mail`, `packages/console/resource`
- Hosted chain: `packages/console/function` -> `packages/console/core`, `packages/console/resource`
- Hosted chain: `packages/function` and `packages/enterprise` sit adjacent to the hosted stack, but are not direct dependencies of the `packages/console/*` chain in package manifests

---

## Check workspaces

Root `package.json` currently declares these workspace globs:

- `packages/*`
- `packages/console/*`
- `packages/sdk/js`
- `packages/slack`

This pulls in most first-level packages by pattern, with `packages/sdk/js` and `packages/slack` listed explicitly.

---

## Flag candidates

Likely review targets for a lean Symbolic fork include duplicate delivery shells like `packages/desktop-electron`, optional channels like `packages/slack`, `sdks/vscode`, and `github`, support surfaces like `packages/storybook`, and the deprecated `packages/web-legacy` package.

Hosted packages such as `packages/console/*`, `packages/function`, and `packages/enterprise` also look like candidates if the fork stays local-first. `packages/web` is the new public web entry point. `packages/web-legacy` should stay deprecated unless the fork decides to keep the old hosted docs/share surface.
