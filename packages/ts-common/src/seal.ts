import type { EntityIR, IR } from "@osl/core";
import { SEAL_KEY_ENV, SEAL_KEY_HINT, SEAL_VECTORS, hasSealed, sealedColumns, sealedNames } from "@osl/core";
import { q, type TsConventions } from "./conventions.js";

/** `atRest("integrations", expr)` where the entity has a sealed column, `expr` itself where it has none */
export function atRestCall(entity: EntityIR, expr: string): string {
  return sealedColumns(entity).length ? `atRest(${q(entity.table)}, ${expr})` : expr;
}

/**
 * generated/seal.ts: the sealed fields' format and key. The same bytes the Go backend writes and reads
 * (`@osl/core`'s seal.ts is the reference, with the vectors the generated test repeats).
 */
export function sealFile(ir: IR, conv: TsConventions): string {
  const names = sealedNames(ir);
  const tables = ir.entities
    .filter(e => sealedColumns(e).length)
    .map(
      e =>
        `  ${q(e.table)}: [${sealedColumns(e)
          .map(c => q(c.name))
          .join(", ")}]`
    );
  return `${conv.header("Sealed fields: encrypted at rest with AES-256-GCM under OSL_SEAL_KEY, opened only where the code asks.")}
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * A sealed value as its column stores it:
 *
 *   version (1 byte, 0x01) || nonce (12 random bytes) || ciphertext || tag (16 bytes)
 *
 * The associated data is the version byte followed by "<table>.<column>" in UTF-8, so a value copied into
 * another column or table does not open there. Every OSL backend writes and reads these bytes, so a database
 * moves between them with its key.
 */
const VERSION = 1;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

/** The sealed fields, by the name their values are bound to */
export type SealedField = ${names.map(q).join(" | ")};

/** The sealed columns of each table that has one */
const SEALED = {
${tables.join(",\n")}
} as const;

/** A refusal of the seal: no key, a key that is not one, or a stored value that does not open. Its message never holds a value. */
export class SealError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SealError";
  }
}

let cached: Buffer | undefined;

/**
 * The key, read once from ${SEAL_KEY_ENV}. Without one, or with one that is not 32 bytes in hexadecimal, this
 * throws: the server calls it as it starts and does not start, and nothing is ever sealed under a makeshift key.
 */
export function sealKey(): Buffer {
  if (cached) return cached;
  const raw = process.env.${SEAL_KEY_ENV} ?? "";
  const problem =
    raw === ""
      ? "${SEAL_KEY_ENV} is not set"
      : !/^[0-9a-fA-F]*$/.test(raw)
        ? "${SEAL_KEY_ENV} is not hexadecimal"
        : raw.length !== 64
          ? \`${SEAL_KEY_ENV} has \${raw.length} hexadecimal characters, not 64\`
          : null;
  if (problem)
    throw new SealError(
      \`\${problem}: ${names.join(", ")} ${names.length === 1 ? "is" : "are"} sealed, and the app does not run without the key ${names.length === 1 ? "it is" : "they are"} encrypted under (${SEAL_KEY_HINT})\`
    );
  cached = Buffer.from(raw, "hex");
  return cached;
}

function associated(field: string): Buffer {
  return Buffer.concat([Buffer.from([VERSION]), Buffer.from(field, "utf8")]);
}

/** Seal under a given key. \`nonce\` is for the fixed vectors of the format: every real write takes a fresh random one. */
export function sealWith(key: Uint8Array, field: string, plaintext: string, nonce: Uint8Array = randomBytes(NONCE_BYTES)): Uint8Array {
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(associated(field));
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([Buffer.from([VERSION]), nonce, body, cipher.getAuthTag()]);
}

/**
 * Open under a given key. \`stored\` is the column as the driver hands it over (bytes), or as it arrives inside a
 * relational query's JSON (a string of "\\\\x" and hexadecimal).
 */
export function openWith(key: Uint8Array, field: string, stored: Uint8Array | string): string {
  const bytes = typeof stored === "string" ? Buffer.from(stored.replace(/^\\\\x/, ""), "hex") : Buffer.from(stored);
  if (bytes.length < 1 + NONCE_BYTES + TAG_BYTES) throw new SealError(\`\${field}: the stored value is too short to be sealed\`);
  if (bytes[0] !== VERSION) throw new SealError(\`\${field}: sealed with layout version \${bytes[0]}, which this build does not read\`);
  const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(1, 1 + NONCE_BYTES));
  decipher.setAAD(associated(field));
  decipher.setAuthTag(bytes.subarray(bytes.length - TAG_BYTES));
  try {
    return Buffer.concat([decipher.update(bytes.subarray(1 + NONCE_BYTES, bytes.length - TAG_BYTES)), decipher.final()]).toString("utf8");
  } catch {
    throw new SealError(
      \`\${field}: a sealed value did not open: ${SEAL_KEY_ENV} is not the key it was sealed under, or the value was copied from another column\`
    );
  }
}

/** A value as its column stores it. Your own code calls this wherever it writes a sealed column. */
export function seal(field: SealedField, plaintext: string): Uint8Array {
  return sealWith(sealKey(), field, plaintext);
}

/**
 * What a stored value says. Your own code calls this to read a sealed column of a row it loaded; the API itself
 * opens a value only in the presenter, for a caller the field's read rule allows. Throws a SealError when the
 * value does not open: never a guess, never an empty answer.
 */
export function unseal(field: SealedField, stored: Uint8Array | string): string {
  try {
    return openWith(sealKey(), field, stored);
  } catch (error) {
    // Said here, where it happens, so the operator finds it whatever answers the request: the column, never the value
    if (error instanceof SealError) console.error(\`[seal] \${error.message}\`);
    throw error;
  }
}

/** The values of a write with each sealed column sealed: a string becomes bytes, null and an absent key stay as they are */
export type AtRest<T, K extends PropertyKey> = { [P in keyof T]: P extends K ? Uint8Array | Exclude<T[P], string> : T[P] };

/** Values on their way into a table that has sealed columns, as the table stores them */
export function atRest<N extends keyof typeof SEALED, T extends object>(table: N, values: T): AtRest<T, (typeof SEALED)[N][number]> {
  const out = { ...values } as Record<string, unknown>;
  for (const column of SEALED[table]) {
    const value = out[column];
    if (typeof value === "string") out[column] = sealWith(sealKey(), \`\${table}.\${column}\`, value);
  }
  return out as AtRest<T, (typeof SEALED)[N][number]>;
}
`;
}

