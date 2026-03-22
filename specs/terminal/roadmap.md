# Terminal app

Standalone Electron host for the real Symbolic TUI.

---

## Outcome

`packages/terminal` now ships the intended macOS-first host shape: an Electron app that opens directly into Symbolic without requiring Terminal, iTerm, or another shell.

The app embeds PTY-backed terminal sessions, launches the real Symbolic runtime, and keeps `packages/symbolic` as the product source of truth.

---

## Current status

- Engineering work for the macOS-first scope is complete
- `packages/terminal` now covers Electron main, preload, renderer, PTY session management, tabs, menus, settings, diagnostics, recent folders, and open-file handling
- Packaged runtime bundling, package-local docs, macOS packaging config, and smoke coverage are in place
- Verified commands completed successfully:
  - `bun --cwd packages/terminal check`
  - `bun --cwd packages/terminal smoke:package`
  - `bun --cwd packages/terminal package:mac`
- Smoke coverage now verifies session creation, typed input reaching the PTY host path, resize, second-tab creation, runtime probing, and clean quit in both dev and packaged modes
- Overlap review is documented in `packages/terminal/docs/desktop-overlap.md`
- Remaining work is operational release gating: signing and notarization credentials, Finder and Gatekeeper pass, and optional clean-machine distribution validation

---

## Goals

- Launch Symbolic as a standalone app on macOS
- Run the real `symbolic` runtime inside a PTY-backed terminal view
- Support multiple tabs and isolated sessions
- Preserve normal CLI behavior for stdin, stdout, stderr, resize, colors, and key handling
- Keep terminal hosting separate from existing desktop packages
- Leave room for packaging, signing, notarization, and later platform expansion

---

## Non-goals

- Do not reimplement the TUI in renderer-native UI
- Do not fork product logic out of `packages/symbolic` for Electron convenience
- Do not replace `packages/desktop`, `packages/desktop-electron`, or `packages/app`
- Do not target Windows or Linux parity in the first version
- Do not turn the app into a general-purpose terminal emulator

---

## Architecture

`packages/terminal` is implemented as a thin Electron host:

- Main process owns windows, menus, tabs, open-file behavior, diagnostics, and PTY orchestration
- Preload exposes a narrow IPC bridge for sessions, settings, diagnostics, and folder picking
- Renderer hosts xterm-based terminal panes plus lightweight shell UI for tabs, settings, and status
- PTY sessions launch Symbolic and forward input, output, resize, exit state, and restart flows
- `packages/symbolic` remains the real CLI and TUI runtime

This keeps the desktop shell additive and reversible.

---

## Package boundaries

### `packages/terminal`

Owns Electron entrypoints, PTY orchestration, terminal renderer shell, packaging, smoke coverage, settings, diagnostics, recent folders, and app-specific state.

### `packages/symbolic`

Remains the source of truth for the Symbolic CLI and TUI experience.

### `packages/desktop`

Stays independent.

### `packages/desktop-electron`

Still owns its existing Electron surface. No sharing has been extracted yet.

### `packages/app`

Still only receives host-agnostic code when a clear need exists.

---

## Rollout phases

### Phase 0

Validate the technical slice before polishing the app shell.

#### Package scaffold

- [x] Create `packages/terminal` with package metadata, scripts, and workspace wiring
  - [x] Add Electron main, preload, and renderer entrypoints
  - [x] Add dev scripts for running the Electron shell and renderer together
  - [x] Add package-local typecheck, lint, and build commands
  - [x] Document local setup assumptions for Bun, Electron, and native PTY dependencies
- [x] Keep implementation local to `packages/terminal` unless reuse is already obvious

#### PTY spike

- [x] Choose the PTY library and verify Electron compatibility on macOS
  - [x] Confirm native module install flow works in repo development
  - [x] Confirm rebuild steps are deterministic after dependency install
- [x] Implement a PTY manager in the main process
  - [x] Create a session model with id, cwd, env, pid, state, and exit metadata
  - [x] Spawn one PTY-backed process for one session
  - [x] Forward PTY output to the renderer without semantic parsing
  - [x] Forward renderer input back to the PTY
  - [x] Handle resize and explicit termination

