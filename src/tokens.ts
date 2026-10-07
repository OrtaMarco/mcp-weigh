/**
 * Token estimation.
 *
 * There is no official Claude tokenizer that runs locally, so this is an
 * approximation: one token per 4 characters (rounded up), a common rule of thumb for
 * English text. JSON schemas tokenize somewhat worse than prose, so treat figures as
 * a relative measure between servers and an order of magnitude overall, not as an
 * exact bill.
 */
export const TOKENIZER_NAME = "chars/4 (estimate)";

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Tokens of an arbitrary JSON-serialisable definition, as a client would send it. */
export function estimateJsonTokens(value: unknown): number {
  return estimateTokens(JSON.stringify(value) ?? "");
}
