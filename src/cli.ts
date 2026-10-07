#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { DEFAULT_LONG_CHARS, DEFAULT_SIMILARITY, analyze } from "./analyze.js";
import { discover } from "./config.js";
import { FORMATS, format, type Format } from "./format.js";
import { probeAll } from "./probe.js";
import { describeTarget } from "./redact.js";

export interface Io {
  out: (text: string) => void;
  err: (text: string) => void;
}

const DEFAULT_TIMEOUT_MS = 15_000;

const HELP = `mcp-weigh — weigh your MCP server fleet

Usage: mcp-weigh [options]

Options:
  -s, --server <name>     only this server (repeatable)
  -c, --config <path>     read this config file (repeatable); skips auto-discovery
  -f, --format <fmt>      table | json | markdown            (default: table)
  -t, --timeout <ms>      per-server timeout                 (default: ${DEFAULT_TIMEOUT_MS})
      --cwd <dir>         project directory for .mcp.json and per-project servers
      --long <chars>      description length flagged as long (default: ${DEFAULT_LONG_CHARS})
      --similarity <0-1>  near-duplicate threshold           (default: ${DEFAULT_SIMILARITY})
      --list              show the servers that would be probed and exit; starts nothing
  -h, --help              show this help
  -v, --version           show the version

Reads Claude Code, Claude Desktop, Cursor and Codex configs. Environment variables,
headers and secret-looking arguments are never printed. Token counts are estimates.
`;

function version(): string {
  const pkg = new URL("../package.json", import.meta.url);
  return (JSON.parse(readFileSync(pkg, "utf8")) as { version: string }).version;
}

class UsageError extends Error {}

function positive(value: string, flag: string): number {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) throw new UsageError(`${flag} must be a positive number, got "${value}"`);
  return num;
}

export async function run(argv: string[], io: Io): Promise<number> {
  try {
    const { values } = parseArgs({
      args: argv,
      allowPositionals: false,
      options: {
        server: { type: "string", short: "s", multiple: true },
        config: { type: "string", short: "c", multiple: true },
        format: { type: "string", short: "f", default: "table" },
        timeout: { type: "string", short: "t", default: String(DEFAULT_TIMEOUT_MS) },
        cwd: { type: "string" },
        long: { type: "string", default: String(DEFAULT_LONG_CHARS) },
        similarity: { type: "string", default: String(DEFAULT_SIMILARITY) },
        list: { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
        version: { type: "boolean", short: "v", default: false },
      },
    });

    if (values.help) return io.out(HELP), 0;
    if (values.version) return io.out(version()), 0;

    const fmt = values.format as Format;
    if (!FORMATS.includes(fmt)) throw new UsageError(`--format must be one of ${FORMATS.join(", ")}`);
    const timeoutMs = positive(values.timeout as string, "--timeout");
    const longChars = positive(values.long as string, "--long");
    const similarity = Number(values.similarity);
    if (!(similarity > 0 && similarity <= 1)) throw new UsageError("--similarity must be in (0, 1]");

    const cwd = resolve(values.cwd ?? process.cwd());
    const found = discover({ cwd }, values.config?.length ? values.config : undefined);
    for (const problem of found.problems) io.err(`warning: could not read ${problem}`);

    let specs = found.servers;
    if (values.server?.length) {
      const wanted = new Set(values.server);
      specs = specs.filter((s) => wanted.has(s.name) || wanted.has(s.name.split("@")[0] as string));
      if (specs.length === 0) throw new UsageError(`no configured server matches: ${values.server.join(", ")}`);
    }
    if (specs.length === 0) {
      io.err("No MCP servers found. Looked in Claude Code, Claude Desktop, Cursor and Codex configs; use --config <file> to point at one.");
      return 0;
    }

    if (values.list) {
      for (const s of specs) io.out(`${s.name}\t${s.client}\t${s.transport}\t${describeTarget(s)}${s.disabled ? "\t(disabled)" : ""}`);
      return 0;
    }

    io.err(`Probing ${specs.length} server(s) with a ${timeoutMs} ms timeout each…`);
    const results = await probeAll(specs, { timeoutMs });
    const report = analyze(results, { cwd, longChars, similarity });
    io.out(format(report, fmt));
    return results.some((r) => r.status !== "ok" && r.status !== "skipped") ? 1 : 0;
  } catch (error) {
    if (error instanceof UsageError || (error as NodeJS.ErrnoException).code?.startsWith("ERR_PARSE_ARGS")) {
      io.err(`error: ${(error as Error).message}\nTry: mcp-weigh --help`);
      return 2;
    }
    io.err(`error: ${(error as Error).message}`);
    return 2;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  run(process.argv.slice(2), {
    out: (text) => process.stdout.write(`${text}\n`),
    err: (text) => process.stderr.write(`${text}\n`),
  }).then((code) => {
    process.exitCode = code;
  });
}
