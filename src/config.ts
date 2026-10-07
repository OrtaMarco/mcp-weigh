import { existsSync, readFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join, resolve } from "node:path";
import { parse as parseToml } from "smol-toml";
import type { ServerSpec, Transport } from "./types.js";

type Json = Record<string, unknown>;

export interface DiscoverOptions {
  /** Project directory: where `.mcp.json` and per-project servers are looked up. */
  cwd: string;
  /** Home directory override (tests). */
  home?: string;
  /** Environment used for `${VAR}` expansion and for locating %APPDATA%. */
  env?: NodeJS.ProcessEnv;
}

export interface DiscoverResult {
  servers: ServerSpec[];
  /** Config files that were read. */
  files: string[];
  /** Config files that exist but could not be parsed. */
  problems: string[];
}

const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const asString = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const asStringArray = (v: unknown): string[] | undefined =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : undefined;

function asStringMap(v: unknown): Record<string, string> | undefined {
  if (!isObject(v)) return undefined;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(v)) {
    if (typeof value === "string") out[key] = value;
    else if (typeof value === "number" || typeof value === "boolean") out[key] = String(value);
  }
  return out;
}

/** Expands `${VAR}` and `${VAR:-default}` (the syntax Claude Code and others accept). */
export function expandVars(text: string, env: NodeJS.ProcessEnv): string {
  return text.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g, (_m, name: string, fallback?: string) => {
    return env[name] ?? fallback ?? "";
  });
}

function expandSpec(spec: ServerSpec, env: NodeJS.ProcessEnv): ServerSpec {
  const ex = (s: string) => expandVars(s, env);
  const exMap = (m?: Record<string, string>) =>
    m && Object.fromEntries(Object.entries(m).map(([k, v]) => [k, ex(v)]));
  return {
    ...spec,
    command: spec.command && ex(spec.command),
    args: spec.args?.map(ex),
    env: exMap(spec.env),
    url: spec.url && ex(spec.url),
    headers: exMap(spec.headers),
  };
}

function transportOf(entry: Json): Transport | undefined {
  const type = asString(entry.type ?? entry.transport)?.toLowerCase();
  if (type === "sse") return "sse";
  if (type === "http" || type === "streamable-http" || type === "streamablehttp" || type === "streamable_http") return "http";
  if (type === "stdio") return "stdio";
  if (asString(entry.url) ?? asString(entry.serverUrl)) return "http";
  if (asString(entry.command)) return "stdio";
  return undefined;
}

function fromJsonEntry(name: string, raw: unknown, client: string, file: string): ServerSpec | undefined {
  if (!isObject(raw)) return undefined;
  const transport = transportOf(raw);
  if (!transport) return undefined;
  const spec: ServerSpec = { name, client, file, transport };
  if (transport === "stdio") {
    spec.command = asString(raw.command);
    spec.args = asStringArray(raw.args) ?? [];
    spec.cwd = asString(raw.cwd);
    if (!spec.command) return undefined;
  } else {
    spec.url = asString(raw.url) ?? asString(raw.serverUrl);
    spec.headers = asStringMap(raw.headers ?? raw.http_headers);
    if (!spec.url) return undefined;
  }
  spec.env = asStringMap(raw.env);
  if (raw.disabled === true || raw.enabled === false) spec.disabled = true;
  return spec;
}

function fromServersMap(map: unknown, client: string, file: string): ServerSpec[] {
  if (!isObject(map)) return [];
  const out: ServerSpec[] = [];
  for (const [name, raw] of Object.entries(map)) {
    const spec = fromJsonEntry(name, raw, client, file);
    if (spec) out.push(spec);
  }
  return out;
}

/** Parses a JSON client config (Claude Code, Claude Desktop, Cursor, `.mcp.json`, VS Code). */
export function parseJsonConfig(text: string, client: string, file: string, cwd?: string): ServerSpec[] {
  const data: unknown = JSON.parse(text);
  if (!isObject(data)) return [];
  const out = [...fromServersMap(data.mcpServers ?? data.servers, client, file)];
  // ~/.claude.json keeps local-scope servers per project path.
  if (cwd && isObject(data.projects)) {
    const project = data.projects[resolve(cwd)];
    if (isObject(project)) out.push(...fromServersMap(project.mcpServers, client, file));
  }
  return out;
}

