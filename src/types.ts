export type Transport = "stdio" | "http" | "sse";

/** A server definition found in a client configuration. May hold secrets: never print it as-is. */
export interface ServerSpec {
  name: string;
  /** Client the definition came from, e.g. "claude-code". */
  client: string;
  /** Config file it was read from. */
  file: string;
  transport: Transport;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
  disabled?: boolean;
}

export interface ToolEntry {
  name: string;
  description: string;
  tokens: number;
}

export interface OtherEntry {
  kind: "prompt" | "resource" | "resourceTemplate";
  name: string;
  tokens: number;
}

export type ProbeStatus = "ok" | "error" | "timeout" | "needs-auth" | "skipped";

export interface ServerResult {
  name: string;
  client: string;
  transport: Transport;
  /** Redacted, display-safe description of how the server is launched/reached. */
  target: string;
  status: ProbeStatus;
  error?: string;
  tools: ToolEntry[];
  others: OtherEntry[];
  /** Estimated tokens of the tool catalog (what clients load into context). */
  toolTokens: number;
  /** Estimated tokens of prompts + resources listings (loaded by fewer clients). */
  otherTokens: number;
  durationMs: number;
}

export interface DuplicateGroup {
  kind: "exact" | "near";
  /** 1 for exact name matches, otherwise the similarity score. */
  score: number;
  members: { server: string; tool: string; tokens: number }[];
}

export interface LongDescription {
  server: string;
  tool: string;
  chars: number;
  tokens: number;
}

export interface Suggestion {
  kind: "heavy-server" | "duplicates" | "long-descriptions" | "empty-server" | "failed-server";
  server?: string;
  message: string;
  /** Tokens that could plausibly be saved; 0 when not quantifiable. */
  savingTokens: number;
}

export interface Report {
  cwd: string;
  tokenizer: string;
  totalTokens: number;
  totalTools: number;
  servers: (ServerResult & { share: number })[];
  duplicates: DuplicateGroup[];
  longDescriptions: LongDescription[];
  suggestions: Suggestion[];
  thresholds: { longChars: number; similarity: number };
}
