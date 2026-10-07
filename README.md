# mcp-weigh

> How much does your MCP server fleet weigh? One command, read-only.

[![CI](https://github.com/OrtaMarco/mcp-weigh/actions/workflows/ci.yml/badge.svg)](https://github.com/OrtaMarco/mcp-weigh/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Every MCP server your client connects to puts its tool names, descriptions and JSON
schemas into the model's context, on every session, used or not. With a few servers
that is tens of thousands of tokens before you type anything — and the config is
scattered across four clients.

`mcp-weigh` reads those configs, starts each server (or connects to it), asks for its
catalog with the official MCP SDK, and tells you:

- tools, estimated tokens and share of the total **per server**
- **duplicate and near-duplicate tools** across servers
- **over-long descriptions**
- **pruning suggestions** with the tokens they could save

[Español abajo](#español).

## Quick start

```bash
npx mcp-weigh                    # table for everything it finds
npx mcp-weigh -f markdown        # paste-able into an issue or a doc
npx mcp-weigh -s github -f json  # one server, machine-readable
```

Requires Node 20+. Nothing is installed in your clients and no config is modified.

### Example output

Illustrative, from the fake servers used in this repo's tests:

```
SERVER   CLIENT  TOOLS  TOKENS   SHARE  PROMPTS/RESOURCES
-------  ------  -----  ------  ------  -----------------
docs     custom     15   1,145   75.4%  -
browser  custom      6     319   21.0%  -
tiny     custom      1      55    3.6%  2 (~26)
broken   custom      -       -   error  -
TOTAL               22   1,519  100.0%

Duplicate / overlapping tools:
  [similar (1.00)] docs:web_search  ~  browser:search_web

Suggestions:
  - docs is 75% of the fleet (15 tools, ~76 tokens each). Disable it where unused, or allowlist only the tools you call.
  - 1 tool description(s) are very long; shortening them could save ~196 tokens (assuming half the text goes).
  - broken could not be probed (error); its weight is not counted. Fix or remove it.
```

## What it reads

| Client | Files |
|---|---|
| Claude Code | `~/.claude.json` (user servers and the per-project servers of `--cwd`), `<cwd>/.mcp.json` |
| Claude Desktop | `claude_desktop_config.json` in the platform config dir |
| Cursor | `~/.cursor/mcp.json`, `<cwd>/.cursor/mcp.json` |
| Codex | `~/.codex/config.toml` (`[mcp_servers.*]`; `CODEX_HOME` is honoured) |

Identical definitions found in several files collapse into one; same-named but
different ones are shown as `name@client`. `${VAR}` / `${VAR:-default}` are expanded
from your environment. Use `--config <file>` (repeatable) to read specific files
instead; `.toml` is parsed as Codex, anything else as JSON.

**Important:** the project directory matters. Claude Code keeps some servers per
project, so `mcp-weigh` prints the directory it measured. Run it where you work.

## Options

```
-s, --server <name>     only this server (repeatable)
-c, --config <path>     read this config file (repeatable); skips auto-discovery
-f, --format <fmt>      table | json | markdown            (default: table)
-t, --timeout <ms>      per-server timeout                 (default: 15000)
    --cwd <dir>         project directory for .mcp.json and per-project servers
    --long <chars>      description length flagged as long (default: 1000)
    --similarity <0-1>  near-duplicate threshold           (default: 0.8)
    --list              show the servers that would be probed and exit; starts nothing
```

Exit codes: `0` ok · `1` at least one server could not be probed · `2` usage error.

`--list` is the dry run: it prints each server's client, transport and **redacted**
command without launching anything. Remember that a normal run **does start every
configured stdio server**, exactly as your client would; use `--server` to limit it.

## How the numbers are computed

- **Tokens are an estimate.** There is no official Claude tokenizer that runs locally,
  so `mcp-weigh` uses `ceil(characters / 4)` over the JSON of each tool's name,
  description and input schema. Treat it as a relative measure between servers and an
  order of magnitude overall, not as an invoice. JSON tokenizes somewhat worse than
  prose, so real counts are likely a bit higher.
- **The total counts tools only**, because those are what clients load up front.
  Prompts and resources are listed in their own column.
- Clients with deferred tool loading ("tool search") may not load every definition up
  front; this tool reports the full catalog weight, i.e. the worst case.
- **Near duplicates**: two tools from *different* servers whose names (split into
  words) and descriptions (content words) overlap by at least `--similarity`
  (mean Jaccard). It is a heuristic: it finds candidates, you decide.
- **Savings** in the suggestions are rough upper-level figures, labelled as such.

## Secrets

Config files contain secrets, so `mcp-weigh` is built not to leak them:

- Environment variables and headers are only used to start/connect; **never printed**,
  not even their names.
- Command lines and URLs are redacted: values after secret-looking flags
  (`--token x`, `--api-key=x`), `KEY=value` with a secret-looking key, URL credentials
  and secret query parameters, and well-known token shapes (GitHub, OpenAI-style,
  Slack, AWS, Google, JWT, bearer).
- Error messages, including a server's stderr tail, are scrubbed of every literal
  env/header value.
- JSON output contains tool names and sizes, not description text.

Redaction is pattern-based and best effort: review output before pasting it publicly.

## Not in scope

No runtime instrumentation, call logging or dollar costs (see
[`@sreelal727/mcpwatch`](https://www.npmjs.com/package/@sreelal727/mcpwatch), which
also has an `audit` command that measures configured servers), no editing of your
config, no OAuth for remote servers (reported as `needs-auth`). See
[DESIGN.md](DESIGN.md) for what mcp-weigh does differently and why.

## Library use

```ts
import { discover, probeAll, analyze, format } from "mcp-weigh";

const { servers } = discover({ cwd: process.cwd() });
const results = await probeAll(servers, { timeoutMs: 15_000 });
console.log(format(analyze(results, { cwd: process.cwd(), longChars: 1000, similarity: 0.8 }), "markdown"));
```

## Development

```bash
npm install
npm run typecheck
npm test        # builds, then runs node:test against a local fake MCP server
```

Tests never start your real MCP servers: they use `test/fixtures/fake-server.mjs`.

## License

MIT © Marco Orta

---

## Español

`mcp-weigh` mide cuánto «pesa» tu flota de servidores MCP: lee la configuración de
Claude Code, Claude Desktop, Cursor y Codex, arranca cada servidor (o se conecta si es
HTTP), pide su catálogo con el SDK oficial y reporta, por servidor, tools, tokens
estimados y porcentaje del total; además tools duplicadas o casi duplicadas entre
servidores, descripciones demasiado largas y sugerencias de poda.

```bash
npx mcp-weigh                  # tabla con todo lo que encuentre
npx mcp-weigh -f markdown      # para pegar en un issue o documento
npx mcp-weigh -s github -f json
npx mcp-weigh --list           # simulacro: qué se sondearía, sin arrancar nada
```

Puntos clave:

- **Los tokens son una estimación** (`caracteres / 4` sobre nombre, descripción y
  esquema), no un conteo exacto de ningún modelo. Sirve para comparar servidores entre
  sí y para el orden de magnitud.
- **Una ejecución normal arranca los servidores stdio configurados**, igual que tu
  cliente. Usa `--server` para limitarla o `--list` para ver antes qué se lanzaría.
- **El directorio importa**: Claude Code guarda servidores por proyecto. La salida
  imprime el directorio medido; ejecútalo donde trabajas (o usa `--cwd`).
- **Secretos**: variables de entorno y cabeceras nunca se imprimen (ni sus nombres);
  argumentos, URLs y mensajes de error se redactan. Es una redacción por patrones: revisa
  la salida antes de publicarla.
- Códigos de salida: `0` correcto · `1` algún servidor no se pudo sondear · `2` uso
  incorrecto.
- Fuera de alcance: instrumentación en tiempo de ejecución, costos en dinero, editar tu
  configuración y OAuth para servidores remotos.

Licencia MIT.