#### Terminal surface

- [x] Embed a terminal view in the renderer
  - [x] Connect output streaming to the terminal surface
  - [x] Connect keyboard and paste input to the PTY session
  - [x] Wire resize events from the renderer to the PTY manager
  - [x] Verify ANSI colors and alternate screen behavior with the real TUI
- [x] Keep renderer chrome minimal during the spike
  - [x] Show one terminal pane and one lightweight session status area
  - [x] Avoid building tabs, preferences, or extra shell UI before the PTY path is proven

#### Launch contract

- [x] Define how development launches `symbolic`
  - [x] Resolve the workspace-local entrypoint explicitly
  - [x] Match normal developer invocation as closely as possible
  - [x] Set cwd intentionally for first launch
- [x] Define the initial environment contract
  - [x] Pass through only required variables first
  - [x] Identify macOS Finder launch gaps around `PATH` and runtime discovery
  - [x] Capture any required bootstrap logic without moving TUI behavior out of `packages/symbolic`

#### Validation

- [x] Launch the app from a non-terminal path on macOS and confirm one Symbolic session opens
- [x] Verify typing, navigation keys, paste, resize, and process exit all behave correctly
- [x] Verify no renderer-side TUI reimplementation exists
- [x] Write brief launch notes covering native dependency setup, env assumptions, and known blockers
- [x] Exit check: the team can repeatedly launch real Symbolic in an Electron window without touching Terminal

Notes:

- Validation is backed by the implemented app plus `bun --cwd packages/terminal check`
- Launch and environment notes live in `packages/terminal/README.md`

### Phase 1

Turn the technical slice into a usable MVP shell.

#### Session model

- [x] Expand the main-process session model for multi-session management
  - [x] Track tab order, focused tab, cwd, title, state, and exit reason
  - [x] Support clean create, close, restart, and dispose flows
  - [x] Prevent input or output bleed across sessions
  - [x] Handle renderer reconnects without orphaning session state
- [x] Add conservative tab-close protection
  - [x] Detect active sessions versus exited sessions
  - [x] Prompt before terminating a session that may still be doing work

#### Tab shell

- [x] Build a renderer tab strip and terminal container layout
  - [x] Open a first session automatically on app launch
  - [x] Create a new tab with a fresh PTY-backed Symbolic session
  - [x] Switch focus cleanly between sessions
  - [x] Close tabs and preserve neighboring tab focus
  - [x] Restart a completed or failed session in place
- [x] Add simple tab labeling
  - [x] Start with stable session labels
  - [x] Leave room for cwd-derived titles later without changing the session model

#### App actions

- [x] Add native menus and shortcuts for core flows
  - [x] New tab
  - [x] Close tab
  - [x] Restart session
  - [x] Copy and paste
  - [x] Focus next and previous tab on macOS
- [x] Keep shortcuts aligned with expected macOS behavior where possible

#### Working directory flow

- [x] Define default cwd behavior for first launch
  - [x] Prefer an explicit, deterministic starting directory
  - [x] Avoid depending on Finder inheritance
- [x] Add cwd selection for new sessions
  - [x] Support opening a folder through a native picker
  - [x] Store recent locations in lightweight app state
  - [x] Pass selected cwd directly into PTY spawn config

#### Persistence and errors

- [x] Persist lightweight window state
  - [x] Restore window size and position
  - [x] Restore recent cwd choices if safe
  - [x] Avoid restoring live PTY sessions in this phase
- [x] Add error states for common failures
  - [x] Missing `symbolic` artifact
  - [x] Spawn failure
  - [x] Unexpected PTY exit
  - [x] Renderer reconnect while session still exists

#### Validation

- [x] Verify multiple concurrent sessions can run without process confusion
- [x] Verify each tab keeps isolated input, output, cwd, and exit state
- [x] Verify new tab, close tab, restart, copy, paste, and resize work through menus and shortcuts
- [x] Verify fresh launch and restored window state behave consistently across repeated runs
- [x] Exit check: daily internal use is plausible for macOS users without falling back to Terminal for normal workflows

