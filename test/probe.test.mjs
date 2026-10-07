import assert from "node:assert/strict";
import { test } from "node:test";
import { probeAll, probeServer } from "../dist/probe.js";
import { fakeSpec } from "./helpers.mjs";

const opts = { timeoutMs: 10_000 };

test("probes a stdio server and counts N tools with token estimates", async () => {
  const r = await probeServer(fakeSpec("s", ["--tools=7"]), opts);
  assert.equal(r.status, "ok");
  assert.equal(r.tools.length, 7);
  assert.ok(r.toolTokens > 0);
  assert.equal(r.toolTokens, r.tools.reduce((n, t) => n + t.tokens, 0));
});

test("more tools weigh more", async () => {
  const [small, big] = await probeAll([fakeSpec("a", ["--tools=2"]), fakeSpec("b", ["--tools=20"])], opts);
  assert.ok(big.toolTokens > small.toolTokens * 5);
});

test("follows pagination", async () => {
  const r = await probeServer(fakeSpec("s", ["--tools=5", "--page=2"]), opts);
  assert.equal(r.tools.length, 5);
});

test("lists prompts separately from tool weight", async () => {
  const r = await probeServer(fakeSpec("s", ["--tools=1", "--prompts=3"]), opts);
  assert.equal(r.others.filter((o) => o.kind === "prompt").length, 3);
  assert.ok(r.otherTokens > 0);
});

test("a server without capabilities is ok and empty", async () => {
  const r = await probeServer(fakeSpec("s", ["--empty"]), opts);
  assert.equal(r.status, "ok");
  assert.equal(r.tools.length, 0);
});

test("a hanging server times out and the child is cleaned up", async () => {
  const started = Date.now();
  const r = await probeServer(fakeSpec("s", ["--hang"]), { timeoutMs: 800 });
  assert.equal(r.status, "timeout");
  assert.ok(Date.now() - started < 5000);
});

test("a crashing server reports an error with the secret scrubbed from stderr", async () => {
  const spec = fakeSpec("s", ["--crash"], { env: { FAKE_SECRET: "super-secret-value-123" } });
  const r = await probeServer(spec, opts);
  assert.equal(r.status, "error");
  assert.ok(!JSON.stringify(r).includes("super-secret-value-123"), JSON.stringify(r));
});

test("a missing command is an error, not a crash", async () => {
  const r = await probeServer(fakeSpec("s", [], { command: "definitely-not-a-real-binary-xyz", args: [] }), opts);
  assert.equal(r.status, "error");
});

test("disabled servers are skipped, not launched", async () => {
  const r = await probeServer(fakeSpec("s", ["--hang"], { disabled: true }), opts);
  assert.equal(r.status, "skipped");
});
