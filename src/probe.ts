import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport as McpTransport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { describeTarget, scrub, secretValues } from "./redact.js";
import { estimateJsonTokens } from "./tokens.js";
import type { OtherEntry, ProbeStatus, ServerResult, ServerSpec, ToolEntry } from "./types.js";

export interface ProbeOptions {
  /** Per-server time budget in milliseconds, covering connect and all list calls. */
  timeoutMs: number;
}

class ProbeTimeout extends Error {
  constructor(ms: number) {
    super(`no response within ${ms} ms`);
  }
}

const CLIENT_INFO = { name: "mcp-weigh", version: "0.1.0" };
const STDERR_TAIL = 400;

function withDeadline<T>(work: Promise<T>, ms: number, onTimeout: () => void): Promise<T> {
  let timer: NodeJS.Timeout;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      onTimeout();
      reject(new ProbeTimeout(ms));
    }, ms);
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

/** Follows `nextCursor` until the server has no more pages. */
async function listAll<T>(page: (cursor?: string) => Promise<{ items: T[]; nextCursor?: string }>): Promise<T[]> {
  const items: T[] = [];
  let cursor: string | undefined;
  do {
    const res = await page(cursor);
    items.push(...res.items);
    cursor = res.nextCursor;
  } while (cursor);
  return items;
}

function isAuthError(error: unknown): boolean {
  if (error instanceof UnauthorizedError) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /\b401\b|unauthori[sz]ed/i.test(message);
}

/** Collects a stdio child's stderr tail so failures are explainable. */
function captureStderr(transport: StdioClientTransport): () => string {
  let tail = "";
  transport.stderr?.on("data", (chunk: Buffer) => {
    tail = (tail + chunk.toString("utf8")).slice(-STDERR_TAIL);
  });
  return () => tail.trim();
}

async function catalog(client: Client): Promise<{ tools: ToolEntry[]; others: OtherEntry[] }> {
  const caps = client.getServerCapabilities() ?? {};
  const tools: ToolEntry[] = [];
  const others: OtherEntry[] = [];

  if (caps.tools) {
    const page = async (cursor?: string) => {
      const r = await client.listTools({ cursor });
      return { items: r.tools, nextCursor: r.nextCursor };
    };
    for (const t of await listAll(page)) {
      tools.push({
        name: t.name,
        description: t.description ?? "",
        tokens: estimateJsonTokens({ name: t.name, description: t.description, input_schema: t.inputSchema }),
      });
    }
  }
  if (caps.prompts) {
    const page = async (cursor?: string) => {
      const r = await client.listPrompts({ cursor });
      return { items: r.prompts, nextCursor: r.nextCursor };
    };
    for (const p of await listAll(page)) {
      others.push({
        kind: "prompt",
        name: p.name,
        tokens: estimateJsonTokens({ name: p.name, description: p.description, arguments: p.arguments }),
      });
    }
  }
  if (caps.resources) {
    const resourcePage = async (cursor?: string) => {
      const r = await client.listResources({ cursor });
      return { items: r.resources, nextCursor: r.nextCursor };
    };
    const templatePage = async (cursor?: string) => {
      const r = await client.listResourceTemplates({ cursor });
      return { items: r.resourceTemplates, nextCursor: r.nextCursor };
    };
    for (const r of await listAll(resourcePage)) {
      others.push({
        kind: "resource",
        name: r.name,
        tokens: estimateJsonTokens({ name: r.name, uri: r.uri, description: r.description, mimeType: r.mimeType }),
      });
    }
    for (const r of await listAll(templatePage)) {
      others.push({
        kind: "resourceTemplate",
        name: r.name,
        tokens: estimateJsonTokens({ name: r.name, uriTemplate: r.uriTemplate, description: r.description }),
      });
    }
  }
  return { tools, others };
}

