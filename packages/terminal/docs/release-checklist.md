# Terminal release checklist

## macOS prerequisites

- Apple Developer account with a `Developer ID Application` certificate installed in the keychain or exposed through `CSC_LINK` and `CSC_KEY_PASSWORD`.
- Notarization env vars available in the packaging shell or CI: `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID`.
- Xcode command line tools installed so codesign, zip validation, and notarization tooling are available.
- `bun install` completed after any Electron or `node-pty` change so native deps are rebuilt for the current Electron version.
- `packages/symbolic/dist` regenerated with `bun run build:runtime` before packaging.

## Packaging flow

1. Run `bun run check` in `packages/terminal`.
2. Run `bun run smoke:package` for an unsigned internal build, or `bun run package:mac` when CI already performs smoke separately.
3. Confirm `packages/terminal/dist/` contains both the macOS zip and unpacked `.app` bundle.
4. If signing is enabled, verify the build log shows codesign and notarization steps instead of unsigned output.

## Automated coverage today

- `smoke:dev` launches the built local Electron app under an isolated temp home, types into the active terminal through Chromium DevTools, confirms the session buffer reflects that input, resizes the BrowserWindow, opens a second session, confirms it appears as a new Chromium page target with a working session, and verifies the app can quit cleanly after the sessions exit.
- `smoke:packaged` extracts the packaged macOS zip to a temp dir, validates the bundled Symbolic runtime with `symbolic --version`, and runs the same Electron-driven input, second-window session creation, resize, and clean-quit smoke from a non-repo cwd.
- Automated smoke no longer depends on macOS `System Events`, Automation approval, or Accessibility approval.
- Automated smoke still does not assert multi-window focus behavior beyond page-target creation, deep TUI semantics like paste and alternate screen behavior, interactive command flows beyond a simple echoed command, or close warnings. Keep those in the manual pass.

## Manual release pass

1. Launch the packaged app from Finder on macOS.
2. Confirm the first Symbolic session opens without a missing-runtime or missing-Bun error.
3. Create a second window from the app UI and confirm it opens a fresh Symbolic session.
4. Resize the window, switch between windows, and confirm the active session stays responsive.
5. Close a running window and confirm the close warning appears.
6. Relaunch the app from Finder after a clean quit and confirm it still opens without Terminal.
7. If signing is enabled, run `spctl --assess --type execute "<path-to-app>"` and confirm Gatekeeper accepts the bundle.

## Follow-up gaps

- Add a packaged smoke assertion for clipboard paste once there is a stable, non-invasive way to observe TUI input handling.
- Add CI wiring for signing secrets and notarization only after internal unsigned distribution is stable.
- Add a clean-machine or clean-user-account validation pass before broader rollout.

## Related notes

- Packaging overlap with `packages/desktop-electron` is tracked in `packages/terminal/docs/desktop-overlap.md`.
