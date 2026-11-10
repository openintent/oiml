import { createDecipheriv } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  Field,
  Model,
  SEAL_VECTORS,
  applyDiff,
  compile,
  compileShape,
  hasSealed,
  openValue,
  openapiDocument,
  parseDiff,
  parseSealKey,
  planMigration,
  renderPostgres,
  sealKeyProblem,
  sealValue,
  sealedNames,
  shapeValueProblem,
  validateModel,
  withShapeDefaults
} from "../src/index.js";

/** People with preferences and a sealed recovery code; integrations whose settings follow their kind */
function model(change: (m: Record<string, any>) => void = () => {}): Model {
  const raw: Record<string, any> = {
    osl: "1.0",
    name: "hub",
    entities: {
      User: {
        fields: {
          id: { type: "uuid", primary: true },
          email: { type: "string", required: true, unique: true },
          name: { type: "string" },
          role: { type: "enum", enum_values: ["member", "admin"], required: true, default: "member" },
          preferences: {
            type: "json",
            shape: {
              theme: { type: "enum", enum_values: ["light", "dark"], default: "light" },
              digest: { type: "boolean", default: true },
              quiet_hours: {
                type: "json",
                shape: {
                  from: { type: "integer", required: true, validate: { min: 0, max: 23 } },
                  to: { type: "integer", required: true, validate: { min: 0, max: 23 } }
                }
              }
            }
          },
          recovery_code: { type: "string", sealed: true, read: "owner:id" }
        },
        rules: { read: "public", update: "owner:id", delete: "none" }
      },
      Integration: {
        fields: {
          id: { type: "uuid", primary: true },
          owner_id: { type: "uuid", required: true, relation: { entity: "User", on_delete: "cascade" } },
          name: { type: "string", required: true },
          kind: { type: "enum", enum_values: ["webhook", "slack", "none"], required: true },
          config: {
            type: "json",
            required: true,
            shape_by: {
              kind: {
                webhook: {
                  url: { type: "string", required: true, validate: { format: "url" } },
                  retries: { type: "integer", default: 3, validate: { min: 0, max: 10 } }
                },
                slack: { channel: { type: "string", required: true }, to: { type: "array", array_type: "string" } },
                none: {}
              }
            }
          },
          secret: { type: "string", sealed: true },
          token: { type: "text", sealed: true, read: "owner:owner_id" },
          pin: { type: "string", sealed: true, hidden: true }
        },
        rules: {
          read: "owner:owner_id or role:admin",
          create: "owner:owner_id",
          update: "owner:owner_id",
          delete: "owner:owner_id"
        }
      }
    },
    resources: {
      users: { entity: "User", operations: ["list", "get", "update"] },
      integrations: { entity: "Integration", operations: ["list", "get", "create", "update", "delete"] }
    },
    auth: { identity: "User", provider: "credentials" }
  };
  change(raw);
  return Model.parse(raw);
}

const errors = (m: Model) => validateModel(m).filter(d => d.level === "error");
const codes = (m: Model) => validateModel(m).map(d => d.code);
const messages = (m: Model) => validateModel(m).map(d => d.message);
const fields = (m: Record<string, any>, entity = "Integration") => m.entities[entity].fields;
const hex = (text: string) => Buffer.from(text, "hex");

