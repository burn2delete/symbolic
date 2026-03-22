import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