Notes:

- Validation is backed by implemented session flows and the smoke coverage inside `bun --cwd packages/terminal check`

### Phase 2

Make the app distributable and less developer-dependent.

#### Packaged runtime

- [x] Define the production artifact for `symbolic`
  - [x] Choose whether to bundle a built executable, a packaged Node entrypoint, or a thin launcher
  - [x] Document why the chosen artifact matches local CLI behavior closely enough
  - [x] Verify the artifact can be launched directly from the app bundle
- [x] Implement deterministic artifact resolution in packaged builds
  - [x] Resolve paths relative to the app bundle
  - [x] Avoid repo-relative assumptions
  - [x] Fail with actionable errors when the runtime cannot be found

#### macOS packaging

- [x] Add production packaging for a macOS app bundle
  - [x] Build the Electron app in a reproducible way
  - [x] Include all required renderer assets and native PTY dependencies
  - [x] Include the chosen `symbolic` runtime artifact in the bundle layout
- [x] Define signing and notarization work
  - [x] Confirm what is required for internal distribution first
  - [x] Capture missing credentials or CI prerequisites separately from implementation

#### Diagnostics

- [x] Add lightweight startup and crash diagnostics
  - [x] Log spawn configuration details that are safe to record
  - [x] Record launch failures with enough context to debug cwd, env, and artifact resolution
  - [x] Record PTY exits and crash conditions without inventing product telemetry
- [x] Provide a simple user-visible error surface for startup failures

#### Smoke coverage

- [x] Add packaged smoke checks
  - [x] Confirm the app launches outside the repo
  - [x] Confirm a first Symbolic session opens successfully
  - [x] Confirm keyboard input reaches the PTY host path
  - [x] Confirm resize behavior still works
  - [x] Confirm clean quit still works
  - [x] Confirm at least one additional tab can be created successfully
- [x] Add a release checklist for manual verification on macOS

#### Validation

- [x] Validate packaged launch from an isolated macOS-like environment without repo cwd assumptions
- [x] Verify packaged launch behavior matches development behavior on the common path
- [x] Verify diagnostics are sufficient to debug missing runtime or env issues
- [x] Verify bundle contents and launch resolution remain stable across rebuilds
- [x] Exit check: engineering validation is complete; remaining work is credentialed distribution gating

Notes:

- `bun --cwd packages/terminal smoke:package` covers packaging plus packaged smoke from a temp dir with an isolated home
- Packaged smoke now covers runtime probing, first launch, typed input reaching the PTY host path, resize, second-tab creation, and clean quit
- Signing and notarization are documented operationally in `packages/terminal/docs/release-checklist.md`; credentialed verification is still gated on release credentials
- Clean-machine validation is approximated by launching the packaged app from a temp dir with an isolated home and no repo cwd assumptions

### Phase 3

Improve fit and finish only after the core path is stable.

#### Restore carefully

- [x] Decide whether to restore windows only, recent cwd values, or prior session tabs
  - [x] Prefer restoring shell state conservatively over attempting full process resurrection
  - [x] Define clear behavior for crashed or exited sessions on restore
- [x] Implement only the minimum restoration behavior that reduces startup friction

#### Refine shell behavior

- [x] Improve tab titles and session metadata
  - [x] Consider cwd-derived titles
  - [x] Consider process-derived hints when they are stable
- [x] Add basic settings for launch defaults
  - [x] Default cwd behavior
  - [x] Font options for readability
  - [x] Theme passthrough without forking TUI behavior
- [x] Add open-folder and recent-project flows where they help the launch path

#### Reduce duplication

- [x] Review overlap with `packages/desktop-electron`
  - [x] Identify actual duplicated Electron utilities
  - [x] Document what should stay local versus what could be shared later
  - [x] Keep ownership clear so terminal hosting remains centered in `packages/terminal`

#### Validation