describe("the format of a sealed value", () => {
  it("stores the bytes the fixed vectors say, and opens them", () => {
    for (const v of SEAL_VECTORS) {
      expect(sealValue(hex(v.key), v.name, v.plaintext, hex(v.nonce)).toString("hex")).toBe(v.sealed);
      expect(openValue(hex(v.key), v.name, hex(v.sealed))).toBe(v.plaintext);
    }
  });

  it("is a version byte, a 12-byte nonce, the ciphertext and a 16-byte tag, bound to the column's name", () => {
    const v = SEAL_VECTORS[0];
    const stored = hex(v.sealed);
    expect(stored[0]).toBe(1);
    expect(stored.subarray(1, 13).toString("hex")).toBe(v.nonce);
    expect(stored.length).toBe(1 + 12 + Buffer.byteLength(v.plaintext) + 16);
    // Opened by hand, with nothing of the module under test: AES-256-GCM, the associated data 0x01 and the name
    const decipher = createDecipheriv("aes-256-gcm", hex(v.key), stored.subarray(1, 13));
    decipher.setAAD(Buffer.concat([Buffer.from([1]), Buffer.from(v.name, "utf8")]));
    decipher.setAuthTag(stored.subarray(stored.length - 16));
    const plain = Buffer.concat([decipher.update(stored.subarray(13, stored.length - 16)), decipher.final()]);
    expect(plain.toString("utf8")).toBe(v.plaintext);
  });

  it("does not open under another column, another key, another version or once a byte has changed", () => {
    const v = SEAL_VECTORS[0];
    expect(() => openValue(hex(v.key), "integrations.token", hex(v.sealed))).toThrow(/did not open/);
    expect(() => openValue(hex(SEAL_VECTORS[3].key), v.name, hex(v.sealed))).toThrow(/did not open/);
    for (const at of [1, 13, hex(v.sealed).length - 1]) {
      const flipped = hex(v.sealed);
      flipped[at] ^= 1;
      expect(() => openValue(hex(v.key), v.name, flipped)).toThrow(/did not open/);
    }
    const versioned = hex(v.sealed);
    versioned[0] = 2;
    expect(() => openValue(hex(v.key), v.name, versioned)).toThrow(/layout version 2/);
    expect(() => openValue(hex(v.key), v.name, Buffer.from("plain text"))).toThrow(/too short/);
    // What the refusal says names the column and never the value
    try {
      openValue(hex(SEAL_VECTORS[3].key), v.name, hex(v.sealed));
    } catch (error) {
      expect(String(error)).toContain(v.name);
      expect(String(error)).not.toContain(v.plaintext);
    }
  });

  it("takes a fresh nonce for every write, so the same value never stores the same bytes", () => {
    const v = SEAL_VECTORS[0];
    const once = sealValue(hex(v.key), v.name, v.plaintext);
    const again = sealValue(hex(v.key), v.name, v.plaintext);
    expect(once.equals(again)).toBe(false);
    expect(once.includes(Buffer.from(v.plaintext))).toBe(false);
    expect(openValue(hex(v.key), v.name, once)).toBe(v.plaintext);
  });

  it("takes a key of 64 hexadecimal characters and nothing else", () => {
    expect(sealKeyProblem(undefined)).toBe("OSL_SEAL_KEY is not set");
    expect(sealKeyProblem("")).toBe("OSL_SEAL_KEY is not set");
    expect(sealKeyProblem("abc")).toBe("OSL_SEAL_KEY has 3 hexadecimal characters, not 64");
    expect(sealKeyProblem("z".repeat(64))).toBe("OSL_SEAL_KEY is not hexadecimal");
    expect(sealKeyProblem(SEAL_VECTORS[0].key + "00")).toBe("OSL_SEAL_KEY has 66 hexadecimal characters, not 64");
    expect(sealKeyProblem(SEAL_VECTORS[0].key)).toBeUndefined();
    expect(parseSealKey(SEAL_VECTORS[0].key.toUpperCase())).toHaveLength(32);
    expect(() => parseSealKey("abc")).toThrow(/openssl rand -hex 32/);
  });
});

