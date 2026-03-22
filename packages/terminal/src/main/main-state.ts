import { Host } from "./host";
import { Sessions } from "./pty";

export const wait: string[] = [];
export const map = new Map<number, Sessions>();
export const allow = new Set<number>();
export const shared = new Host();
