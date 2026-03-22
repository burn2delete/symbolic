import type { Session } from "../shared/api";

import { live } from "./term-data";

export const plain = (session: Session) => /^Session \d+$/.test(session.title);
export const trail = (dir: string) => dir.replace(/^\/Users\/[^/]+/, "~");
export const clip = (text: string, size = 24) =>
  text.replace(/\s+/g, " ").trim().slice(0, size);

export const leaf = (dir: string) => {
  const list = dir.split("/").filter(Boolean);
  return list.at(-1) || dir || "Home";
};

export const hint = (session: Session) => {
  if (live(session.state) && session.pid) return `PID ${session.pid}`;
  if (session.state === "exited" && session.exit_code !== null)
    return `Exit ${session.exit_code}`;
  if (session.state === "failed" && session.note) return clip(session.note);
  return null;
};

export const label = (session: Session) => {
  if (session.title && !plain(session)) return session.title;
  return leaf(session.cwd);
};

export const meta = (session: Session) => {
  const list = [trail(session.cwd), session.launch.name];
  const bit = hint(session);
  if (bit) list.push(bit);
  return list.join(" · ");
};

export const line = (session: Session) => {
  const list = [session.launch.name];
  const bit = hint(session);
  if (bit) list.push(bit);
  return list.join(" · ");
};

export const parts = (dir: string) => {
  if (dir === "/") return { lead: "/", tail: "" };
  const cut = dir.lastIndexOf("/");
  if (cut < 1) return { lead: cut === 0 ? "/" : "", tail: dir.slice(cut + 1) };
  return { lead: dir.slice(0, cut + 1), tail: dir.slice(cut + 1) };
};

export const pick = (list: Session[], id: string | null) =>
  list.find((item) => item.id === id) ?? list[0] ?? null;

export const merge = (list: Session[], session: Session) => {
  const idx = list.findIndex((item) => item.id === session.id);
  if (idx === -1) return [...list, session];
  return list.map((item) => (item.id === session.id ? session : item));
};

export const unpack = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};