describe("a sealed field", () => {
  it("is bytea whatever its type, and leaves the server for the callers its read rule names, or for nobody", () => {
    expect(errors(model())).toEqual([]);
    const ir = compile(model());
    const integration = ir.entities.find(e => e.name === "Integration")!;
    const column = (name: string) => integration.columns.find(c => c.name === name)!;
    expect(column("secret")).toMatchObject({ sealed: true, type: { kind: "scalar", scalar: "string" } });
    expect(column("secret").read).toEqual({ kind: "none" });
    expect(column("token").read).toEqual({ kind: "owner", field: "owner_id" });
    // Hidden and sealed: never accepted, never returned; a handler writes and reads it
    expect(column("pin")).toMatchObject({ sealed: true, hidden: true });
    expect(column("pin").read).toBeUndefined();
    expect(hasSealed(ir)).toBe(true);
    expect(sealedNames(ir)).toEqual([
      "users.recovery_code",
      "integrations.secret",
      "integrations.token",
      "integrations.pin"
    ]);
    const sql = renderPostgres(planMigration(null, ir));
    expect(sql).toContain('"secret" bytea,');
    expect(sql).toContain('"token" bytea,');
    expect(sql).toContain('"recovery_code" bytea');
    // Written through the resource, never at register, and never straight into the database by a seed or a test
    expect(ir.auth!.registerFields).toEqual(["name", "preferences"]);
    const create = ir.resources.find(r => r.name === "integrations")!.operations.find(o => o.kind === "create")!;
    expect(create.kind === "create" && create.fields).toEqual(["name", "kind", "config", "secret", "token"]);
  });

  it("may be written by callers its read rule refuses, without the warning a plain field gets (M174)", () => {
    const sealed = model(raw => (fields(raw).token.read = "role:admin"));
    expect(codes(sealed)).not.toContain("M174");
    const plain = model(raw => (fields(raw).name.read = "role:admin"));
    expect(codes(plain)).toContain("M174");
  });

  it("is a string or a text and nothing a database would have to compare or fill in", () => {
    const refused = (field: Record<string, unknown>) => Field.safeParse(field).success;
    expect(refused({ type: "integer", sealed: true })).toBe(false);
    expect(refused({ type: "json", sealed: true })).toBe(false);
    expect(refused({ type: "string", sealed: true, unique: true })).toBe(false);
    expect(refused({ type: "string", sealed: true, default: "x" })).toBe(false);
    expect(refused({ type: "string", sealed: true, primary: true })).toBe(false);
    expect(refused({ type: "string", sealed: true, relation: { entity: "User" } })).toBe(false);
    expect(refused({ type: "text", sealed: true, required: true, validate: { min_length: 8 } })).toBe(true);
  });

  it("is never filtered, sorted, searched, ordered by, indexed or made unique (M185)", () => {
    for (const option of ["filters", "sortable", "search"]) {
      const m = model(raw => (raw.resources.integrations.list = { [option]: ["secret"] }));
      expect(codes(m)).toContain("M185");
    }
    expect(codes(model(raw => (raw.resources.integrations.list = { order: [["token", "asc"]] })))).toContain("M185");
    expect(codes(model(raw => (raw.entities.Integration.unique = [["owner_id", "secret"]])))).toContain("M185");
    expect(codes(model(raw => (raw.entities.Integration.indexes = [{ fields: ["secret"] }])))).toContain("M185");
    expect(messages(model(raw => (raw.resources.integrations.list = { filters: ["secret"] }))).join("\n")).toContain(
      "the database holds ciphertext that no query can compare"
    );
  });

  it("is never tested by a rule, a field rule, a timer or a count", () => {
    const rule = model(raw => (raw.entities.Integration.rules.read = "authenticated when secret = x"));
    expect(messages(rule).join("\n")).toContain("the field is sealed");
    expect(codes(rule)).toContain("M033");
    const nulled = model(raw => (raw.entities.Integration.rules.read = "authenticated when secret = null"));
    expect(codes(nulled)).toContain("M033");
    const fieldRule = model(raw => (fields(raw).name.read = "authenticated when token = x"));
    expect(codes(fieldRule)).toContain("M033");
    const counted = model(raw => {
      raw.entities.Integration.fields.owner_id.relation.reverse = "integrations";
      raw.entities.User.fields.sealed_count = { type: "integer", count_of: "integrations", where: "secret != x" };
    });
    expect(codes(counted)).toContain("M154");
  });

  it("is not an action's field, and hidden with it takes no read rule", () => {
    const action = model(raw => {
      raw.resources.integrations.actions = {
        rotate: { input: { next: { type: "string", sealed: true } }, rule: "owner:owner_id" }
      };
    });
    expect(codes(action)).toContain("M090");
    expect(codes(model(raw => (fields(raw).pin.read = "owner:owner_id")))).toContain("M170");
  });

  it("keeps its column: no migration seals or opens what is stored, and a rename would not open either", () => {
    const base = model();
    const apply = (ops: unknown[]) => applyDiff(base, parseDiff({ osl: "1.0", summary: "x", ops }));
    expect(() =>
      apply([{ op: "update_field", entity: "Integration", name: "name", field: { type: "string", sealed: true } }])
    ).toThrow(/becomes sealed: a migration has no key/);
    expect(() =>
      apply([{ op: "update_field", entity: "Integration", name: "secret", field: { type: "string" } }])
    ).toThrow(/stops being sealed/);
    expect(() => apply([{ op: "rename_field", entity: "Integration", from: "secret", to: "signing_key" }])).toThrow(
      /bound to its column's name/
    );
    expect(() => apply([{ op: "rename_entity", from: "Integration", to: "Connection" }])).toThrow(
      /bound to its table's name/
    );
    // With its table named, the entity is renamed and the values still open
    const named = model(raw => (raw.entities.Integration.table = "integrations"));
    const renamed = applyDiff(
      named,
      parseDiff({ osl: "1.0", summary: "x", ops: [{ op: "rename_entity", from: "Integration", to: "Connection" }] })
    );
    expect(sealedNames(compile(renamed.model))).toContain("integrations.secret");
    // Its read rule and its other options change freely
    expect(() =>
      apply([
        {
          op: "update_field",
          entity: "Integration",
          name: "secret",
          field: { type: "string", sealed: true, read: "owner:owner_id" }
        }
      ])
    ).not.toThrow();
  });

  it("is its declared type in the OpenAPI document, said to be sealed, and absent from required", () => {
    const doc = openapiDocument(compile(model()));
    const schema = doc.components.schemas.Integration as { required: string[]; properties: Record<string, any> };
    expect(schema.required).not.toContain("secret");
    expect(schema.required).not.toContain("token");
    expect(schema.properties.pin).toBeUndefined();
    expect(JSON.stringify(schema.properties.token)).toContain("Encrypted at rest");
    expect(JSON.stringify(schema.properties.token)).toContain('"type":"string"');
  });
});

