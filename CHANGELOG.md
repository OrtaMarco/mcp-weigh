# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [0.1.0] - Unreleased

### Added
- Discovery of MCP servers from Claude Code (`~/.claude.json` user and per-project
  servers, project `.mcp.json`), Claude Desktop, Cursor and Codex (`config.toml`),
  or from explicit `--config` files.
- Probing through the official MCP SDK: stdio, streamable HTTP (with SSE fallback),
  `tools/list`, `prompts/list`, `resources/list`, resource templates, pagination,
  per-server timeout.
- Token estimation of each catalog (chars/4, documented as an estimate).
- Report with per-server table, exact and near-duplicate tools across servers, long
  descriptions and pruning suggestions, as `table`, `json` or `markdown`.
- `--server`, `--timeout`, `--cwd`, `--long`, `--similarity`, `--list`.
- Redaction of secrets in arguments, URLs and error messages; env vars and headers are
  never printed.