/** generated/tests/00_sealed_values.test.ts: the fixed vectors of the format, which every backend's tests repeat */
export function sealTestFile(conv: TsConventions, sealModule: string): string {
  const vectors = SEAL_VECTORS.map(
    v =>
      `  { key: ${q(v.key)}, name: ${q(v.name)}, nonce: ${q(v.nonce)}, plaintext: ${q(v.plaintext)}, sealed: ${q(v.sealed)} }`
  ).join(",\n");
  return `${conv.header("The sealed fields' format, held to its fixed vectors: the bytes every OSL backend stores and opens.")}
import { describe, expect, it } from "vitest";
import { SealError, openWith, sealWith } from ${q(sealModule)};

const hex = (text: string) => Buffer.from(text, "hex");

const VECTORS = [
${vectors}
];

describe("sealed values", () => {
  it("stores the bytes the format fixes", () => {
    for (const v of VECTORS)
      expect(Buffer.from(sealWith(hex(v.key), v.name, v.plaintext, hex(v.nonce))).toString("hex")).toBe(v.sealed);
  });

  it("opens what any backend stored, from bytes and from the text a relational query hands over", () => {
    for (const v of VECTORS) {
      expect(openWith(hex(v.key), v.name, hex(v.sealed))).toBe(v.plaintext);
      expect(openWith(hex(v.key), v.name, "\\\\x" + v.sealed)).toBe(v.plaintext);
    }
  });

  it("does not open under another column, another key, or once a byte has changed", () => {
    const v = VECTORS[0];
    expect(() => openWith(hex(v.key), "users.name", hex(v.sealed))).toThrow(SealError);
    expect(() => openWith(hex(VECTORS[3].key), v.name, hex(v.sealed))).toThrow(SealError);
    const flipped = hex(v.sealed);
    flipped[flipped.length - 1] ^= 1;
    expect(() => openWith(hex(v.key), v.name, flipped)).toThrow(SealError);
    const versioned = hex(v.sealed);
    versioned[0] = 2;
    expect(() => openWith(hex(v.key), v.name, versioned)).toThrow(/layout version 2/);
  });

  it("never stores the same bytes twice for one value", () => {
    const v = VECTORS[0];
    const once = Buffer.from(sealWith(hex(v.key), v.name, v.plaintext)).toString("hex");
    const again = Buffer.from(sealWith(hex(v.key), v.name, v.plaintext)).toString("hex");
    expect(once).not.toBe(again);
    expect(once).not.toContain(Buffer.from(v.plaintext, "utf8").toString("hex"));
  });
});
`;
}

/** The line .env.example carries when the model has a sealed field */
export function sealEnvLine(ir: IR): string {
  return hasSealed(ir)
    ? `# The key sealed fields are encrypted under (${SEAL_KEY_HINT}). Keep it: without it the stored values cannot be read\n${SEAL_KEY_ENV}=\n`
    : "";
}

/** What the generated README says of sealed fields */
export function sealReadme(ir: IR, module: string): string {
  if (!hasSealed(ir)) return "";
  const names = sealedNames(ir);
  return `
## Sealed fields

${names.map(n => `\`${n}\``).join(", ")} ${names.length === 1 ? "is" : "are"} sealed: encrypted with AES-256-GCM before ${names.length === 1 ? "it reaches" : "they reach"} the database, in a \`bytea\` column. The key is \`${SEAL_KEY_ENV}\` (${SEAL_KEY_HINT}). It is in no generated file; the server does not start without it, and nothing is ever sealed under a default.

- Keep the key as long as the data. A value sealed under one key does not open under another: a read answers 500 and the log names the column, never the value. Rotating the key is not built yet.
- The API opens a value only for a caller the field's \`read:\` rule allows, and for nobody when the field has none. It is in no event payload, and no list can filter, sort or search by it.
- Your own code reads one with \`unseal("<table>.<column>", row.<column>)\` and writes one with \`seal("<table>.<column>", value)\`, both from \`${module}\`. A row you load yourself holds the stored bytes.
- A stored value is \`0x01\`, a 12-byte random nonce, the ciphertext and a 16-byte tag, bound to its table and column: copied into another column it does not open. Every OSL backend reads and writes the same bytes.
`;
}