function stdioTransport(spec: ServerSpec): StdioClientTransport {
  return new StdioClientTransport({
    command: spec.command ?? "",
    args: spec.args ?? [],
    env: { ...getDefaultEnvironment(), ...spec.env },
    cwd: spec.cwd,
    stderr: "pipe",
  });
}

function httpTransports(spec: ServerSpec): (() => McpTransport)[] {
  const url = new URL(spec.url ?? "");
  const requestInit = { headers: spec.headers ?? {} };
  const streamable = () => new StreamableHTTPClientTransport(url, { requestInit });
  const sse = () => new SSEClientTransport(url, { requestInit });
  return spec.transport === "sse" ? [sse] : [streamable, sse];
}

async function connectAndList(
  spec: ServerSpec,
  makeTransport: () => McpTransport,
  cleanup: Cleanup,
): Promise<{ tools: ToolEntry[]; others: OtherEntry[] }> {
  const transport = makeTransport();
  if (transport instanceof StdioClientTransport) cleanup.stderr = captureStderr(transport);
  const client = new Client(CLIENT_INFO, { capabilities: {} });
  cleanup.close = () => client.close();
  await client.connect(transport);
  const result = await catalog(client);
  await client.close().catch(() => undefined);
  return result;
}

interface Cleanup {
  close?: () => Promise<void>;
  stderr?: () => string;
}

/** Launches/connects to one server and weighs its catalog. Never throws. */
export async function probeServer(spec: ServerSpec, options: ProbeOptions): Promise<ServerResult> {
  const started = Date.now();
  const secrets = secretValues(spec);
  const base = {
    name: spec.name,
    client: spec.client,
    transport: spec.transport,
    target: scrub(describeTarget(spec), secrets),
  };
  const finish = (status: ProbeStatus, extra: Partial<ServerResult> = {}): ServerResult => ({
    ...base,
    status,
    tools: [],
    others: [],
    toolTokens: 0,
    otherTokens: 0,
    durationMs: Date.now() - started,
    ...extra,
  });

  if (spec.disabled) return finish("skipped", { error: "disabled in config" });

  const cleanup: Cleanup = {};
  const attempts = spec.transport === "stdio" ? [() => stdioTransport(spec)] : httpTransports(spec);
  let lastError: unknown;

  try {
    const run = async () => {
      for (const make of attempts) {
        try {
          return await connectAndList(spec, make, cleanup);
        } catch (error) {
          lastError = error;
          if (isAuthError(error)) throw error;
        }
      }
      throw lastError;
    };
    const { tools, others } = await withDeadline(run(), options.timeoutMs, () => {
      void cleanup.close?.().catch(() => undefined);
    });
    return finish("ok", {
      tools,
      others,
      toolTokens: tools.reduce((n, t) => n + t.tokens, 0),
      otherTokens: others.reduce((n, o) => n + o.tokens, 0),
    });
  } catch (error) {
    void cleanup.close?.().catch(() => undefined);
    const raw = error instanceof Error ? error.message : String(error);
    const tail = cleanup.stderr?.() ?? "";
    const message = scrub(tail ? `${raw} (stderr: ${tail})` : raw, secrets);
    if (error instanceof ProbeTimeout) return finish("timeout", { error: message });
    if (isAuthError(error)) return finish("needs-auth", { error: "server requires authentication (OAuth is not supported)" });
    return finish("error", { error: message });
  }
}

/** Probes servers with bounded concurrency; results keep input order. */
export async function probeAll(
  specs: ServerSpec[],
  options: ProbeOptions & { concurrency?: number },
): Promise<ServerResult[]> {
  const results = new Array<ServerResult>(specs.length);
  let next = 0;
  const worker = async () => {
    while (next < specs.length) {
      const i = next++;
      results[i] = await probeServer(specs[i] as ServerSpec, options);
    }
  };
  await Promise.all(Array.from({ length: Math.min(options.concurrency ?? 4, specs.length) }, worker));
  return results;
}
