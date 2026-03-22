import type { Choice, Custom, Launch } from "./api";

export const symbolic = {
  id: "symbolic",
  name: "Symbolic",
  cmd: null,
} satisfies Launch;

export const built = [
  symbolic,
  { id: "codex", name: "Codex", cmd: null },
  { id: "claude", name: "Claude", cmd: null },
  { id: "gemini", name: "Gemini", cmd: null },
  { id: "copilot", name: "Copilot CLI", cmd: null },
  { id: "opencode", name: "OpenCode", cmd: null },
  { id: "ghosty", name: "Ghosty Terminal", cmd: null },
] satisfies Launch[];

export const stock = built.map((item) => ({
  ...item,
  ok: item.id === symbolic.id,
  built: true,
})) satisfies Choice[];

export function choice(item: Custom) {
  return {
    ...item,
    ok: true,
    built: false,
  } satisfies Choice;
}
