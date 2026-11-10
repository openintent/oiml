/**
 * Sealed fields across backends, on the files generated for the blog fixture (FEAT-18: an integration's secret
 * and token, a person's recovery code).
 *
 * The format is the contract: a database moves between backends with its key. So the generated code is run, not
 * read. The TypeScript module (`generated/seal.ts` of drizzle-next and of hono-trpc-vite) is transpiled and
 * imported; the Go package (`generated/seal`) is built with a small command beside it, when a Go toolchain is on
 * the PATH. Each is held to the fixed vectors of `@osl/core`, and then to the other: what TypeScript seals with a
 * random nonce Go opens, and what Go seals TypeScript opens. With OSL_TEST_DATABASE_URL set the bytes also pass
 * through a `bytea` column of a real PostgreSQL in both directions, as bytes and as the text a relational query's
 * JSON carries them in.
 *
 * What the three servers do over HTTP (who is answered a value, what the stored bytes hold, what a wrong key
 * answers) is the conformance run's part: the fixture's scenario and the leak walk.
 */
import { execFile, execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import pg from "pg";
import ts from "typescript";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  SEAL_VECTORS,
  applyIntent,
  initProject,
  listIntents,
  loadProject,
  openValue,
  sealValue,
  type Backend
} from "@osl/core";
import { drizzleNextBackend } from "@osl/backend-drizzle-next";
import { ginPgxBackend } from "@osl/backend-gin-pgx";
import { honoTrpcViteBackend } from "@osl/backend-hono-trpc-vite";

const run = promisify(execFile);
const FIXTURES = path.resolve(__dirname, "../../../fixtures");
const url = process.env.OSL_TEST_DATABASE_URL;
const KEY = SEAL_VECTORS[0].key;
const hex = (text: string) => Buffer.from(text, "hex");

