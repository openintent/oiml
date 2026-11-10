import { describe, expect, it } from "vitest";
import {
  CURRENCY_CODES,
  Field,
  Model,
  applyDiff,
  compile,
  databaseObjects,
  isMoneyString,
  isolationDrift,
  openapiDocument,
  parseDiff,
  planMigration,
  renderPostgres,
  sequenceObjects,
  validateModel
} from "../src/index.js";

/** Teams that send invoices: a number counted per team, a total in the row's currency, a fee in dollars */
function model(change: (m: Record<string, any>) => void = () => {}): Model {
  const raw: Record<string, any> = {
    osl: "1.0",
    name: "billing",
    entities: {
      User: {
        fields: {
          id: { type: "uuid", primary: true },
          email: { type: "string", required: true, unique: true },
          role: { type: "enum", enum_values: ["member", "admin"], required: true, default: "member" }
        },
        rules: { read: "public", update: "owner:id", delete: "none" }
      },
      Team: {
        fields: { id: { type: "uuid", primary: true }, name: { type: "string", required: true } },
        rules: { read: "authenticated", create: "authenticated", update: "role:admin", delete: "role:admin" }
      },
      Invoice: {
        fields: {
          id: { type: "uuid", primary: true },
          team_id: { type: "uuid", required: true, relation: { entity: "Team", on_delete: "cascade" } },
          number: { type: "sequence", prefix: "INV-", scope: ["team_id"], width: 6 },
          customer: { type: "string", required: true },
          currency: { type: "enum", enum_values: ["USD", "EUR", "JPY"], required: true, default: "USD" },
          total: { type: "money", currency_field: "currency", required: true, validate: { min: "0" } },
          fee: { type: "money", currency: "USD", default: "0", validate: { max: "9999.99" } },
          created_at: { type: "datetime", required: true, default: "now" }
        },
        rules: { read: "authenticated", create: "authenticated", update: "authenticated", delete: "role:admin" }
      }
    },
    resources: {
      invoices: {
        entity: "Invoice",
        operations: ["list", "get", "create", "update", "delete"],
        list: {
          filters: ["number", "total", "currency"],
          sortable: ["number", "total"],
          search: ["number", "customer"]
        }
      }
    },
    auth: { identity: "User", provider: "credentials" }
  };
  change(raw);
  return Model.parse(raw);
}

const errors = (m: Model) => validateModel(m).filter(d => d.level === "error");
const codes = (m: Model) => validateModel(m).map(d => d.code);
const invoice = (m: Record<string, any>) => m.entities.Invoice.fields;

