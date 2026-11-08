/** List prices per million tokens, for the cost column. Unknown models get no cost rather than a wrong one. */
import type { ProposeUsage } from "@osl/cli/propose";

export interface Price {
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
}

const PRICES: Record<string, Price> = {
  "claude-opus-5-5": { input: 4, output: 20, cache_read: 0.2, cache_write: 5 },
  "claude-sonnet-5-5": { input: 2, output: 10, cache_read: 0.2, cache_write: 2.5 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cache_read: 0.01, cache_write: 0.125 },
  "claude-fable-5-1": { input: 10, output: 50, cache_read: 0.25, cache_write: 12.5 }
};

export function priceFor(model: string): Price | null {
  const key = Object.keys(PRICES).find(k => model.startsWith(k));
  return key ? PRICES[key] : null;
}

export function costUsd(model: string, usage: ProposeUsage): number | null {
  const price = priceFor(model);
  if (!price) return null;
  const perToken = (n: number, perMillion: number) => (n * perMillion) / 1_000_000;
  return (
    perToken(usage.input_tokens, price.input) +
    perToken(usage.output_tokens, price.output) +
    perToken(usage.cache_read_input_tokens, price.cache_read) +
    perToken(usage.cache_creation_input_tokens, price.cache_write)
  );
}
