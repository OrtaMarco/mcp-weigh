# Design — mcp-weigh

## Problem

Every MCP server a client connects to injects its tool names, descriptions and JSON
schemas into the model context on every session. With a handful of servers this is
tens of thousands of tokens before the first prompt, and nobody can see it: the
configuration lives in four different files in four different formats.

`mcp-weigh` answers one question: **how much does my configured MCP fleet weigh, and
what can I cut?**

## User

A developer who uses Claude Code, Claude Desktop, Cursor or Codex with several MCP
servers and suspects (correctly) that some of them cost more context than they are
worth.

## Scope v0.1

- Discover server definitions from: Claude Code (`~/.claude.json` top-level and
  per-project servers, project `.mcp.json`), Claude Desktop, Cursor
  (`~/.cursor/mcp.json`, project `.cursor/mcp.json`), Codex (`~/.codex/config.toml`).
  Any file can also be passed explicitly with `--config`.
- Probe each server with the official MCP SDK: spawn stdio servers, connect to
  streamable-HTTP (falling back to SSE) servers; run `tools/list`, `prompts/list`,
  `resources/list` (+ templates). Each call is optional: a server that does not
  support a capability is not an error. Per-server timeout.
- Estimate tokens of the catalog (name + description + input schema per tool, and the
  equivalents for prompts/resources). The estimate is **chars/4** by default, an
  approximation: there is no local official Claude tokenizer. Documented as such in
  every report.
- Report: per-server table (tools, prompts, resources, tokens, % of total), exact and
  near-duplicate tools across servers, over-long descriptions, pruning suggestions.
- Output: `table` (default), `json`, `markdown`.
- `--server <name>` to probe only some servers; `--timeout`; `--config`.
- Secrets: environment variables and headers are used to launch/connect but are never
  printed, not even their names. Command lines and URLs are redacted (secret-looking
  flags, `KEY=value`, URL credentials, well-known token shapes) and error messages
  (including a child's stderr tail) are scrubbed of every literal env/header value.

## Non-goals

- No runtime instrumentation, call logging or cost tracking (that is what
  [mcpwatch](https://www.npmjs.com/package/@sreelal727/mcpwatch) `init`/`cost` does).
- No editing of client configs. mcp-weigh is read-only; suggestions are text.
- No exact Claude token counts, no dollar costs.
- No OAuth flows for remote servers (those report `needs auth`).

## Competitors

Searched npm / the web on 2026-10-06:

| Project | What it is | Overlap |
|---|---|---|
| `@sreelal727/mcpwatch` | CLI; `audit` spawns configured servers and itemises token cost, `cost` tracks real calls and ranks unused servers | Same core measurement. Reads Claude Code, Desktop, Cursor, Codex. |
| `mcp-checkup` | MCP server (not a CLI) that measures per-server token cost and finds duplicate tool names | Name-level duplicates only, runs inside the client it audits (and therefore costs context). |
| `mcp-compressor` (Atlassian Labs) | Proxy that compresses tool descriptions at runtime | Fix, not a measurement. |

**Honest position:** the basic "weigh my servers" idea is already covered by
`mcpwatch audit`. mcp-weigh is deliberately smaller and differs in:

1. **Near-duplicate detection across servers** (name normalisation + description
   similarity), not just identical names.
2. **Description linting**: flags long descriptions, including ones over the 2 KB
   truncation some clients apply (see Open questions).
3. **Standalone, read-only, zero-instrumentation**: one command, nothing installed
   in your clients, plus `markdown` and `json` output designed to paste into an issue
   or a doc.
4. **Redaction as a stated guarantee**, with tests.

## CLI

```
mcp-weigh [options]

  -s, --server <name>     only this server (repeatable)
  -c, --config <path>     read this config file (repeatable); skips auto-discovery
  -f, --format <fmt>      table | json | markdown   (default: table)
  -t, --timeout <ms>      per-server timeout        (default: 15000)
      --cwd <dir>         project directory for .mcp.json and per-project servers
      --long <chars>      description length flagged as long (default: 1000)
      --similarity <0-1>  near-duplicate threshold  (default: 0.8)
      --list              list what would be probed and exit; launches nothing
  -h, --help / -v, --version
```

Exit codes: `0` ok, `1` at least one server failed to probe, `2` usage error.

## Architecture

```
src/config.ts    discover + parse configs  -> ServerSpec[]
src/redact.ts    secret redaction
src/probe.ts     MCP SDK client            -> Catalog
src/tokens.ts    estimator
src/analyze.ts   totals, duplicates, long descriptions, suggestions -> Report
src/format.ts    table | json | markdown
src/cli.ts       argument parsing, orchestration
```

Tests use a local fake MCP server (`test/fixtures/fake-server.mjs`) built on the SDK
that exposes N tools. Real servers of the developer's machine are never launched by
the test suite.

## Open questions (TODO verificar)

- The 2 KB truncation of tool descriptions is observed behaviour in one client
  version, not a documented MCP rule. Long-description threshold is configurable and
  the 2 KB claim is not asserted by the tool.
- Exact config schemas of each client may drift; parsers are tolerant and covered by
  fixture files modelled on public documentation.
