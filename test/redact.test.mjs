import assert from "node:assert/strict";
import { test } from "node:test";
import { describeTarget, redactArgs, redactText, redactUrl, scrub, secretValues } from "../dist/redact.js";

test("redactArgs masks the value following a secret-looking flag", () => {
  assert.deepEqual(redactArgs(["--api-key", "abc123", "--port", "80"]), ["--api-key", "***", "--port", "80"]);
});

test("redactArgs masks --flag=value and KEY=value forms", () => {
  assert.deepEqual(redactArgs(["--token=abc", "GITHUB_TOKEN=zzz", "--name=ok"]), ["--token=***", "GITHUB_TOKEN=***", "--name=ok"]);
});

test("redactArgs masks well-known secret shapes in bare arguments", () => {
  const [out] = redactArgs(["ghp_abcdefghijklmnopqrstuvwxyz0123456789"]);
  assert.equal(out, "***");
});

test("redactUrl removes credentials and secret query params", () => {
  const out = redactUrl("https://user:pw@example.com/mcp?api_key=SECRETVALUE&page=2");
  assert.ok(!out.includes("pw@") && !out.includes("SECRETVALUE"), out);
  assert.ok(out.includes("page=2"));
});

test("redactText masks bearer tokens and JWTs", () => {
  assert.ok(!redactText("Authorization: Bearer abcdefghijklmnop").includes("abcdefghijklmnop"));
  assert.ok(!redactText("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.sig").includes("eyJhbGci"));
});

test("scrub removes literal env and header values from error text", () => {
  const spec = { name: "x", transport: "stdio", env: { DB_PASS: "hunter2-hunter2" }, headers: { Authorization: "Bearer tok-0123456789" } };
  const secrets = secretValues(spec);
  const text = scrub("connect failed: hunter2-hunter2 and tok-0123456789", secrets);
  assert.ok(!text.includes("hunter2") && !text.includes("tok-0123456789"), text);
});

test("describeTarget never includes env values", () => {
  const spec = { name: "x", transport: "stdio", command: "node", args: ["server.js"], env: { SECRET: "do-not-print" } };
  assert.equal(describeTarget(spec), "node server.js");
});
