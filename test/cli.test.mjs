import assert from "node:assert/strict";
import { test } from "node:test";
import { run } from "../dist/cli.js";
import { capture, tmp, writeConfig } from "./helpers.mjs";

const SECRET = "sk-live-0123456789abcdefghij";

test("end to end: weighs a fleet of fake servers and never prints env secrets", async () => {
  const dir = tmp();
  const config = writeConfig(dir, {
    big: { flags: ["--tools=12", "--prefix=big"], env: { API_TOKEN: SECRET } },
    small: { flags: ["--tools=2", "--prefix=small"] },
  });
  const io = capture();
  const code = await run(["--config", config, "--timeout", "10000"], io);
  const out = io.stdout.join("\n");
  assert.equal(code, 0, io.stderr.join("\n"));
  assert.match(out, /big[\s\S]*small/);
  assert.match(out, /TOTAL\s+14/);
  assert.ok(!out.includes(SECRET) && !io.stderr.join("").includes(SECRET));
});

test("--format json is valid JSON and --server filters", async () => {
  const dir = tmp();
  const config = writeConfig(dir, { a: { flags: ["--tools=3"] }, b: { flags: ["--tools=4"] } });
  const io = capture();
  assert.equal(await run(["-c", config, "-s", "b", "-f", "json"], io), 0);
  const report = JSON.parse(io.stdout.join("\n"));
  assert.deepEqual(report.servers.map((s) => s.name), ["b"]);
  assert.equal(report.totalTools, 4);
});

test("detects duplicates between two servers", async () => {
  const dir = tmp();
  const config = writeConfig(dir, {
    one: { flags: ["--tools=0", "--named=web_search:Search the web for pages matching a query"] },
    two: { flags: ["--tools=0", "--named=web_search:Search the web for pages matching a query"] },
  });
  const io = capture();
  await run(["-c", config, "-f", "markdown"], io);
  assert.match(io.stdout.join("\n"), /same name.*one:web_search.*two:web_search/);
});

test("a failing server gives exit code 1 but still reports the others", async () => {
  const dir = tmp();
  const config = writeConfig(dir, { ok: { flags: ["--tools=2"] }, boom: { flags: ["--crash"], env: { FAKE_SECRET: SECRET } } });
  const io = capture();
  const code = await run(["-c", config], io);
  assert.equal(code, 1);
  const out = io.stdout.join("\n");
  assert.match(out, /Failed servers/);
  assert.ok(!out.includes(SECRET));
});

test("--list launches nothing and redacts arguments", async () => {
  const dir = tmp();
  const { writeFileSync } = await import("node:fs");
  const path = `${dir}/c.json`;
  writeFileSync(path, JSON.stringify({ mcpServers: { x: { command: "does-not-exist", args: ["--token", SECRET], env: { A: SECRET } } } }));
  const io = capture();
  assert.equal(await run(["-c", path, "--list"], io), 0);
  const out = io.stdout.join("\n");
  assert.match(out, /does-not-exist --token \*\*\*/);
  assert.ok(!out.includes(SECRET));
});

test("usage errors exit 2", async () => {
  for (const args of [["--format", "xml"], ["--timeout", "-3"], ["--bogus"], ["-c", "/nonexistent.json", "-s", "nope"]]) {
    const io = capture();
    assert.equal(await run(args, io), 2, args.join(" "));
  }
});

test("--help and --version", async () => {
  const io = capture();
  assert.equal(await run(["--help"], io), 0);
  assert.match(io.stdout.join(""), /Usage: mcp-weigh/);
  const v = capture();
  assert.equal(await run(["--version"], v), 0);
  assert.match(v.stdout.join(""), /^\d+\.\d+\.\d+$/);
});