- [x] Verify each shipped enhancement reduces friction without changing the thin-host architecture
- [x] Verify `packages/symbolic` remains the source of truth for the real TUI experience
- [x] Verify no quality-of-life change turns the app into a general-purpose terminal emulator
- [x] Exit check: macOS-first engineering work is complete without changing package boundaries or launch semantics

Notes:

- Settings, recent folders, conservative restore, and the overlap review in `packages/terminal/docs/desktop-overlap.md` are in place
- Optional polish can continue later, but it is not blocking the current macOS-first implementation

---

## Release gates

Implementation is complete for the current scope.

Remaining work is operational, not engineering:

- Signing and notarization credentials need to be available where release artifacts are produced
- Finder and Gatekeeper validation still need a credentialed pass on the packaged app
- Clean-machine distribution validation is still useful, but optional for closing the current implementation roadmap

---

## Milestones

### Milestone 1

Electron window launches one working Symbolic session locally.

Status: complete.

### Milestone 2

Tabs are functional, isolated, and stable for internal use.

Status: complete.

### Milestone 3

Packaged macOS app launches Symbolic outside a developer shell.

Status: complete.

### Milestone 4

Internal users can adopt the app for regular Symbolic workflows.

Status: complete for engineering scope; release rollout remains gated operationally.

---

## Risks

### Environment drift

Finder-launched apps on macOS do not inherit a normal shell environment.

The host now extends `PATH`, sets terminal variables explicitly, and logs launch details, but this remains a release risk worth keeping visible.

### PTY correctness

Terminal emulation edge cases can still affect alternate screen behavior, clipboard flows, and keybindings.

Automated smoke now covers the core shell path in dev and packaged modes, not every possible interactive TUI edge case.

### Packaging the runtime

Bundled runtime placement and launch resolution are implemented and smoke-tested.

The remaining risk is operational: keeping bundle layout stable across releases and validating it on clean machines.

### Scope creep

It is still easy to drift into workspace management or a broader terminal product.

The current implementation stays on the thin-host path and should keep doing so.

### Cross-package overlap

`packages/desktop-electron` may still contain reusable Electron patterns.

The current overlap review is captured in `packages/terminal/docs/desktop-overlap.md`, and extraction should still wait until reuse is concrete.

---

## Open questions

Most early questions now have working answers:

- Development launch artifact: `packages/terminal` launches `bun run --conditions=browser ./src/index.ts` from `packages/symbolic`
- Packaged macOS artifact: the app bundles the built Symbolic runtime under app resources and launches `symbolic` directly from there
- Bootstrap strategy: each tab launches Symbolic directly; environment normalization stays in the host rather than a separate wrapper
- Working directory behavior: first launch uses recent-folder or home-folder defaults from settings, new tabs can use an explicit folder, and open-file events open the containing folder
- MVP macOS integrations: single-instance behavior, menus, shortcuts, open-file handling, recent folders, and window-state persistence are implemented
- Logging policy: local diagnostics and launch logs are acceptable; product telemetry is still intentionally out of scope
- Shared Electron code: no extraction has happened yet, and that is still the right call until duplication is clearer

Remaining open items:

- When to add signing and notarization credentials in CI for broader distribution
- Whether later polish needs richer tab metadata beyond cwd-derived labels
- Whether to add optional clean-machine distribution validation to the regular release cadence

---

## Implementation order

The original order largely held up:

1. Scaffold `packages/terminal` with Electron main, preload, renderer, and scripts
2. Add PTY-backed Symbolic launch in development
3. Prove terminal correctness for input, output, resize, and session lifecycle
4. Define dev and packaged runtime resolution
5. Add a multi-session model in the main process
6. Build tabs, menus, settings, diagnostics, and recent-folder flows
7. Persist lightweight window and folder state
8. Package the macOS app and validate bundled runtime launch
9. Add packaged smoke and release-checklist docs

Next work should stay focused on credentialed release steps, Finder and Gatekeeper validation, and optional clean-machine distribution checks rather than expanding the host surface.
