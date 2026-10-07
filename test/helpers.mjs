import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const FAKE = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "fake-server.mjs");

export function tmp() {
  return mkdtempSync(join(tmpdir(), "mcp-weigh-"));
}

/** A stdio ServerSpec running the fake server with the given flags. */
export function fakeSpec(name, flags = [], extra = {}) {
  return {
    name,
    client: "test",
    file: "test",
    transport: "stdio",
    command: process.execPath,
    args: [FAKE, ...flags],
    ...extra,
  };
}

/** Writes a `.mcp.json` style config and returns its path. */
export function writeConfig(dir, servers, file = "mcp.json") {
  const path = join(dir, file);
  const mcpServers = Object.fromEntries(
    Object.entries(servers).map(([name, s]) => [name, { command: process.execPath, args: [FAKE, ...s.flags], env: s.env }]),
  );
  writeFileSync(path, JSON.stringify({ mcpServers }));
  return path;
}

export function capture() {
  const io = { stdout: [], stderr: [], out: (t) => io.stdout.push(t), err: (t) => io.stderr.push(t) };
  return io;
}