function goAvailable(): boolean {
  try {
    execFileSync("go", ["version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
const hasGo = goAvailable();

async function filesOf(backend: Backend): Promise<Map<string, string>> {
  const root = await mkdtemp(path.join(tmpdir(), "osl-sealed-"));
  await initProject(root, { name: "blog", backend: backend.name });
  await cp(path.join(FIXTURES, "blog", "intents"), path.join(root, ".osl/intents"), { recursive: true });
  for (const id of await listIntents(root)) await applyIntent(root, id);
  const project = await loadProject(root);
  await rm(root, { recursive: true, force: true });
  const files = backend.generate({ ir: project.ir, revisions: project.lock.revisions, config: project.config });
  return new Map(files.map(f => [f.path, f.content]));
}

interface SealModule {
  SealError: new (message: string) => Error;
  sealKey(): Buffer;
  sealWith(key: Uint8Array, field: string, plaintext: string, nonce?: Uint8Array): Uint8Array;
  openWith(key: Uint8Array, field: string, stored: Uint8Array | string): string;
  seal(field: string, plaintext: string): Uint8Array;
  unseal(field: string, stored: Uint8Array | string): string;
  atRest(table: string, values: Record<string, unknown>): Record<string, unknown>;
}

let scratch: string;
let go: { dir: string; bin: string } | null = null;
const modules = new Map<string, SealModule>();
const generated = new Map<string, Map<string, string>>();

/** The generated TypeScript module, as the app would load it: transpiled, written beside nothing, imported */
async function loadSeal(name: string, source: string): Promise<SealModule> {
  const js = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }
  }).outputText;
  const file = path.join(scratch, `${name}-seal.mjs`);
  await writeFile(file, js);
  return (await import(/* @vite-ignore */ pathToFileURL(file).href)) as SealModule;
}

beforeAll(async () => {
  scratch = await mkdtemp(path.join(tmpdir(), "osl-sealed-run-"));
  for (const backend of [drizzleNextBackend, honoTrpcViteBackend, ginPgxBackend] as Backend[])
    generated.set(backend.name, await filesOf(backend));
  for (const name of ["drizzle-next", "hono-trpc-vite"])
    modules.set(name, await loadSeal(name, generated.get(name)!.get("generated/seal.ts")!));
  if (hasGo) {
    // The generated Go package with its own test, and a command that seals and opens for the other side
    const dir = path.join(scratch, "go");
    await mkdir(path.join(dir, "generated/seal"), { recursive: true });
    await mkdir(path.join(dir, "cmd/sealtool"), { recursive: true });
    const files = generated.get("gin-pgx")!;
    await writeFile(path.join(dir, "go.mod"), "module blog\n\ngo 1.24\n");
    await writeFile(path.join(dir, "generated/seal/seal.go"), files.get("generated/seal/seal.go")!);
    await writeFile(path.join(dir, "generated/seal/seal_test.go"), files.get("generated/seal/seal_test.go")!);
    await writeFile(
      path.join(dir, "cmd/sealtool/main.go"),
      `package main

import (
	"encoding/hex"
	"fmt"
	"os"

	"blog/generated/seal"
)

// sealtool seal <key> <field> <plaintext> prints the stored bytes in hexadecimal;
// sealtool open <key> <field> <stored> prints the plaintext; sealtool load checks OSL_SEAL_KEY as the app does.
func main() {
	if os.Args[1] == "load" {
		if err := seal.Load(); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		fmt.Print(hex.EncodeToString(seal.Seal(os.Args[2], os.Args[3])))
		return
	}
	key, err := hex.DecodeString(os.Args[2])
	if err != nil {
		panic(err)
	}
	switch os.Args[1] {
	case "seal":
		out, err := seal.SealWith(key, os.Args[3], os.Args[4], nil)
		if err != nil {
			panic(err)
		}
		fmt.Print(hex.EncodeToString(out))
	case "open":
		stored, err := hex.DecodeString(os.Args[4])
		if err != nil {
			panic(err)
		}
		plain, err := seal.OpenWith(key, os.Args[3], stored)
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		fmt.Print(plain)
	}
}
`
    );
    const bin = path.join(dir, "sealtool");
    await run("go", ["build", "-o", bin, "./cmd/sealtool"], { cwd: dir, env: { ...process.env, GOFLAGS: "-mod=mod" } });
    go = { dir, bin };
  }
}, 120_000);

afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

const goSeal = async (field: string, plaintext: string, key = KEY) =>
  hex((await run(go!.bin, ["seal", key, field, plaintext])).stdout);
const goOpen = async (field: string, stored: Uint8Array, key = KEY) =>
  (await run(go!.bin, ["open", key, field, Buffer.from(stored).toString("hex")])).stdout;

describe.each(["drizzle-next", "hono-trpc-vite"])("the seal module generated for %s", name => {
  const seal = () => modules.get(name)!;

  it("stores the bytes the fixed vectors say, and opens them from bytes and from a relational query's text", () => {
    for (const v of SEAL_VECTORS) {
      expect(Buffer.from(seal().sealWith(hex(v.key), v.name, v.plaintext, hex(v.nonce))).toString("hex")).toBe(
        v.sealed
      );
      expect(seal().openWith(hex(v.key), v.name, hex(v.sealed))).toBe(v.plaintext);
      expect(seal().openWith(hex(v.key), v.name, `\\x${v.sealed}`)).toBe(v.plaintext);
    }
  });

  it("agrees with the reference in both directions on values it has never seen", () => {
    for (const plaintext of ["", "a", "tok_live_" + "x".repeat(190), "ünïcode ✓ 秘密", "line\nbreak\ttab"]) {
      const field = "integrations.token";
      expect(openValue(hex(KEY), field, seal().sealWith(hex(KEY), field, plaintext))).toBe(plaintext);
      expect(seal().openWith(hex(KEY), field, sealValue(hex(KEY), field, plaintext))).toBe(plaintext);
    }
  });

  it("refuses with a SealError that names the column and never the value", () => {
    const v = SEAL_VECTORS[0];
    const attempts: [string, () => unknown][] = [
      ["another column", () => seal().openWith(hex(v.key), "integrations.token", hex(v.sealed))],
      ["another key", () => seal().openWith(hex(SEAL_VECTORS[3].key), v.name, hex(v.sealed))],
      [
        "plain bytes",
        () => seal().openWith(hex(v.key), v.name, Buffer.from(v.plaintext + " in the clear, never sealed"))
      ]
    ];
    for (const [what, attempt] of attempts) {
      let thrown: unknown;
      try {
        attempt();
      } catch (error) {
        thrown = error;
      }
      expect(thrown, what).toBeInstanceOf(seal().SealError);
      expect(String(thrown), what).toContain(what === "another column" ? "integrations.token" : v.name);
      expect(String(thrown), what).not.toContain(v.plaintext);
    }
  });

  it("does not run without the key, with a short one or with one that is not hexadecimal, and never makes one up", () => {
    const saved = process.env.OSL_SEAL_KEY;
    try {
      delete process.env.OSL_SEAL_KEY;
      expect(() => seal().sealKey()).toThrow(/OSL_SEAL_KEY is not set: .*integrations\.secret.* sealed/);
      expect(() => seal().seal("integrations.secret", "x")).toThrow(seal().SealError);
      process.env.OSL_SEAL_KEY = KEY.slice(0, 32);
      expect(() => seal().sealKey()).toThrow(/OSL_SEAL_KEY has 32 hexadecimal characters, not 64/);
      process.env.OSL_SEAL_KEY = "g".repeat(64);
      expect(() => seal().sealKey()).toThrow(/OSL_SEAL_KEY is not hexadecimal/);
      process.env.OSL_SEAL_KEY = KEY;
      expect(seal().sealKey()).toHaveLength(32);
      const stored = seal().seal("integrations.secret", "whsec_test_123");
      expect(openValue(hex(KEY), "integrations.secret", stored)).toBe("whsec_test_123");
      expect(seal().unseal("integrations.secret", stored)).toBe("whsec_test_123");
    } finally {
      if (saved === undefined) delete process.env.OSL_SEAL_KEY;
      else process.env.OSL_SEAL_KEY = saved;
    }
  });

  it("seals what a write carries on its way into the table: a string becomes bytes, null and an absent key stay", () => {
    const saved = process.env.OSL_SEAL_KEY;
    process.env.OSL_SEAL_KEY = KEY;
    try {
      const out = seal().atRest("integrations", { name: "Hook", secret: "s3cret", token: null });
      expect(out.name).toBe("Hook");
      expect(out.token).toBeNull();
      expect("config" in out).toBe(false);
      expect(openValue(hex(KEY), "integrations.secret", out.secret as Uint8Array)).toBe("s3cret");
      expect(Object.keys(seal().atRest("integrations", {}))).toEqual([]);
      expect(seal().atRest("integrations", { secret: "" }).secret).toBeInstanceOf(Uint8Array);
    } finally {
      if (saved === undefined) delete process.env.OSL_SEAL_KEY;
      else process.env.OSL_SEAL_KEY = saved;
    }
  });
});

describe("the generated files", () => {
  const file = (backend: string, suffix: string) => {
    const found = [...generated.get(backend)!.entries()].find(([name]) => name.endsWith(suffix));
    expect(found, `${backend} ${suffix}`).toBeDefined();
    return found![1];
  };

  it("carry no key: the environment names it, the compose file requires it, the server checks it as it starts", () => {
    for (const [name, files] of generated)
      for (const [filePath, content] of files) {
        if (filePath.includes("seal_test") || filePath.includes("00_sealed_values")) continue;
        expect(content, `${name} ${filePath}`).not.toMatch(/OSL_SEAL_KEY\s*[=:]\s*["']?[0-9a-fA-F]{64}/);
      }
    for (const name of ["drizzle-next", "hono-trpc-vite", "gin-pgx"]) {
      expect(file(name, "docker-compose.yml")).toContain("OSL_SEAL_KEY: ${OSL_SEAL_KEY:?set OSL_SEAL_KEY");
      expect(file(name, ".env.example")).toMatch(/^OSL_SEAL_KEY=$/m);
      expect(file(name, "generated/README.md")).toContain("## Sealed fields");
    }
    expect(file("drizzle-next", "instrumentation.ts")).toContain(
      'const { sealKey } = await import("./generated/seal");'
    );
    expect(file("drizzle-next", "generated/jobs.ts")).toContain("sealKey();");
    expect(file("hono-trpc-vite", "generated/server/app.ts")).toContain("\nsealKey();\n");
    expect(file("gin-pgx", "generated/app/app.go")).toContain(
      "if err := seal.Load(); err != nil {\n\t\treturn err\n\t}"
    );
  });

  it("open a sealed value in the presenter only, inside the rule's branch, and never for the server", () => {
    for (const name of ["drizzle-next", "hono-trpc-vite"]) {
      const present = file(name, "generated/present.ts");
      expect(present).toContain(
        'if (viewer !== SERVER && reads(FIELD_RULES.User.recovery_code, viewer, row)) out.recovery_code = row.recovery_code === null ? null : unseal("users.recovery_code", row.recovery_code);'
      );
      // unseal is called nowhere else in what OSL generates
      for (const [filePath, content] of generated.get(name)!)
        if (/^generated\/.*\.tsx?$/.test(filePath) && !/seal\.ts$|present\.ts$|sealed_values\.test\.ts$/.test(filePath))
          expect(content, filePath).not.toMatch(/\bunseal\(|\bopenWith\(/);
      expect(file(name, "generated/db/schema.ts")).toContain("recovery_code: bytea()");
    }
    const entities = file("gin-pgx", "generated/models/entities.go");
    expect(entities).toContain(
      'if viewer != Server && viewer.Reads("Integration.token", map[string]any{"owner_id": row.OwnerID}) {\n\t\tout.Token = Shown(seal.MustOpenPtr(seal.IntegrationsToken, row.Token))'
    );
    expect(entities).toMatch(/type Integration struct \{[^}]*Secret\s+\[\]byte/);
    for (const [filePath, content] of generated.get("gin-pgx")!)
      if (/^generated\/.*\.go$/.test(filePath) && !filePath.includes("/seal/") && !filePath.endsWith("entities.go"))
        expect(content, filePath).not.toMatch(/seal\.(Must)?Open/);
  });

  it("seal a written value before a hook or the insert sees it", () => {
    expect(file("drizzle-next", "generated/resources/integrations.ts")).toContain(
      'const patch = await hooks.beforeUpdate(existing, atRest("integrations", body.data), hookContext);'
    );
    expect(file("hono-trpc-vite", "generated/server/resources/integrations.ts")).toContain(
      'const patch = await hooks.beforeUpdate(existing, atRest("integrations", input.data), hookContext);'
    );
    expect(file("gin-pgx", "generated/resources/integrations.go")).toContain(
      'if plain, ok := patch["secret"].(string); ok {\n\t\tpatch["secret"] = seal.Seal(seal.IntegrationsSecret, plain)\n\t}'
    );
  });
});

describe.skipIf(!hasGo)("the seal package generated for gin-pgx", () => {
  it("passes its own test of the fixed vectors", async () => {
    const { stdout } = await run("go", ["test", "./generated/seal/", "-count=1"], {
      cwd: go!.dir,
      env: { ...process.env, GOFLAGS: "-mod=mod" }
    });
    expect(stdout).toMatch(/^ok\s+blog\/generated\/seal/m);
  }, 120_000);

  it("opens what TypeScript seals and seals what TypeScript opens, on both TypeScript backends", async () => {
    for (const name of ["drizzle-next", "hono-trpc-vite"]) {
      const seal = modules.get(name)!;
      for (const [field, plaintext] of [
        ["integrations.secret", "whsec_test_123"],
        ["users.recovery_code", "correct horse battery staple"],
        ["integrations.token", "ünïcode ✓ 秘密"],
        ["integrations.token", ""]
      ]) {
        expect(await goOpen(field, seal.sealWith(hex(KEY), field, plaintext)), `${name} to Go`).toBe(plaintext);
        expect(seal.openWith(hex(KEY), field, await goSeal(field, plaintext)), `Go to ${name}`).toBe(plaintext);
      }
    }
  });

  it("does not open what was sealed for another column or under another key", async () => {
    const seal = modules.get("drizzle-next")!;
    const stored = seal.sealWith(hex(KEY), "integrations.secret", "whsec_test_123");
    await expect(goOpen("integrations.token", stored)).rejects.toThrow(
      /integrations\.token: a sealed value did not open/
    );
    await expect(goOpen("integrations.secret", stored, SEAL_VECTORS[3].key)).rejects.toThrow(/did not open/);
  });

  it("does not load without the key, with a short one or with one that is not hexadecimal", async () => {
    const load = (value: string | undefined) => {
      const env: NodeJS.ProcessEnv = { ...process.env };
      delete env.OSL_SEAL_KEY;
      if (value !== undefined) env.OSL_SEAL_KEY = value;
      return run(go!.bin, ["load", "integrations.secret", "x"], { env });
    };
    await expect(load(undefined)).rejects.toThrow(/OSL_SEAL_KEY is not set: .*users\.recovery_code.* sealed/);
    await expect(load(KEY.slice(0, 32))).rejects.toThrow(/OSL_SEAL_KEY has 32 hexadecimal characters, not 64/);
    await expect(load("g".repeat(64))).rejects.toThrow(/OSL_SEAL_KEY is not hexadecimal/);
    const { stdout } = await load(KEY);
    expect(openValue(hex(KEY), "integrations.secret", hex(stdout))).toBe("x");
  });
});

describe.skipIf(!url || !hasGo)("sealed bytes through a bytea column of a real database", () => {
  let client: pg.Client;
  const table = `osl_sealed_${process.pid}_${Date.now()}`;

  beforeAll(async () => {
    client = new pg.Client({ connectionString: url });
    await client.connect();
    await client.query(`create table "${table}" (label text primary key, value bytea not null)`);
  });

  afterAll(async () => {
    await client.query(`drop table if exists "${table}"`);
    await client.end();
  });

  it("a value TypeScript stored is read by Go, a value Go stored by TypeScript, as bytes and as a query's text", async () => {
    const field = "integrations.token";
    for (const name of ["drizzle-next", "hono-trpc-vite"]) {
      const seal = modules.get(name)!;
      const written = `tok_live_${name} ✓ 秘密`;
      // TypeScript seals, the database holds, Go opens what the database hands back
      await client.query(`insert into "${table}" (label, value) values ($1, $2)`, [
        `${name} to go`,
        Buffer.from(seal.sealWith(hex(KEY), field, written))
      ]);
      const fromTs = (await client.query(`select value from "${table}" where label = $1`, [`${name} to go`])).rows[0]
        .value as Buffer;
      expect(fromTs.includes(Buffer.from(written, "utf8"))).toBe(false);
      expect(await goOpen(field, fromTs)).toBe(written);
      // Go seals, the database holds, TypeScript opens it from the driver's bytes and from the text inside a JSON row
      await client.query(`insert into "${table}" (label, value) values ($1, $2)`, [
        `go to ${name}`,
        await goSeal(field, written)
      ]);
      const row = (
        await client.query(`select value, to_jsonb(t)->>'value' as text from "${table}" t where label = $1`, [
          `go to ${name}`
        ])
      ).rows[0] as { value: Buffer; text: string };
      expect(seal.openWith(hex(KEY), field, row.value)).toBe(written);
      expect(row.text.startsWith("\\x")).toBe(true);
      expect(seal.openWith(hex(KEY), field, row.text)).toBe(written);
    }
  });
});