describe("a money field", () => {
  it("is numeric(19, 4), a money scalar with its currency and its bounds as decimal strings", () => {
    expect(errors(model())).toEqual([]);
    const entity = compile(model()).entities.find(e => e.name === "Invoice")!;
    const total = entity.columns.find(c => c.name === "total")!;
    expect(total.type).toEqual({ kind: "scalar", scalar: "money" });
    expect(total.money).toEqual({ currencyField: "currency", min: "0" });
    expect(total.validate).toBeUndefined();
    const fee = entity.columns.find(c => c.name === "fee")!;
    expect(fee.money).toEqual({ currency: "USD", max: "9999.99" });
    expect(fee.default).toEqual({ kind: "literal", value: "0" });
    const sql = renderPostgres(planMigration(null, compile(model())));
    expect(sql).toContain(`"total" numeric(19, 4) NOT NULL`);
    expect(sql).toContain(`"fee" numeric(19, 4) DEFAULT '0'`);
  });

  it("knows an amount from a number, a rounded amount and a string that is not one", () => {
    for (const ok of ["0", "19.99", "-0.0001", "999999999999999.9999", "007"]) expect(isMoneyString(ok), ok).toBe(true);
    for (const bad of [19.99, "1.23456", "1234567890123456", "1e3", "1,000", ".5", "5.", "", " 1", "$1", null])
      expect(isMoneyString(bad), String(bad)).toBe(false);
  });

  it("names its currency one way, with a code or the row's field", () => {
    const parse = (field: Record<string, unknown>) => Field.safeParse(field);
    expect(parse({ type: "money" }).success).toBe(false);
    expect(parse({ type: "money", currency: "USD", currency_field: "currency" }).success).toBe(false);
    expect(parse({ type: "money", currency: "usd" }).success).toBe(false);
    expect(parse({ type: "money", currency: "USD" }).success).toBe(true);
    expect(parse({ type: "decimal", currency: "USD" }).success).toBe(false);
    expect(CURRENCY_CODES.has("USD") && CURRENCY_CODES.has("JPY") && !CURRENCY_CODES.has("XXQ")).toBe(true);
    const unknown = validateModel(model(m => (invoice(m).fee.currency = "XXQ")));
    expect(unknown.filter(d => d.code === "M182").map(d => d.path)).toEqual(["entities.Invoice.fields.fee.currency"]);
  });

  it("takes bounds and a default as decimal strings, never as numbers", () => {
    const parse = (field: Record<string, unknown>) => Field.safeParse({ type: "money", currency: "USD", ...field });
    expect(parse({ validate: { min: 0 } }).success).toBe(false);
    expect(parse({ validate: { min: "0", max: "9999.99" } }).success).toBe(true);
    expect(parse({ validate: { max: "1.23456" } }).success).toBe(false);
    expect(parse({ validate: { min_length: 1 } }).success).toBe(false);
    expect(parse({ default: 0 }).success).toBe(false);
    expect(parse({ default: "0.00" }).success).toBe(true);
    expect(parse({ primary: true }).success).toBe(false);
    // And a decimal string is for money alone
    expect(Field.safeParse({ type: "integer", validate: { min: "0" } }).success).toBe(false);
    expect(Field.safeParse({ type: "integer", validate: { min: 0 } }).success).toBe(true);
  });

  it("reads its currency from a required enum of codes on the same entity (M182)", () => {
    const problem = (change: (fields: Record<string, any>) => void) =>
      validateModel(model(m => change(invoice(m))))
        .filter(d => d.code === "M182")
        .map(d => d.message);
    expect(problem(f => (f.total.currency_field = "nope"))[0]).toContain("is not a field of the entity");
    expect(problem(f => (f.total.currency_field = "customer"))[0]).toContain("is a string field");
    expect(problem(f => delete f.currency.required)[0]).toContain("is not required");
    expect(problem(f => (f.currency.enum_values = ["USD", "bitcoin", "points"]))[0]).toContain(
      "values that are no ISO 4217 code (bitcoin, points)"
    );
    expect(problem(() => {})).toEqual([]);
  });

  it("is filtered and sorted, never tested by a rule, a count's where or a tile's group", () => {
    expect(errors(model())).toEqual([]);
    const ruled = errors(model(m => (m.entities.Invoice.rules.update = "authenticated when total = 0")));
    expect(ruled.map(d => d.message).join(" ")).toContain("not money");
    // An example actor's amount is a decimal string too
    const actor = errors(
      model(m => {
        m.entities.User.fields.credit = { type: "money", currency: "USD", read_only: true };
        m.examples = { actors: { ann: { email: "ann@example.com", password: "ann-pass-1", credit: 5 } } };
      })
    );
    expect(actor.map(d => d.code)).toEqual(["M076"]);
  });

  it("warns when an update may change the currency but not the amount in it (M184)", () => {
    expect(codes(model())).not.toContain("M184");
    const split = validateModel(model(m => (m.resources.invoices.update = { fields: ["customer", "currency"] })));
    expect(split.filter(d => d.code === "M184").map(d => d.level)).toEqual(["warning"]);
    const kept = validateModel(model(m => (invoice(m).total.read_only = true)));
    expect(kept.filter(d => d.code === "M184")[0].message).toContain("invoices.update writes currency");
    expect(codes(model(m => (m.resources.invoices.update = { fields: ["customer"] })))).not.toContain("M184");
  });

  it("is a string in the OpenAPI document, with what it counts in words", () => {
    const doc = openapiDocument(compile(model()), "1.0.0") as any;
    const shape = doc.components.schemas.Invoice.properties;
    expect(shape.total).toEqual({
      type: "string",
      format: "decimal",
      pattern: "^-?\\d{1,15}(\\.\\d{1,4})?$",
      description:
        "An amount of the currency the row's currency names as a decimal string with at most four fraction digits, never a number; at least 0"
    });
    expect(shape.fee.oneOf[0].description).toContain("An amount of USD");
    expect(shape.fee.oneOf[0].description).toContain("at most 9999.99");
  });

  it("is allowed in an action's input with a currency code, not with a currency field", () => {
    const pay = (field: Record<string, unknown>) =>
      model(m => (m.resources.invoices.actions = { pay: { input: { amount: field } } }));
    expect(errors(pay({ type: "money", currency: "USD", required: true }))).toEqual([]);
    const input = compile(pay({ type: "money", currency: "USD", required: true })).actions.find(a => a.name === "pay")!
      .input[0];
    expect(input.money).toEqual({ currency: "USD" });
    expect(errors(pay({ type: "money", currency_field: "currency" })).map(d => d.code)).toEqual(["M090"]);
    expect(errors(pay({ type: "sequence" })).map(d => d.code)).toEqual(["M090"]);
  });
});