describe("a json field with a shape", () => {
  const prefs = compileShape(model().entities.User.fields.preferences.shape!);

  it("compiles to keys with their kinds, defaults and one nested level, and stays jsonb", () => {
    const ir = compile(model());
    const column = ir.entities.find(e => e.name === "User")!.columns.find(c => c.name === "preferences")!;
    expect(column.type).toEqual({ kind: "scalar", scalar: "json" });
    expect(column.shape!.map(k => [k.name, k.kind, k.required, k.default])).toEqual([
      ["theme", "enum", false, "light"],
      ["digest", "boolean", false, true],
      ["quiet_hours", "object", false, undefined]
    ]);
    expect(column.shape![2].keys!.map(k => [k.name, k.kind, k.required])).toEqual([
      ["from", "integer", true],
      ["to", "integer", true]
    ]);
    expect(renderPostgres(planMigration(null, ir))).toContain('"preferences" jsonb');
    // A shape that changes is no step of a migration: stored values are neither rewritten nor checked
    const changed = compile(model(raw => (fields(raw, "User").preferences.shape.theme.enum_values = ["light"])));
    expect(planMigration(ir, changed).steps).toEqual([]);
  });

  it("says what does not fit with the path of the key (the reference the generated validators are held to)", () => {
    const problem = (value: unknown) => shapeValueProblem(prefs, value, "preferences");
    expect(problem({ theme: "dark" })).toBeUndefined();
    expect(problem({})).toBeUndefined();
    expect(problem({ theme: "blue" })).toMatchObject({ path: "preferences.theme" });
    expect(problem({ digest: "yes" })).toMatchObject({ path: "preferences.digest" });
    expect(problem({ quiet_hours: { from: 22 } })).toMatchObject({ path: "preferences.quiet_hours.to" });
    expect(problem({ quiet_hours: { from: 22, to: "seven" } })).toMatchObject({ path: "preferences.quiet_hours.to" });
    expect(problem({ quiet_hours: { from: 22, to: 24 } })).toMatchObject({ path: "preferences.quiet_hours.to" });
    expect(problem({ quiet_hours: { from: 22.5, to: 7 } })).toMatchObject({ path: "preferences.quiet_hours.from" });
    expect(problem({ quiet_hours: [22, 7] })).toMatchObject({ path: "preferences.quiet_hours" });
    expect(problem({ volume: 11 })).toMatchObject({ path: "preferences.volume" });
    expect(problem({ quiet_hours: { from: 1, to: 2, zone: "UTC" } })).toMatchObject({
      path: "preferences.quiet_hours.zone"
    });
    expect(problem({ theme: null })).toMatchObject({ path: "preferences.theme" });
    expect(problem([])).toMatchObject({ path: "preferences" });
    expect(problem("{}")).toMatchObject({ path: "preferences" });
    expect(problem(null)).toMatchObject({ path: "preferences" });
  });

  it("fills a key's default in when the writer leaves the key out, nested shapes too", () => {
    expect(withShapeDefaults(prefs, {})).toEqual({ theme: "light", digest: true });
    expect(withShapeDefaults(prefs, { theme: "dark", quiet_hours: { from: 1, to: 2 } })).toEqual({
      theme: "dark",
      digest: true,
      quiet_hours: { from: 1, to: 2 }
    });
  });

  it("refuses what a key cannot be, each with its reason (M186)", () => {
    const withKey = (key: Record<string, unknown>) => model(raw => (fields(raw, "User").preferences.shape.extra = key));
    const said = (key: Record<string, unknown>) =>
      validateModel(withKey(key))
        .filter(d => d.code === "M186")
        .map(d => d.message)
        .join("\n");
    expect(said({ type: "money", currency: "USD" })).toContain("an amount is a field of its own");
    expect(said({ type: "sequence" })).toContain("a sequence is a field the database numbers");
    expect(said({ type: "file" })).toContain("a file is a field of its own");
    expect(said({ type: "bigint" })).toContain("a JSON number is a float");
    expect(said({ type: "string", read: "role:admin" })).toContain("a rule per key is not offered");
    expect(said({ type: "string", sealed: true })).toContain("a sealed value is a field of its own");
    expect(said({ type: "uuid", relation: { entity: "User" } })).toContain("a key cannot point at a row");
    expect(said({ type: "string", unique: true })).toContain("the database holds no constraint on it");
    expect(said({ type: "json" })).toContain("needs a shape of its own");
    expect(said({ type: "array", array_type: "string", shape: {} })).toContain("cannot be an array of shapes");
    expect(said({ type: "array", array_type: "decimal" })).toContain("an array inside a shape holds");
    expect(said({ type: "integer", default: "three" })).toContain("has a default that does not fit");
    expect(said({ type: "integer", required: true, default: 3 })).toContain("drop required");
    expect(said({ type: "string", validate: { min: 1 } })).toContain("which hold for integers and floats");
    // Two levels down
    const deep = model(
      raw =>
        (fields(raw, "User").preferences.shape.quiet_hours.shape.zone = {
          type: "json",
          shape: { name: { type: "string" } }
        })
    );
    expect(messages(deep).join("\n")).toContain("a shape nests one level");
    // What is allowed: every scalar a JSON value holds as written, an enum, an array of scalars, one nested shape
    expect(
      errors(
        model(raw => {
          const shape = fields(raw, "User").preferences.shape;
          shape.since = { type: "date" };
          shape.seen_at = { type: "datetime" };
          shape.ratio = { type: "float", validate: { min: 0, max: 1 } };
          shape.tags = { type: "array", array_type: "string" };
          shape.ref = { type: "uuid" };
          shape.note = { type: "text", validate: { max_length: 500 } };
        })
      )
    ).toEqual([]);
  });

  it("holds its own default to the shape, and only applies to json", () => {
    const fits = model(raw => (fields(raw, "User").preferences.default = '{"theme": "dark"}'));
    expect(errors(fits)).toEqual([]);
    const misfit = model(raw => (fields(raw, "User").preferences.default = '{"theme": "blue"}'));
    expect(messages(misfit).join("\n")).toContain("does not fit the shape: theme must be one of light, dark");
    const broken = model(raw => (fields(raw, "User").preferences.default = "{theme"));
    expect(messages(broken).join("\n")).toContain("is not JSON");
    expect(Field.safeParse({ type: "string", shape: {} }).success).toBe(false);
    expect(Field.safeParse({ type: "json", shape: {}, shape_by: { kind: {} } }).success).toBe(false);
  });

  it("is a nested object in the OpenAPI document, with nothing beside its keys", () => {
    const doc = openapiDocument(compile(model()));
    const user = doc.components.schemas.User as { properties: Record<string, any> };
    const shape = user.properties.preferences.oneOf[0];
    expect(shape).toMatchObject({ type: "object", additionalProperties: false });
    expect(shape.properties.theme).toEqual({ type: "string", enum: ["light", "dark"], default: "light" });
    expect(shape.properties.quiet_hours.required).toEqual(["from", "to"]);
    expect(shape.properties.quiet_hours.properties.from).toEqual({ type: "integer", minimum: 0, maximum: 23 });
  });

  it("is not an action's field: an action's fields are already the keys of its input", () => {
    const action = model(raw => {
      raw.resources.integrations.actions = {
        tune: { input: { options: { type: "json", shape: { a: { type: "string" } } } }, rule: "owner:owner_id" }
      };
    });
    expect(codes(action)).toContain("M090");
  });
});

