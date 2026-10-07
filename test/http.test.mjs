import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { probeServer } from "../dist/probe.js";

function listen(handler) {
  return new Promise((resolve) => {
    const http = createServer(handler);
    http.listen(0, "127.0.0.1", () => resolve({ http, url: `http://127.0.0.1:${http.address().port}/mcp` }));
  });
}

const spec = (url, extra = {}) => ({ name: "remote", client: "test", file: "test", transport: "http", url, ...extra });

test("probes a streamable-HTTP server, sending configured headers", async () => {
  let seenAuth;
  const { http, url } = await listen(async (req, res) => {
    seenAuth = req.headers.authorization;
    const server = new Server({ name: "h", version: "1" }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [{ name: "ping", description: "Ping.", inputSchema: { type: "object", properties: {} } }],
    }));
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => void transport.close());
    await server.connect(transport);
    await transport.handleRequest(req, res);
  });
  try {
    const r = await probeServer(spec(url, { headers: { Authorization: "Bearer test-token-123456" } }), { timeoutMs: 10_000 });
    assert.equal(r.status, "ok", r.error);
    assert.equal(r.tools.length, 1);
    assert.equal(seenAuth, "Bearer test-token-123456");
    assert.ok(!JSON.stringify(r).includes("test-token-123456"));
  } finally {
    http.closeAllConnections();
    http.close();
  }
});

test("a 401 is reported as needs-auth", async () => {
  const { http, url } = await listen((_req, res) => {
    res.writeHead(401, { "content-type": "text/plain" }).end("nope");
  });
  try {
    const r = await probeServer(spec(url), { timeoutMs: 10_000 });
    assert.equal(r.status, "needs-auth");
  } finally {
    http.closeAllConnections();
    http.close();
  }
});

test("an unreachable URL is an error", async () => {
  const r = await probeServer(spec("http://127.0.0.1:1/mcp"), { timeoutMs: 5_000 });
  assert.equal(r.status, "error");
});
