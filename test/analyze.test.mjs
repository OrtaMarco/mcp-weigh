import assert from "node:assert/strict";
import { test } from "node:test";
import { analyze, findDuplicates, normalizeName } from "../dist/analyze.js";
import { formatJson, formatMarkdown, formatTable } from "../dist/format.js";

function server(name, tools, status = "ok") {
  const entries = tools.map(([tool, description, tokens = 50]) => ({ name: tool, description, tokens }));
  return {
    name, client: "test", transport: "stdio", target: "x", status, tools: entries, others: [],
    toolTokens: entries.reduce((n, t) => n + t.tokens, 0), otherTokens: 0, durationMs: 1,
  };
}
const opts = { cwd: "/p", longChars: 100, similarity: 0.8 };

test("normalizeName unifies case and separators", () => {
  assert.equal(normalizeName("searchRepos"), "search_repos");
  assert.equal(normalizeName("Search-Repos"), "search_repos");
});

test("exact duplicates across servers are grouped; same-server repeats are not", () => {
  const groups = findDuplicates(
    [server("a", [["read_file", "Read a file"], ["read-file", "Read again"]]), server("b", [["readFile", "Read a file from disk"]])],
    0.8,
  );
  assert.equal(groups.length, 1);
  assert.equal(groups[0].kind, "exact");
  assert.equal(groups[0].members.length, 3);
  assert.equal(findDuplicates([server("a", [["x_one", "Alpha beta gamma"], ["x_one2", "Alpha beta gamma"]])], 0.8).length, 0);
});

test("near duplicates need similar name AND description", () => {
  const desc = "Search the web for pages matching a query and return titles and urls";
  const near = findDuplicates([server("a", [["web_search", desc]]), server("b", [["search_web", desc]])], 0.8);
  assert.equal(near.length, 1);
  assert.equal(near[0].kind, "near");
  const apart = findDuplicates(
    [server("a", [["web_search", desc]]), server("b", [["create_invoice", "Create a billing invoice for a customer account"]])],
    0.8,
  );
  assert.equal(apart.length, 0);
});

test("report totals, shares and sorting", () => {
  const r = analyze([server("small", [["a", "d", 100]]), server("big", [["b", "d", 300]])], opts);
  assert.equal(r.totalTokens, 400);
  assert.equal(r.totalTools, 2);
  assert.deepEqual(r.servers.map((s) => s.name), ["big", "small"]);
  assert.equal(r.servers[0].share, 0.75);
});

test("long descriptions and suggestions", () => {
  const r = analyze(
    [server("a", [["t", "y".repeat(500), 400]]), server("b", [["u", "short", 10]]), server("dead", [], "error"), server("empty", [])],
    opts,
  );
  assert.equal(r.longDescriptions.length, 1);
  const kinds = r.suggestions.map((s) => s.kind);
  assert.ok(kinds.includes("long-descriptions") && kinds.includes("heavy-server") && kinds.includes("failed-server") && kinds.includes("empty-server"));
});

test("a single server is never called 'heavy'", () => {
  const r = analyze([server("only", [["t", "d", 999]])], opts);
  assert.ok(!r.suggestions.some((s) => s.kind === "heavy-server"));
});

test("all formats render and flag the estimate", () => {
  const r = analyze([server("a", [["t", "d", 10]])], opts);
  assert.match(formatTable(r), /SERVER[\s\S]*TOTAL/);
  assert.match(formatTable(r), /estimates/);
  assert.match(formatMarkdown(r), /\| SERVER \|/);
  const json = JSON.parse(formatJson(r));
  assert.equal(json.totalTokens, 10);
  assert.equal(json.servers[0].tools[0].description, undefined);
});