/** Parses Codex `config.toml` (`[mcp_servers.<name>]` tables). */
export function parseCodexToml(text: string, file: string): ServerSpec[] {
  const data = parseToml(text) as Json;
  const servers = data.mcp_servers;
  if (!isObject(servers)) return [];
  const out: ServerSpec[] = [];
  for (const [name, raw] of Object.entries(servers)) {
    if (!isObject(raw)) continue;
    const spec = fromJsonEntry(name, raw, "codex", file);
    if (!spec) continue;
    // Codex passes a bearer token through an env var named in the config.
    const tokenVar = asString(raw.bearer_token_env_var);
    if (tokenVar && spec.transport !== "stdio") {
      const token = process.env[tokenVar];
      if (token) spec.headers = { ...spec.headers, Authorization: `Bearer ${token}` };
    }
    out.push(spec);
  }
  return out;
}

function claudeDesktopPath(home: string, env: NodeJS.ProcessEnv): string {
  switch (platform()) {
    case "darwin":
      return join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
    case "win32":
      return join(env.APPDATA ?? join(home, "AppData", "Roaming"), "Claude", "claude_desktop_config.json");
    default:
      return join(env.XDG_CONFIG_HOME ?? join(home, ".config"), "Claude", "claude_desktop_config.json");
  }
}

interface Candidate {
  client: string;
  file: string;
  kind: "json" | "toml";
}

function candidates(opts: DiscoverOptions): Candidate[] {
  const home = opts.home ?? homedir();
  const env = opts.env ?? process.env;
  const cwd = resolve(opts.cwd);
  return [
    { client: "claude-code", file: join(home, ".claude.json"), kind: "json" },
    { client: "claude-code", file: join(cwd, ".mcp.json"), kind: "json" },
    { client: "claude-desktop", file: claudeDesktopPath(home, env), kind: "json" },
    { client: "cursor", file: join(home, ".cursor", "mcp.json"), kind: "json" },
    { client: "cursor", file: join(cwd, ".cursor", "mcp.json"), kind: "json" },
    { client: "codex", file: join(env.CODEX_HOME ?? join(home, ".codex"), "config.toml"), kind: "toml" },
  ];
}

function readCandidate(c: Candidate, cwd: string): ServerSpec[] {
  const text = readFileSync(c.file, "utf8");
  return c.kind === "toml" ? parseCodexToml(text, c.file) : parseJsonConfig(text, c.client, c.file, cwd);
}

const specKey = (s: ServerSpec) =>
  JSON.stringify([s.name, s.transport, s.command, s.args, s.url]);

/**
 * Finds server definitions. With `files`, only those files are read (format by
 * extension); otherwise every known client location is tried. Identical definitions
 * found in several files collapse into one; same-named but different ones are
 * disambiguated as `name@client`.
 */
export function discover(opts: DiscoverOptions, files?: string[]): DiscoverResult {
  const env = opts.env ?? process.env;
  const cwd = resolve(opts.cwd);
  const list: Candidate[] = files
    ? files.map((f) => ({ client: "custom", file: resolve(f), kind: f.endsWith(".toml") ? "toml" : "json" }) as Candidate)
    : candidates(opts).filter((c) => existsSync(c.file));

  const result: DiscoverResult = { servers: [], files: [], problems: [] };
  const seen = new Set<string>();
  const nameCount = new Map<string, number>();

  for (const candidate of list) {
    let found: ServerSpec[];
    try {
      found = readCandidate(candidate, cwd);
      result.files.push(candidate.file);
    } catch (error) {
      result.problems.push(`${candidate.file}: ${(error as Error).message}`);
      continue;
    }
    for (const raw of found) {
      const spec = expandSpec(raw, env);
      const key = specKey(spec);
      if (seen.has(key)) continue;
      seen.add(key);
      result.servers.push(spec);
      nameCount.set(spec.name, (nameCount.get(spec.name) ?? 0) + 1);
    }
  }

  for (const spec of result.servers) {
    if ((nameCount.get(spec.name) ?? 0) > 1) spec.name = `${spec.name}@${spec.client}`;
  }
  return result;
}
