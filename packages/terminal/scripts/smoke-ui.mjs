import { js, send } from "./smoke-cdp.mjs";

export async function term(sock) {
  return (await js(
    sock,
    `(() => {
      const host = document.querySelector('[data-host="terminal"]');
      const box = host instanceof HTMLElement ? host.getBoundingClientRect() : null;
      const root = host?.querySelector('.xterm');
      const area = host?.querySelector('.xterm-helper-textarea');
      const screen = host?.querySelector('.xterm-screen');
      const text = document.body.innerText ?? "";
      return {
        area: area instanceof HTMLTextAreaElement,
        host: host instanceof HTMLElement,
        live: !!host && !!root && !!screen && !!area,
        loading: text.includes("Loading terminal..."),
        tall: (box?.height ?? 0) > 0,
        wide: (box?.width ?? 0) > 0,
      };
    })()`,
  )) ?? null;
}

export async function focus(sock) {
  return !!(await js(
    sock,
    `(() => {
      const area = document.querySelector('[data-host="terminal"] .xterm-helper-textarea');
      if (!(area instanceof HTMLTextAreaElement)) return false;
      area.focus();
      return document.activeElement === area;
    })()`,
  ));
}

export async function type(sock, text) {
  await send(sock, "Input.insertText", { text });
}

export async function enter(sock) {
  await send(sock, "Input.insertText", { text: "\r" });
}
