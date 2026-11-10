import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Sealed fields: the format every backend writes and reads, so a database moves between them.
 *
 *   stored = version (1 byte, 0x01) || nonce (12 random bytes) || ciphertext || tag (16 bytes)
 *
 * AES-256-GCM. The key is the 32 bytes OSL_SEAL_KEY spells as 64 hexadecimal characters. The associated data is
 * the version byte followed by `<table>.<column>` in UTF-8, so a value copied into another column or table does
 * not open there, and neither does one whose first byte was changed. The plaintext is the string in UTF-8.
 *
 * This module is the reference: the generated TypeScript and Go carry their own copies, and the fixed vectors
 * below are in the tests of all three.
 */
export const SEAL_KEY_ENV = "OSL_SEAL_KEY";
export const SEAL_VERSION = 1;
export const SEAL_NONCE_BYTES = 12;
export const SEAL_TAG_BYTES = 16;

/** How the key is asked for, wherever a message or a generated file says it */
export const SEAL_KEY_HINT = "64 hexadecimal characters, 32 bytes: openssl rand -hex 32";

/** What is wrong with a key as the environment spells it, or undefined when it is one */
export function sealKeyProblem(raw: string | undefined): string | undefined {
  if (raw === undefined || raw === "") return `${SEAL_KEY_ENV} is not set`;
  if (!/^[0-9a-fA-F]*$/.test(raw)) return `${SEAL_KEY_ENV} is not hexadecimal`;
  if (raw.length !== 64) return `${SEAL_KEY_ENV} has ${raw.length} hexadecimal characters, not 64`;
  return undefined;
}

/** The key from its spelling; throws what `sealKeyProblem` says */
export function parseSealKey(raw: string | undefined): Buffer {
  const problem = sealKeyProblem(raw);
  if (problem) throw new Error(`${problem} (${SEAL_KEY_HINT})`);
  return Buffer.from(raw!, "hex");
}

/** The name a sealed value is bound to: its table and column */
export function sealName(table: string, column: string): string {
  return `${table}.${column}`;
}

function associated(name: string): Buffer {
  return Buffer.concat([Buffer.from([SEAL_VERSION]), Buffer.from(name, "utf8")]);
}

/** A string as its column stores it. `nonce` is for the fixed vectors: every real write takes a fresh random one. */
export function sealValue(
  key: Uint8Array,
  name: string,
  plaintext: string,
  nonce: Uint8Array = randomBytes(12)
): Buffer {
  if (key.length !== 32) throw new Error("a seal key is 32 bytes");
  if (nonce.length !== SEAL_NONCE_BYTES) throw new Error("a seal nonce is 12 bytes");
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(associated(name));
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([Buffer.from([SEAL_VERSION]), nonce, body, cipher.getAuthTag()]);
}

/** What a stored value says when opened as `name` under `key`; throws when it does not open, never a guess */
export function openValue(key: Uint8Array, name: string, stored: Uint8Array): string {
  if (key.length !== 32) throw new Error("a seal key is 32 bytes");
  const bytes = Buffer.from(stored);
  if (bytes.length < 1 + SEAL_NONCE_BYTES + SEAL_TAG_BYTES)
    throw new Error(`${name}: the stored value is too short to be sealed`);
  if (bytes[0] !== SEAL_VERSION)
    throw new Error(`${name}: sealed with layout version ${bytes[0]}, which this build does not read`);
  const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(1, 1 + SEAL_NONCE_BYTES));
  decipher.setAAD(associated(name));
  decipher.setAuthTag(bytes.subarray(bytes.length - SEAL_TAG_BYTES));
  try {
    return Buffer.concat([
      decipher.update(bytes.subarray(1 + SEAL_NONCE_BYTES, bytes.length - SEAL_TAG_BYTES)),
      decipher.final()
    ]).toString("utf8");
  } catch {
    throw new Error(
      `${name}: a sealed value did not open: ${SEAL_KEY_ENV} is not the key it was sealed under, or the value was copied from another column`
    );
  }
}

/** One fixed vector: a key, a name, a nonce and a plaintext, and the bytes every backend must store for them */
export interface SealVector {
  key: string;
  name: string;
  nonce: string;
  plaintext: string;
  /** The stored bytes in hexadecimal */
  sealed: string;
}

/**
 * The fixed vectors. They were computed once, apart from this module, and are in the tests of the reference, of
 * the generated TypeScript and of the generated Go: a backend that stores other bytes for one of them, or does
 * not open one, has left the format.
 */
export const SEAL_VECTORS: readonly SealVector[] = [
  {
    key: "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
    name: "integrations.secret",
    nonce: "000000000000000000000000",
    plaintext: "whsec_test_123",
    sealed: "0100000000000000000000000079d4c6bbd673f7d87bdcf6042a1fcf3d5b1d79203c40d2b1498a22df40c3"
  },
  {
    key: "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
    name: "integrations.secret",
    nonce: "0102030405060708090a0b0c",
    plaintext: "",
    sealed: "010102030405060708090a0b0c524263a92c339e2fdf6f8dd47143f0f1"
  },
  {
    key: "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
    name: "users.recovery_note",
    nonce: "a0a1a2a3a4a5a6a7a8a9aaab",
    plaintext: "naïve café — 秘密 🔐",
    sealed:
      "01a0a1a2a3a4a5a6a7a8a9aaab8879bf8233ae22dc0303447a2798404a504bfe887718c44c6c91b216608dd997fa573171f14a0dae79269a4d"
  },
  {
    key: "f0e1d2c3b4a5968778695a4b3c2d1e0ff0e1d2c3b4a5968778695a4b3c2d1e0f",
    name: "integrations.token",
    nonce: "ffffffffffffffffffffffff",
    plaintext: "tok_live_4f9a2c",
    sealed: "01ffffffffffffffffffffffff694091f56f0a16541f017abbca54a9476f5b65224d34ff2a87faa648396be8"
  }
];
