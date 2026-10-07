import { TOKENIZER_NAME } from "./tokens.js";
import type { DuplicateGroup, LongDescription, Report, ServerResult, Suggestion } from "./types.js";

export interface AnalyzeOptions {
  cwd: string;
  /** Descriptions with at least this many characters are flagged. */
  longChars: number;
  /** Jaccard similarity (0-1) from which two tools are near-duplicates. */
  similarity: number;
}

export const DEFAULT_LONG_CHARS = 1000;
export const DEFAULT_SIMILARITY = 0.8;

const STOP_WORDS = new Set(["a", "an", "and", "the", "of", "to", "for", "in", "on", "or", "is", "with", "this", "that", "use", "tool"]);

/** Lowercases and strips the server-ish prefix/separators so `github_search_repos` ~ `search-repos`. */
export function normalizeName(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .join("_");
}

function words(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2 && !STOP_WORDS.has(w)),
  );
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return shared / (a.size + b.size - shared);
}

interface FlatTool {
  server: string;
  tool: string;
  tokens: number;
  norm: string;
  nameWords: Set<string>;
  descWords: Set<string>;
}

/**
 * Tool similarity: the mean of name-token overlap and description-word overlap.
 * Requires a description on both sides, otherwise only the name can match exactly.
 */
function similarity(a: FlatTool, b: FlatTool): number {
  if (a.descWords.size === 0 || b.descWords.size === 0) return 0;
  return (jaccard(a.nameWords, b.nameWords) + jaccard(a.descWords, b.descWords)) / 2;
}

/**
 * Finds tools that overlap between different servers: exact (same normalised name)
 * and near (similar name and description). Tools inside one server are never
 * compared with each other.
 */
export function findDuplicates(servers: ServerResult[], threshold: number): DuplicateGroup[] {
  const flat: FlatTool[] = servers.flatMap((s) =>
    s.tools.map((t) => ({
      server: s.name,
      tool: t.name,
      tokens: t.tokens,
      norm: normalizeName(t.name),
      nameWords: new Set(normalizeName(t.name).split("_")),
      descWords: words(t.description),
    })),
  );

  const groups: DuplicateGroup[] = [];
  const grouped = new Set<FlatTool>();

  const byName = new Map<string, FlatTool[]>();
  for (const t of flat) byName.set(t.norm, [...(byName.get(t.norm) ?? []), t]);
  for (const members of byName.values()) {
    if (new Set(members.map((m) => m.server)).size < 2) continue;
    members.forEach((m) => grouped.add(m));
    groups.push({ kind: "exact", score: 1, members: members.map(({ server, tool, tokens }) => ({ server, tool, tokens })) });
  }

  // Near duplicates: greedy pairing of remaining tools from different servers.
  const rest = flat.filter((t) => !grouped.has(t));
  const used = new Set<FlatTool>();
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i] as FlatTool;
    if (used.has(a)) continue;
    const members = [a];
    let minScore = 1;
    for (let j = i + 1; j < rest.length; j++) {
      const b = rest[j] as FlatTool;
      if (used.has(b) || members.some((m) => m.server === b.server)) continue;
      const score = Math.min(...members.map((m) => similarity(m, b)));
      if (score >= threshold) {
        members.push(b);
        minScore = Math.min(minScore, score);
      }
    }
    if (members.length > 1) {
      members.forEach((m) => used.add(m));
      groups.push({
        kind: "near",
        score: Math.round(minScore * 100) / 100,
        members: members.map(({ server, tool, tokens }) => ({ server, tool, tokens })),
      });
    }
  }
  return groups.sort((x, y) => y.members.length - x.members.length || y.score - x.score);
}

export function findLongDescriptions(servers: ServerResult[], longChars: number): LongDescription[] {
  return servers
    .flatMap((s) =>
      s.tools
        .filter((t) => t.description.length >= longChars)
        .map((t) => ({ server: s.name, tool: t.name, chars: t.description.length, tokens: t.tokens })),
    )
    .sort((a, b) => b.chars - a.chars);
}

function suggest(
  servers: (ServerResult & { share: number })[],
  duplicates: DuplicateGroup[],
  long: LongDescription[],
  totalTokens: number,
): Suggestion[] {
  const out: Suggestion[] = [];

  for (const s of servers) {
    if (s.status === "ok" && s.tools.length === 0 && s.otherTokens === 0) {
      out.push({ kind: "empty-server", server: s.name, savingTokens: 0, message: `${s.name} exposes no tools, prompts or resources; it can be removed.` });
    } else if (s.status !== "ok" && s.status !== "skipped") {
      out.push({ kind: "failed-server", server: s.name, savingTokens: 0, message: `${s.name} could not be probed (${s.status}); its weight is not counted. Fix or remove it.` });
    }
  }

  const heavy = servers.filter((s) => s.share >= 0.25 && s.toolTokens > 0 && servers.length > 1);
  for (const s of heavy) {
    const perTool = Math.round(s.toolTokens / Math.max(1, s.tools.length));
    out.push({
      kind: "heavy-server",
      server: s.name,
      savingTokens: s.toolTokens,
      message: `${s.name} is ${Math.round(s.share * 100)}% of the fleet (${s.tools.length} tools, ~${perTool} tokens each). Disable it where unused, or allowlist only the tools you call.`,
    });
  }

  if (duplicates.length > 0) {
    // Saving = tokens of every member except the cheapest one in each group.
    const saving = duplicates.reduce((sum, g) => {
      const sorted = g.members.map((m) => m.tokens).sort((a, b) => a - b);
      return sum + sorted.slice(1).reduce((n, t) => n + t, 0);
    }, 0);
    out.push({
      kind: "duplicates",
      savingTokens: saving,
      message: `${duplicates.length} group(s) of overlapping tools across servers; keeping one tool per group would save ~${saving} tokens.`,
    });
  }

  if (long.length > 0) {
    const saving = long.reduce((n, d) => n + Math.round(d.tokens / 2), 0);
    out.push({
      kind: "long-descriptions",
      savingTokens: saving,
      message: `${long.length} tool description(s) are very long; shortening them could save ~${saving} tokens (assuming half the text goes).`,
    });
  }

  return out.sort((a, b) => b.savingTokens - a.savingTokens);
}

export function analyze(results: ServerResult[], options: AnalyzeOptions): Report {
  const totalTokens = results.reduce((n, s) => n + s.toolTokens, 0);
  const servers = results
    .map((s) => ({ ...s, share: totalTokens > 0 ? s.toolTokens / totalTokens : 0 }))
    .sort((a, b) => b.toolTokens - a.toolTokens || a.name.localeCompare(b.name));
  const duplicates = findDuplicates(results, options.similarity);
  const longDescriptions = findLongDescriptions(results, options.longChars);
  return {
    cwd: options.cwd,
    tokenizer: TOKENIZER_NAME,
    totalTokens,
    totalTools: results.reduce((n, s) => n + s.tools.length, 0),
    servers,
    duplicates,
    longDescriptions,
    suggestions: suggest(servers, duplicates, longDescriptions, totalTokens),
    thresholds: { longChars: options.longChars, similarity: options.similarity },
  };
}