describe("a json field with a shape per enum value", () => {
  it("compiles to one shape per value, in the enum's order, and is not taken at register", () => {
    expect(errors(model())).toEqual([]);
    const ir = compile(model());
    const column = ir.entities.find(e => e.name === "Integration")!.columns.find(c => c.name === "config")!;
    expect(column.shapeBy!.column).toBe("kind");
    expect(column.shapeBy!.shapes.map(s => [s.value, s.keys.map(k => k.name)])).toEqual([
      ["webhook", ["url", "retries"]],
      ["slack", ["channel", "to"]],
      ["none", []]
    ]);
    const identity = compile(
      model(raw => {
        fields(raw, "User").plan = { type: "enum", enum_values: ["free", "paid"], required: true, default: "free" };
        fields(raw, "User").limits = {
          type: "json",
          shape_by: { plan: { free: {}, paid: { seats: { type: "integer", required: true } } } }
        };
      })
    );
    expect(identity.auth!.registerFields).not.toContain("limits");
  });

  it("names a required enum of the same entity that every reader reads, and a shape for each value (M187)", () => {
    const said = (change: (m: Record<string, any>) => void) =>
      validateModel(model(change))
        .filter(d => d.code === "M187")
        .map(d => d.message)
        .join("\n");
    expect(said(raw => (fields(raw).config.shape_by = { missing: { a: {} } }))).toContain(
      "is not a field of the entity"
    );
    expect(said(raw => (fields(raw).config.shape_by = { name: { a: {} } }))).toContain("is a string field");
    expect(said(raw => delete fields(raw).kind.required)).toContain("is not required");
    expect(said(raw => (fields(raw).kind.read = "role:admin"))).toContain("the keys of the value tell which shape");
    expect(said(raw => delete fields(raw).config.shape_by.kind.none)).toContain("has no shape for none");
    expect(said(raw => (fields(raw).config.shape_by.kind.email = {}))).toContain("names email, which is not a value");
    // A problem inside one value's shape is the shape's own (M186), with the value in its path
    const inner = validateModel(model(raw => (fields(raw).config.shape_by.kind.slack.cost = { type: "money" })));
    expect(inner.find(d => d.code === "M186")?.path).toBe(
      "entities.Integration.fields.config.shape_by.kind.slack.cost"
    );
    expect(Field.safeParse({ type: "json", shape_by: { a: {}, b: {} } }).success).toBe(false);
    expect(Field.safeParse({ type: "json", shape_by: { kind: { a: {} } }, default: "{}" }).success).toBe(false);
  });

  it("is refused on the field of the transitions, which a transition writes alone (M187)", () => {
    const m = model(raw => {
      fields(raw).kind.read_only = true;
      fields(raw).kind.default = "webhook";
      raw.entities.Integration.transitions = { field: "kind", mute: { from: ["webhook", "slack"], to: "none" } };
    });
    const said = validateModel(m).find(d => d.code === "M187")?.message ?? "";
    expect(said).toContain("is the field of the transitions");
    expect(said).toContain("a transition that carries the new value is not built in this version");
  });

  it("warns when an update may change the enum but not the value that follows it (M188)", () => {
    const m = model(raw => (raw.resources.integrations.update = { fields: ["name", "kind"] }));
    const warning = validateModel(m).find(d => d.code === "M188");
    expect(warning?.level).toBe("warning");
    expect(warning?.message).toContain("add config to update.fields or drop kind from them");
    expect(codes(model())).not.toContain("M188");
  });

  it("follows its enum field through a rename", () => {
    const renamed = applyDiff(
      model(),
      parseDiff({
        osl: "1.0",
        summary: "x",
        ops: [{ op: "rename_field", entity: "Integration", from: "kind", to: "channel_kind" }]
      })
    );
    expect(Object.keys(renamed.model.entities.Integration.fields.config.shape_by!)).toEqual(["channel_kind"]);
    expect(errors(renamed.model)).toEqual([]);
  });

  it("is one schema per value in the OpenAPI document", () => {
    const doc = openapiDocument(compile(model()));
    const integration = doc.components.schemas.Integration as { properties: Record<string, any> };
    expect(integration.properties.config.oneOf.map((s: { title: string }) => s.title)).toEqual([
      "kind = webhook",
      "kind = slack",
      "kind = none"
    ]);
    expect(integration.properties.config.oneOf[0].required).toEqual(["url"]);
    expect(integration.properties.config.description).toContain("follow kind");
  });
});

