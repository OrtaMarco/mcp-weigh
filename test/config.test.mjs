import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { discover, expandVars, parseCodexToml, parseJsonConfig } from "../dist/config.js";
import { tmp } from "./helpers.mjs";

test("parseJsonConfig reads stdio, http and sse entries", () => {
  const specs = parseJsonConfig(
    JSON.stringify({
      mcpServers: {
        a: { command: "npx", args: ["-y", "pkg"], env: { K: "v" } },
        b: { type: "http", url: "https://example.com/mcp", headers: { Authorization: "Bearer x" } },
        c: { type: "sse", url: "https://example.com/sse" },
        d: { url: "https://example.com/implicit" },
        bad: { nothing: true },
      },
    }),
    "cursor",
    "f.json",
  );
  assert.deepEqual(specs.map((s) => [s.name, s.transport]), [["a", "stdio"], ["b", "http"], ["c", "sse"], ["d", "http"]]);
  assert.deepEqual(specs[0].env, { K: "v" });
});

test("parseJsonConfig picks per-project servers of ~/.claude.json for the cwd", () => {
  const text = JSON.stringify({
    mcpServers: { user: { command: "u" } },
    projects: { "/work/app": { mcpServers: { local: { command: "l" } } }, "/other": { mcpServers: { nope: { command: "n" } } } },
  });
  const names = parseJsonConfig(text, "claude-code", "f", "/work/app").map((s) => s.name);
  assert.deepEqual(names, ["user", "local"]);
});

test("parseCodexToml reads [mcp_servers.*] tables", () => {
  const specs = parseCodexToml(
    `
[mcp_servers.docs]
command = "npx"
args = ["-y", "docs-mcp"]

[mcp_servers.docs.env]
TOKEN = "abc"

[mcp_servers.remote]
url = "https://example.com/mcp"

[mcp_servers.off]
command = "x"
enabled = false
`,
    "config.toml",
  );
  assert.deepEqual(specs.map((s) => [s.name, s.transport, !!s.disabled]), [["docs", "stdio", false], ["remote", "http", false], ["off", "stdio", true]]);
  assert.deepEqual(specs[0].env, { TOKEN: "abc" });
});

test("expandVars handles ${VAR} and ${VAR:-default}", () => {
  assert.equal(expandVars("a-${X}-${Y:-fallback}-${Z}", { X: "1" }), "a-1-fallback-");
});

test("discover reads every client location and collapses identical definitions", () => {
  const home = tmp();
  const cwd = tmp();
  mkdirSync(join(home, ".cursor"));
  mkdirSync(join(home, ".codex"));
  writeFileSync(join(home, ".claude.json"), JSON.stringify({ mcpServers: { shared: { command: "same" }, only_cc: { command: "cc" } } }));
  writeFileSync(join(home, ".cursor", "mcp.json"), JSON.stringify({ mcpServers: { shared: { command: "same" }, clash: { command: "one" } } }));
  writeFileSync(join(cwd, ".mcp.json"), JSON.stringify({ mcpServers: { clash: { command: "two" } } }));
  writeFileSync(join(home, ".codex", "config.toml"), `[mcp_servers.cx]\ncommand = "cx"\n`);

  const env = { XDG_CONFIG_HOME: join(home, "none"), APPDATA: join(home, "none") };
  const { servers, files } = discover({ cwd, home, env });
  assert.equal(files.length, 4);
  const names = servers.map((s) => s.name).sort();
  assert.deepEqual(names, ["clash@claude-code", "clash@cursor", "cx", "only_cc", "shared"]);
});

test("discover reports unreadable files instead of throwing", () => {
  const dir = tmp();
  const bad = join(dir, "bad.json");
  writeFileSync(bad, "{ not json");
  const result = discover({ cwd: dir }, [bad]);
  assert.equal(result.servers.length, 0);
  assert.equal(result.problems.length, 1);
});