describe("a sequence field", () => {
  it("is a read-only string the database numbers, unique within its scope", () => {
    const ir = compile(model());
    const entity = ir.entities.find(e => e.name === "Invoice")!;
    const number = entity.columns.find(c => c.name === "number")!;
    expect(number).toMatchObject({
      type: { kind: "scalar", scalar: "string" },
      nullable: false,
      readOnly: true,
      default: { kind: "literal", value: "" },
      sequence: { prefix: "INV-", width: 6 },
      maxLength: 255
    });
    expect(entity.sequences).toEqual([
      {
        column: "number",
        key: "invoices.number",
        prefix: "INV-",
        width: 6,
        scope: ["team_id"],
        unique: { name: "invoices_team_id_number_key", columns: ["team_id", "number"] },
        function: "osl_sequence_invoices_number",
        trigger: "osl_sequence_number"
      }
    ]);
    expect(entity.uniques).toContainEqual({ name: "invoices_team_id_number_key", columns: ["team_id", "number"] });
    // No write carries it, and a row keeps the scope its number was counted in
    const ops = ir.resources.find(r => r.name === "invoices")!.operations;
    const fields = (kind: string) => (ops.find(o => o.kind === kind) as { fields: string[] }).fields;
    expect(fields("create")).toEqual(["team_id", "customer", "currency", "total", "fee"]);
    expect(fields("update")).toEqual(["customer", "currency", "total", "fee"]);
    // The number names the row: the first short string that is not a key
    expect(entity.display).toBe("number");
  });

  it("is made of a counter table, a trigger function and a BEFORE INSERT trigger", () => {
    const ir = compile(model());
    const objects = sequenceObjects(ir);
    expect(objects.map(o => o.key)).toEqual([
      "table:osl_sequences",
      "function:osl_sequence_invoices_number",
      "trigger:invoices:osl_sequence_number"
    ]);
    expect(databaseObjects(ir).slice(-3)).toEqual(objects);
    const source = objects[1].body!.source;
    expect(source).toContain(`VALUES ('invoices.number', jsonb_build_array(NEW."team_id")::text, 1)`);
    expect(source).toContain(`ON CONFLICT ("sequence", "scope") DO UPDATE SET "last" = s."last" + 1`);
    expect(source).toContain(
      `NEW."number" := 'INV-' || lpad(osl_count::text, greatest(6, length(osl_count::text)), '0');`
    );
    expect(objects[1].body!.definer).toBe(false);
    expect(objects[2].create[0]).toBe(
      `CREATE TRIGGER "osl_sequence_number" BEFORE INSERT ON "invoices" FOR EACH ROW EXECUTE FUNCTION "osl_sequence_invoices_number"();`
    );
    // Without a scope, a prefix or a width: one counter for the table and the bare count
    const bare = compile(model(m => (invoice(m).number = { type: "sequence" })));
    const plain = sequenceObjects(bare)[1].body!.source;
    expect(plain).toContain(`VALUES ('invoices.number', '[]', 1)`);
    expect(plain).toContain(`NEW."number" := osl_count::text;`);
    expect(bare.entities.find(e => e.name === "Invoice")!.uniques).toContainEqual({
      name: "invoices_number_key",
      columns: ["number"]
    });
  });

  it("takes no options of another kind, and no other field takes its own", () => {
    const parse = (field: Record<string, unknown>) => Field.safeParse(field);
    expect(parse({ type: "sequence", prefix: "INV-", scope: ["team_id"], width: 6 }).success).toBe(true);
    expect(parse({ type: "sequence", required: true, read_only: true }).success).toBe(true);
    for (const extra of [{ unique: true }, { default: "A-1" }, { hidden: true }, { primary: true }, { max_length: 20 }])
      expect(parse({ type: "sequence", ...extra }).success, JSON.stringify(extra)).toBe(false);
    expect(parse({ type: "sequence", prefix: "INV 2026 " }).success).toBe(false);
    expect(parse({ type: "sequence", width: 0 }).success).toBe(false);
    expect(parse({ type: "string", prefix: "INV-" }).success).toBe(false);
    expect(parse({ type: "integer", scope: ["team_id"] }).success).toBe(false);
  });

  it("counts within required fields a row keeps (M180)", () => {
    const problem = (change: (fields: Record<string, any>) => void) =>
      validateModel(model(m => change(invoice(m))))
        .filter(d => d.code === "M180")
        .map(d => d.message);
    expect(problem(f => (f.number.scope = ["nope"]))[0]).toContain("sequence scope nope is not a field");
    expect(problem(f => (f.number.scope = ["team_id", "team_id"]))[0]).toContain("is named twice");
    expect(problem(f => (f.number.scope = ["total"]))[0]).toContain("is a money field");
    expect(problem(f => (f.number.scope = ["created_at"]))[0]).toContain("is a datetime field");
    const optional = problem(f => {
      f.kind = { type: "enum", enum_values: ["sale", "credit"] };
      f.number.scope = ["team_id", "kind"];
    });
    expect(optional[0]).toContain("kind is not required");
    expect(problem(f => (f.number.scope = ["team_id", "currency"]))).toEqual([]);
  });

  it("is never written by a client, and its scope is not updated (M064, M183)", () => {
    const listed = (key: "create" | "update", fields: string[]) =>
      errors(model(m => (m.resources.invoices[key] = { fields }))).map(d => d.code);
    expect(listed("create", ["team_id", "customer", "total", "number"])).toEqual(["M064"]);
    expect(listed("update", ["customer", "number"])).toEqual(["M064"]);
    expect(listed("update", ["customer", "team_id"])).toEqual(["M183"]);
    expect(listed("create", ["team_id", "customer", "total"])).toEqual([]);
  });

  it("is filtered, sorted and searched as a string, and may carry read without the unique warning", () => {
    expect(errors(model())).toEqual([]);
    const hidden = model(m => {
      invoice(m).number.read = "role:admin";
      m.resources.invoices.list = { filters: ["currency"] };
    });
    // B5's rules hold for it as for any field: no filter, sort or search by a field some readers do not get
    expect(codes(hidden)).not.toContain("M175");
    expect(errors(hidden)).toEqual([]);
    expect(codes(model(m => (invoice(m).number.read = "role:admin")))).toContain("M172");
    // A plain unique field with read still gets the warning a sequence is spared
    expect(codes(model(m => (invoice(m).customer = { type: "string", unique: true, read: "role:admin" })))).toContain(
      "M175"
    );
    // The default order is the entity's as before: a number orders a list only where the model says so
    const list = compile(hidden)
      .resources.find(r => r.name === "invoices")!
      .operations.find(o => o.kind === "list") as { order: [string, string][] };
    expect(list.order).toEqual([["created_at", "desc"]]);
  });

  it("is a read-only string with its pattern in the OpenAPI document", () => {
    const doc = openapiDocument(compile(model()), "1.0.0") as any;
    expect(doc.components.schemas.Invoice.properties.number).toEqual({
      type: "string",
      maxLength: 255,
      pattern: "^INV-\\d{6,}$",
      description: "Assigned by the server when the row is created; never accepted from a client",
      readOnly: true
    });
    const create = doc.paths["/api/invoices"].post.requestBody.content["application/json"].schema;
    expect(Object.keys(create.properties)).not.toContain("number");
  });

  it("arrives on a table that has rows: numbered before the unique constraint, counters seeded after the table", () => {
    const before = compile(
      model(m => {
        delete invoice(m).number;
        m.resources.invoices.list = { filters: ["total"] };
      })
    );
    const plan = planMigration(before, compile(model()));
    const kinds = plan.steps.map(s => (s.kind === "sql" ? s.about : s.kind));
    expect(kinds).toEqual([
      "add_column",
      "backfill_sequence",
      "add_unique",
      "table osl_sequences",
      "function osl_sequence_invoices_number",
      "trigger osl_sequence_number",
      "counters of invoices.number"
    ]);
    expect(plan.rewrites.map(s => s.kind)).toEqual(["backfill_sequence"]);
    const sql = renderPostgres(plan);
    expect(sql).toContain(`ALTER TABLE "invoices" ADD COLUMN "number" varchar(255) NOT NULL DEFAULT '';`);
    expect(sql).toContain(
      `row_number() OVER (PARTITION BY "team_id" ORDER BY "created_at", "id") AS osl_count FROM "invoices"`
    );
    // A fresh table needs neither
    const fresh = planMigration(null, compile(model())).steps.map(s => s.kind);
    expect(fresh).not.toContain("backfill_sequence");
  });

  it("keeps its counters through a rename, a changed format and a changed scope, and drops them with the field", () => {
    const ir = compile(model());
    const steps = (next: Model, renames = { entities: {}, fields: {} }) =>
      planMigration(ir, compile(next), renames)
        .steps.filter(s => s.kind === "sql")
        .map(s => (s as { about: string }).about);
    // A new prefix or width is a new function; the counter table is never made again
    const reformatted = steps(model(m => Object.assign(invoice(m).number, { prefix: "N", width: 8 })));
    expect(reformatted).toEqual([
      "drop trigger osl_sequence_number",
      "drop function osl_sequence_invoices_number",
      "function osl_sequence_invoices_number",
      "trigger osl_sequence_number"
    ]);
    const renamed = planMigration(
      ir,
      compile(
        model(m => {
          const { number, ...rest } = invoice(m);
          m.entities.Invoice.fields = { ...rest, reference: number };
          m.resources.invoices.list = { filters: ["reference"] };
        })
      ),
      { entities: {}, fields: { Invoice: { number: "reference" } } }
    );
    expect(renderPostgres(renamed)).toContain(
      `UPDATE "osl_sequences" SET "sequence" = 'invoices.reference' WHERE "sequence" = 'invoices.number';`
    );
    expect(renamed.steps.map(s => s.kind)).not.toContain("backfill_sequence");
    const rescoped = planMigration(ir, compile(model(m => (invoice(m).number.scope = []))));
    expect(rescoped.warnings.join(" ")).toContain("the migration fails if two rows of one new scope share a number");
    expect(renderPostgres(rescoped)).toContain(`DELETE FROM "osl_sequences" WHERE "sequence" = 'invoices.number';`);
    // The last sequence takes the table with it
    const gone = steps(
      model(m => {
        delete invoice(m).number;
        m.resources.invoices.list = { filters: ["total"] };
      })
    );
    expect(gone).toEqual([
      "drop trigger osl_sequence_number",
      "drop function osl_sequence_invoices_number",
      "drop table osl_sequences"
    ]);
  });

  it("follows a renamed scope field, as an amount follows its renamed currency field", () => {
    const renamed = applyDiff(
      model(),
      parseDiff({
        osl: "1.0",
        summary: "rename",
        ops: [
          { op: "rename_field", entity: "Invoice", from: "team_id", to: "workspace_id" },
          { op: "rename_field", entity: "Invoice", from: "currency", to: "currency_code" }
        ]
      })
    ).model;
    expect(renamed.entities.Invoice.fields.number.scope).toEqual(["workspace_id"]);
    expect(renamed.entities.Invoice.fields.total.currency_field).toBe("currency_code");
    expect(errors(renamed)).toEqual([]);
  });

  it("is compared by the drift check like the other functions and triggers", () => {
    const ir = compile(model());
    const live = {
      secured: [],
      policies: [],
      functions: sequenceObjects(ir)
        .filter(o => o.kind === "function")
        .map(o => ({ name: o.name, definer: false, source: o.body!.source })),
      triggers: [{ table: "invoices", name: "osl_sequence_number" }]
    };
    expect(isolationDrift(ir, live)).toEqual([]);
    expect(isolationDrift(ir, { ...live, triggers: [] })).toEqual([
      { kind: "missing_trigger", table: "invoices", name: "osl_sequence_number" }
    ]);
    const changed = { ...live, functions: [{ ...live.functions[0], source: "BEGIN RETURN NEW; END" }] };
    expect(isolationDrift(ir, changed).map(d => d.kind)).toEqual(["function"]);
  });
});