describe("an identity nobody could sign up to (M189)", () => {
  /** The M189 diagnostics of the model after a change to the identity, as `path: message` */
  const refused = (change: (user: Record<string, any>, raw: Record<string, any>) => void) =>
    validateModel(model(raw => change(fields(raw, "User"), raw)))
      .filter(d => d.code === "M189")
      .map(d => `${d.level} ${d.path}: ${d.message}`);

  it("refuses a required sealed field on the identity, which auth.register does not take", () => {
    const said = refused(user => (user.recovery_code.required = true));
    expect(said).toHaveLength(1);
    expect(said[0]).toMatch(/^error entities\.User\.fields\.recovery_code: User\.recovery_code must hold a value/);
    expect(said[0]).toContain("auth.register does not take a sealed field");
    expect(said[0]).toContain("nobody could register");
    expect(said[0]).toContain("make the field optional, or keep it on an entity of its own with a relation to User");
    // A sealed field has no default to give
    expect(said[0]).not.toContain("give it a default");
    // Hidden as well: still the sealed field's sentence
    expect(refused(user => (user.pin = { type: "string", sealed: true, hidden: true, required: true }))[0]).toContain(
      "a sealed field"
    );
  });

  it("refuses a required field with shape_by on the identity", () => {
    const said = refused(user => {
      user.plan = { type: "enum", enum_values: ["free", "paid"], required: true, default: "free" };
      user.limits = {
        type: "json",
        required: true,
        shape_by: { plan: { free: {}, paid: { seats: { type: "integer", required: true } } } }
      };
    });
    expect(said).toHaveLength(1);
    expect(said[0]).toContain("entities.User.fields.limits");
    expect(said[0]).toContain("auth.register does not take a field with shape_by");
    expect(said[0]).toContain("make the field optional, or keep it on an entity of its own");
  });

  it("refuses every other required field no sign-up fills: hidden, bytes, a file, role", () => {
    const hidden = refused(user => (user.api_secret = { type: "string", hidden: true, required: true }));
    expect(hidden).toHaveLength(1);
    expect(hidden[0]).toContain("auth.register does not take a hidden field");
    expect(hidden[0]).toContain("give it a default, make it optional, or keep it on an entity of its own");
    const bytes = refused(user => (user.fingerprint = { type: "bytes", required: true }));
    expect(bytes).toHaveLength(1);
    expect(bytes[0]).toContain("auth.register does not take a bytes field");
    const file = refused(user => (user.avatar = { type: "file", required: true }));
    expect(file).toHaveLength(1);
    expect(file[0]).toContain("auth.register does not take a file field (an upload needs a session)");
    expect(file[0]).not.toContain("give it a default");
    const role = refused(user => delete user.role.default);
    expect(role).toHaveLength(1);
    expect(role[0]).toContain("entities.User.fields.role");
    expect(role[0]).toContain("auth.register does not take role");
    expect(role[0]).toMatch(/nobody could register; give it a default, the role a new user starts with$/);
  });

  it("refuses a key the database does not generate, and takes the ones it does", () => {
    const text = refused(user => (user.id = { type: "string", primary: true }));
    expect(text).toHaveLength(1);
    expect(text[0]).toContain("entities.User.fields.id");
    expect(text[0]).toContain("auth.register does not take a key the database does not generate");
    expect(text[0]).toContain("use a single uuid or integer key");
    // A composite key is not generated either: both halves are named
    const composite = refused(user => (user.org = { type: "string", primary: true }));
    expect(composite.map(line => line.split(":")[0])).toEqual([
      "error entities.User.fields.id",
      "error entities.User.fields.org"
    ]);
    for (const type of ["uuid", "integer", "bigint"])
      expect(
        refused((user, raw) => {
          user.id = { type, primary: true };
          // The relations to the identity follow its key's type
          fields(raw).owner_id.type = type;
        }),
        type
      ).toEqual([]);
    // The email as the key is what register takes
    expect(
      refused((user, raw) => {
        delete user.id;
        user.email.primary = true;
        fields(raw).owner_id.type = "string";
        raw.entities.User.rules = { read: "public", update: "owner:email", delete: "none" };
        user.recovery_code.read = "owner:email";
      })
    ).toEqual([]);
  });

  it("leaves a read_only field to M065, except where the create rule would have set it from a session", () => {
    const plain = validateModel(
      model(raw => (fields(raw, "User").level = { type: "integer", read_only: true, required: true }))
    );
    expect(plain.filter(d => d.path === "entities.User.fields.level").map(d => d.code)).toEqual(["M065"]);
    // M065 lets a required read_only field through when rules.create sets it from the session; at sign-up there is none
    const owned = validateModel(
      model(raw => {
        fields(raw, "User").invited_by = {
          type: "uuid",
          read_only: true,
          required: true,
          relation: { entity: "User", on_delete: "restrict" }
        };
        raw.entities.User.rules.create = "owner:invited_by";
      })
    );
    const said = owned.filter(d => d.path === "entities.User.fields.invited_by");
    expect(said.map(d => d.code)).toEqual(["M189"]);
    expect(said[0].message).toContain("auth.register does not take a read_only field");
  });

  it("holds whatever the providers are: a magic link or OAuth fills nothing but the email and the name", () => {
    for (const providers of [["credentials"], ["magic_link"], ["credentials", { oauth: "github" }]])
      expect(
        refused((user, raw) => {
          user.recovery_code.required = true;
          raw.auth = { identity: "User", providers };
        }),
        JSON.stringify(providers)
      ).toHaveLength(1);
  });

  it("says nothing of what a sign-up fills, the database fills, or may stay empty", () => {
    // The model as it is: an optional sealed field on the identity, a required one with shape_by on another entity
    expect(refused(() => {})).toEqual([]);
    expect(fields(model() as Record<string, any>).config.required).toBe(true);
    const fine: Record<string, (user: Record<string, any>) => void> = {
      "a required field register takes": user => (user.nickname = { type: "string", required: true }),
      "a required field with read:": user => (user.phone = { type: "string", required: true, read: "owner:id" }),
      "a required relation": user =>
        (user.sponsor_id = { type: "uuid", required: true, relation: { entity: "User", on_delete: "restrict" } }),
      "required typed JSON": user =>
        (user.settings = { type: "json", required: true, shape: { theme: { type: "string" } } }),
      "a sequence": user => (user.number = { type: "sequence", prefix: "U-" }),
      "a position": user => {
        user.sponsor_id = { type: "uuid", required: true, relation: { entity: "User", on_delete: "restrict" } };
        user.place = { type: "integer", position: { within: "sponsor_id" } };
      },
      "a hidden field with a default": user =>
        (user.api_secret = { type: "string", hidden: true, required: true, default: "" }),
      "an optional hidden field": user => (user.api_secret = { type: "string", hidden: true }),
      "an optional file": user => (user.avatar = { type: "file" }),
      "a stamp the database sets": user => (user.created_at = { type: "datetime", required: true, default: "now" })
    };
    for (const [what, change] of Object.entries(fine)) expect(refused(change), what).toEqual([]);
  });

  it("is the identity's alone: the same fields on another entity are a handler's or a create's to fill", () => {
    const m = model(raw => {
      fields(raw).secret.required = true;
      fields(raw).api_key = { type: "string", hidden: true, required: true };
    });
    expect(codes(m)).not.toContain("M189");
  });
});
