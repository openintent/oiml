import { createHash } from "node:crypto";
import YAML from "yaml";

/**
 * Canonical JSON: object keys sorted recursively, no whitespace. Two equal values
 * always serialize to the same bytes, so hashes and snapshots are stable.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

export function prettyJson(value: unknown): string {
  return JSON.stringify(sortKeys(value), null, 2) + "\n";
}

export function sortKeys<T>(value: T): T {
  if (Array.isArray(value)) return value.map(sortKeys) as unknown as T;
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = sortKeys(v);
    }
    return out as T;
  }
  return value;
}

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function hashValue(value: unknown): string {
  return "sha256:" + sha256(canonicalJson(value)).slice(0, 32);
}

/** YAML in insertion order, which the model builder keeps deterministic. */
export function toYaml(value: unknown): string {
  return YAML.stringify(value, { lineWidth: 100, defaultStringType: "PLAIN", defaultKeyType: "PLAIN" });
}

export function fromYaml<T = unknown>(text: string): T {
  return YAML.parse(text) as T;
}
