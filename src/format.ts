import type { Report } from "./types.js";

export type Format = "table" | "json" | "markdown";
export const FORMATS: readonly Format[] = ["table", "json", "markdown"];

const n = (value: number) => value.toLocaleString("en-US");
const pct = (share: number) => `${(share * 100).toFixed(1)}%`;
const ESTIMATE_NOTE =
  "Token figures are estimates (chars/4 over name + description + input schema), not an exact count for any model.";

function cell(text: string, max = 60): string {
  const flat = text.replace(/\s+/g, " ");
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function renderTable(headers: string[], rows: string[][], right: number[] = []): string {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)));
  const line = (cols: string[]) =>
    cols.map((c, i) => (right.includes(i) ? c.padStart(widths[i] ?? 0) : c.padEnd(widths[i] ?? 0))).join("  ").trimEnd();
  return [line(headers), line(widths.map((w) => "-".repeat(w))), ...rows.map(line)].join("\n");
}

function serverRows(report: Report): string[][] {
  const rows = report.servers.map((s) => [
    s.name,
    s.client,
    s.status === "ok" ? String(s.tools.length) : "-",
    s.status === "ok" ? n(s.toolTokens) : "-",
    s.status === "ok" ? pct(s.share) : s.status,
    s.status === "ok" && s.others.length > 0 ? `${s.others.length} (~${n(s.otherTokens)})` : "-",
  ]);
  rows.push(["TOTAL", "", String(report.totalTools), n(report.totalTokens), report.totalTokens > 0 ? "100.0%" : "-", ""]);
  return rows;
}

const SERVER_HEADERS = ["SERVER", "CLIENT", "TOOLS", "TOKENS", "SHARE", "PROMPTS/RESOURCES"];

export function formatTable(report: Report): string {
  const out: string[] = [];
  out.push(`mcp-weigh — project dir: ${report.cwd}`, "");
  out.push(renderTable(SERVER_HEADERS, serverRows(report), [2, 3, 4]));

  const failed = report.servers.filter((s) => s.status !== "ok" && s.status !== "skipped");
  if (failed.length > 0) {
    out.push("", "Failed servers:");
    for (const s of failed) out.push(`  ${s.name}: ${s.status}${s.error ? ` — ${cell(s.error, 160)}` : ""}`);
  }

  if (report.duplicates.length > 0) {
    out.push("", "Duplicate / overlapping tools:");
    for (const g of report.duplicates) {
      const label = g.kind === "exact" ? "same name" : `similar (${g.score.toFixed(2)})`;
      out.push(`  [${label}] ${g.members.map((m) => `${m.server}:${m.tool}`).join("  ~  ")}`);
    }
  }

  if (report.longDescriptions.length > 0) {
    out.push("", `Long descriptions (>= ${n(report.thresholds.longChars)} chars):`);
    for (const d of report.longDescriptions.slice(0, 15)) {
      out.push(`  ${d.server}:${d.tool} — ${n(d.chars)} chars (~${n(d.tokens)} tokens with schema)`);
    }
    if (report.longDescriptions.length > 15) out.push(`  … and ${report.longDescriptions.length - 15} more`);
  }

  out.push("", "Suggestions:");
  if (report.suggestions.length === 0) out.push("  Nothing to prune: no heavy, empty or overlapping servers found.");
  for (const s of report.suggestions) out.push(`  - ${s.message}`);

  out.push("", `${ESTIMATE_NOTE} Tokenizer: ${report.tokenizer}.`);
  return out.join("\n");
}

export function formatMarkdown(report: Report): string {
  const out: string[] = ["# MCP fleet weight", "", `Project directory: \`${report.cwd}\``, ""];
  const rows = serverRows(report).map((r) => `| ${r.map((c) => c.replace(/\|/g, "\\|")).join(" | ")} |`);
  out.push(`| ${SERVER_HEADERS.join(" | ")} |`, `|${SERVER_HEADERS.map(() => "---").join("|")}|`, ...rows);

  const failed = report.servers.filter((s) => s.status !== "ok" && s.status !== "skipped");
  if (failed.length > 0) {
    out.push("", "## Failed servers", "");
    for (const s of failed) out.push(`- **${s.name}**: ${s.status}${s.error ? ` — ${cell(s.error, 160)}` : ""}`);
  }

  out.push("", "## Duplicate / overlapping tools", "");
  if (report.duplicates.length === 0) out.push("None found.");
  for (const g of report.duplicates) {
    const label = g.kind === "exact" ? "same name" : `similar (${g.score.toFixed(2)})`;
    out.push(`- _${label}_: ${g.members.map((m) => `\`${m.server}:${m.tool}\``).join(" ~ ")}`);
  }

  out.push("", `## Long descriptions (>= ${n(report.thresholds.longChars)} chars)`, "");
  if (report.longDescriptions.length === 0) out.push("None found.");
  for (const d of report.longDescriptions) out.push(`- \`${d.server}:${d.tool}\` — ${n(d.chars)} chars (~${n(d.tokens)} tokens)`);

  out.push("", "## Suggestions", "");
  if (report.suggestions.length === 0) out.push("Nothing to prune.");
  for (const s of report.suggestions) out.push(`- ${s.message}`);

  out.push("", `> ${ESTIMATE_NOTE} Tokenizer: ${report.tokenizer}.`);
  return out.join("\n");
}

/** JSON keeps tool names and sizes but not description text. */
export function formatJson(report: Report): string {
  const slim = {
    ...report,
    note: ESTIMATE_NOTE,
    servers: report.servers.map((s) => ({
      ...s,
      tools: s.tools.map((t) => ({ name: t.name, tokens: t.tokens, descriptionChars: t.description.length })),
    })),
  };
  return JSON.stringify(slim, null, 2);
}

export function format(report: Report, kind: Format): string {
  if (kind === "json") return formatJson(report);
  if (kind === "markdown") return formatMarkdown(report);
  return formatTable(report);
}
