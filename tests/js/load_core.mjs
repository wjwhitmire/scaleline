// Load the browser core (web/src/core/*.js joined in name order) into a node:vm context.
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

export const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const coreDir = join(root, "web", "src", "core");
export const coreSource = readdirSync(coreDir).filter((f) => f.endsWith(".js")).sort()
  .map((f) => readFileSync(join(coreDir, f), "utf8")).join("\n");
export function loadCore() {
  const ctx = vm.createContext({});
  vm.runInContext('"use strict";\n' + coreSource + "\n;globalThis.CORE = CORE;", ctx, { filename: "core.js" });
  return ctx.CORE;
}
