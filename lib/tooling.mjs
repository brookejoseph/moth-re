import { spawnSync } from "node:child_process";

export function runTool(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: options.maxBuffer ?? 128 * 1024 * 1024
  });

  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    command: [command, ...args].join(" ")
  };
}

export function commandExists(command) {
  const result = spawnSync("which", [command], { encoding: "utf8" });
  return result.status === 0;
}

export function availableTools() {
  const tools = ["file", "lipo", "otool", "nm", "objdump", "strings", "r2", "rabin2"];
  return Object.fromEntries(tools.map((tool) => [tool, commandExists(tool)]));
}
