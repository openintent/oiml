// Created once by OSL (@osl/backend-hono-trpc-vite). Starts the API (tsx watch) and the Vite dev server together; stopping one stops both.
// You own this file: OSL never rewrites it.

import { spawn } from "node:child_process";
import path from "node:path";

const bin = name => path.join("node_modules", ".bin", name);
const options = { stdio: "inherit", shell: process.platform === "win32" };
const children = [spawn(bin("tsx"), ["watch", "src/server/main.ts"], options), spawn(bin("vite"), [], options)];

const stop = () => {
  for (const child of children) child.kill();
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
for (const child of children) {
  child.on("exit", code => {
    stop();
    process.exit(code ?? 0);
  });
}
