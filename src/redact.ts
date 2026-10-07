import type { ServerSpec } from "./types.js";

export const REDACTED = "***";

const SECRET_FLAG = /(token|secret|password|passwd|api[-_]?key|apikey|auth|bearer|credential|private[-_]?key|access[-_]?key|cookie)/i;

/** Well-known secret shapes, matched anywhere in a string. */
const SECRET_SHAPES: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{16,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{30,}/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]*/g,
  /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi,
];

/** Redacts `user:pass@` credentials and secret-looking query parameters of a URL. */
export function redactUrl(raw: string): string {
  try {
    const url = new URL(raw);
    if (url.username) url.username = REDACTED;
    if (url.password) url.password = REDACTED;
    for (const key of [...url.searchParams.keys()]) {
      if (SECRET_FLAG.test(key)) url.searchParams.set(key, REDACTED);
    }
    return url.toString().replace(/%2A%2A%2A/g, REDACTED);
  } catch {
    return redactText(raw);
  }
}

/** Redacts known secret shapes inside free text. */
export function redactText(text: string): string {
  let out = text;
  for (const shape of SECRET_SHAPES) out = out.replace(shape, REDACTED);
  return out;
}

/**
 * Redacts a command-line argument list. Handles `--token value`, `--token=value`,
 * `KEY=value` where KEY looks secret, URLs with credentials and known secret shapes.
 */
export function redactArgs(args: readonly string[]): string[] {
  const out: string[] = [];
  let maskNext = false;
  for (const arg of args) {
    if (maskNext) {
      out.push(REDACTED);
      maskNext = false;
      continue;
    }
    const eq = arg.indexOf("=");
    if (arg.startsWith("-") && eq === -1) {
      out.push(arg);
      if (SECRET_FLAG.test(arg)) maskNext = true;
      continue;
    }
    if (eq > 0 && SECRET_FLAG.test(arg.slice(0, eq))) {
      out.push(`${arg.slice(0, eq)}=${REDACTED}`);
      continue;
    }
    out.push(/^[a-z][a-z0-9+.-]*:\/\//i.test(arg) ? redactUrl(arg) : redactText(arg));
  }
  return out;
}

/** Display-safe one-line description of how a server is launched or reached. */
export function describeTarget(spec: ServerSpec): string {
  if (spec.transport === "stdio") {
    return [spec.command ?? "", ...redactArgs(spec.args ?? [])].join(" ").trim();
  }
  return spec.url ? redactUrl(spec.url) : "";
}

/** Every literal secret value a spec carries (env + headers), for scrubbing error messages. */
export function secretValues(spec: ServerSpec): string[] {
  const values = [...Object.values(spec.env ?? {}), ...Object.values(spec.headers ?? {})];
  for (const value of values.slice()) {
    // Headers like "Bearer abc" are also leaked without their scheme.
    const stripped = value.replace(/^(Bearer|Basic)\s+/i, "");
    if (stripped !== value) values.push(stripped);
  }
  return values.filter((v) => v.length >= 6);
}

/** Scrubs a message: literal secret values first, then well-known shapes. */
export function scrub(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const secret of secrets) out = out.split(secret).join(REDACTED);
  return redactText(out);
}
