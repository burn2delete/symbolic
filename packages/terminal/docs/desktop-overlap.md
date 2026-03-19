# Terminal and desktop-electron overlap

`packages/terminal` and `packages/desktop-electron` currently overlap in a few release-facing areas:

- both ship Electron apps through `electron-builder`
- both target macOS packaging first and carry signing or notarization concerns
- both maintain package-local build and packaging scripts instead of a shared workspace helper

Keeping that duplication is reasonable for now.

- `packages/terminal` packages a standalone host around the real terminal runtime and now carries smoke coverage for second-window session creation, PTY input, and clean quit behavior.
- `packages/desktop-electron` packages the broader desktop product, includes updater and channel logic, and has different resource and release needs.
- A shared packaging layer today would likely blur product-specific release checks more than it would remove meaningful maintenance cost.

Practical follow-up:

- keep configs separate until both packages need the same release operation in the same way
- revisit shared helpers only if signing, notarization, or artifact publishing starts drifting in parallel across both packages
