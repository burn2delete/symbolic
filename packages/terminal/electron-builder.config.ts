import type { Configuration } from "electron-builder";

const sign = Boolean(process.env.CSC_LINK || process.env.CSC_NAME);
const notarize = Boolean(
  (process.env.APPLE_API_KEY &&
    process.env.APPLE_API_KEY_ID &&
    process.env.APPLE_API_ISSUER) ||
    (process.env.APPLE_ID &&
      process.env.APPLE_APP_SPECIFIC_PASSWORD &&
      process.env.APPLE_TEAM_ID),
);

const cfg: Configuration = {
  appId: "ai.symbolic.terminal.dev",
  productName: "Symbolic Terminal",
  artifactName: "symbolic-terminal-${os}-${arch}.${ext}",
  directories: {
    output: "dist",
    buildResources: "resources",
  },
  files: ["out/**/*"],
  asarUnpack: ["node_modules/node-pty/**/*"],
  extraResources: [
    {
      from: "../symbolic/dist",
      to: "symbolic",
      filter: ["**/*"],
    },
  ],
  mac: {
    category: "public.app-category.developer-tools",
    icon: "terminal-logo.icns",
    hardenedRuntime: sign,
    gatekeeperAssess: false,
    entitlements: "resources/entitlements.plist",
    entitlementsInherit: "resources/entitlements.plist",
    notarize,
    target: ["dir", "zip", "dmg"],
  },
  dmg: {
    sign,
  },
};

export default cfg;
