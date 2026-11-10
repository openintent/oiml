/**
 * Money never touches a float, backend by backend, on the files generated for the workspace fixture (WS-18: an
 * invoice with a total in the row's currency and a fee in dollars).
 *
 * The TypeScript side is run: the amount validator generated/validation.ts carries is evaluated against real Zod,
 * and the formatter the pages show an amount with is evaluated on strings a float cannot hold. The Go side is read:
 * the validation type, the row and public structs and the select list. What the three servers answer over HTTP is
 * the conformance run's part (the fixture's scenario, and the fuzz walk's wrong shapes).
 */
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ts from "typescript";
import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { applyIntent, initProject, listIntents, loadProject, type Backend } from "@osl/core";
import { drizzleNextBackend } from "@osl/backend-drizzle-next";
import { ginPgxBackend } from "@osl/backend-gin-pgx";
import { honoTrpcViteBackend } from "@osl/backend-hono-trpc-vite";

const FIXTURES = path.resolve(__dirname, "../../../fixtures");

async function filesOf(backend: Backend): Promise<Map<string, string>> {
  const root = await mkdtemp(path.join(tmpdir(), "osl-money-"));
  await initProject(root, { name: "workspace", backend: backend.name });
  await cp(path.join(FIXTURES, "workspace", "intents"), path.join(root, ".osl/intents"), { recursive: true });
  for (const id of await listIntents(root)) await applyIntent(root, id);
  const project = await loadProject(root);
  await rm(root, { recursive: true, force: true });
  const files = backend.generate({ ir: project.ir, revisions: project.lock.revisions, config: project.config });
  return new Map(files.map(f => [f.path, f.content]));
}

/** The source between two markers of a generated file, as JavaScript, run with `scope` in reach; answers `names` */
function evaluate(source: string, from: string, to: string, scope: Record<string, unknown>, names: string[]) {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start);
  expect(start, from).toBeGreaterThanOrEqual(0);
  expect(end, to).toBeGreaterThan(start);
  const js = ts.transpileModule(source.slice(start, end).replace(/^export /gm, ""), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
  }).outputText;
  return new Function(...Object.keys(scope), `${js}\nreturn { ${names.join(", ")} };`)(...Object.values(scope));
}

describe.each([
  { name: "drizzle-next", backend: drizzleNextBackend },
  { name: "hono-trpc-vite", backend: honoTrpcViteBackend }
])("money on $name", ({ backend }) => {
  const pages = "generated/app";
  let files: Map<string, string>;
  const file = (suffix: string) => {
    const found = [...files.entries()].find(([name]) => name.endsWith(suffix));
    expect(found, suffix).toBeDefined();
    return found![1];
  };
  beforeAll(async () => {
    files = await filesOf(backend as Backend);
  });

  it("is numeric(19, 4) in the schema and a string in every shape the server types", () => {
    const schema = file("db/schema.ts");
    expect(schema).toContain("total: numeric({ precision: 19, scale: 4 }).notNull()");
    expect(schema).toContain("fee: numeric({ precision: 19, scale: 4 })");
    // The presenter hands the driver's string on as it is
    expect(file("present.ts")).toMatch(/total: row\.total/);
    const validation = file("validation.ts");
    expect(validation).toContain(`total: money("0")`);
    expect(validation).toContain("fee: money().nullish()");
    expect(validation).toContain("total: money().optional()");
    // No path from a body or a query string to a number
    const invoices = [...validation.matchAll(/export const invoices\w+ = z[\s\S]*?\.strict\(\);/g)].join("\n");
    expect(invoices).not.toMatch(/total: z\.(coerce\.)?number|fee: z\.(coerce\.)?number/);
  });

  it("validates an amount as a decimal string: no number, no fifth fraction digit, bounds digit by digit", () => {
    const { money } = evaluate(file("validation.ts"), "const MONEY = ", "export const ", { z }, ["money"]) as {
      money: (min?: string, max?: string) => z.ZodTypeAny;
    };
    const accepts = (schema: z.ZodTypeAny, value: unknown) => schema.safeParse(value).success;
    for (const ok of ["0", "0.3", "19.99", "-5", "999999999999999.9999", "0.0001"])
      expect(accepts(money(), ok), ok).toBe(true);
    // What is accepted is the string that was sent, untouched
    expect(money().parse("0.3")).toBe("0.3");
    expect(money().parse("999999999999999.9999")).toBe("999999999999999.9999");
    for (const bad of [0.3, 12, "1.23456", "1234567890123456", "twelve", "1e3", "1,234.50", "$12.30", ".5", "", null])
      expect(accepts(money(), bad), String(bad)).toBe(false);
    // A bound is not asked of a value that has no shape (it would throw), and is exact where a float is not
    expect(accepts(money("0"), "twelve")).toBe(false);
    expect(accepts(money("0"), "-0.0001")).toBe(false);
    expect(accepts(money("0"), "0")).toBe(true);
    expect(accepts(money(undefined, "9999.99"), "9999.9901")).toBe(false);
    expect(accepts(money(undefined, "9999.99"), "9999.99")).toBe(true);
    expect(Number("123456789012345.6789") === Number("123456789012345.6788")).toBe(true);
    expect(accepts(money(undefined, "123456789012345.6788"), "123456789012345.6789")).toBe(false);
    expect(accepts(money("123456789012345.6789"), "123456789012345.6788")).toBe(false);
  });

  it("shows an amount from its string: grouped, with its currency's digits, nothing rounded", () => {
    const ui = file(`${pages}/ui.tsx`);
    const { formatMoney } = evaluate(
      `${ui.slice(ui.indexOf("export function text"), ui.indexOf("export function yesNo"))}${ui.slice(ui.indexOf("/** Currencies whose minor unit"))}`,
      "function text",
      "export function formatDateTime",
      {},
      ["formatMoney"]
    ) as { formatMoney: (value: unknown, currency: unknown) => string };
    expect(formatMoney("19.9900", "USD")).toBe("19.99 USD");
    expect(formatMoney("0.3000", "EUR")).toBe("0.30 EUR");
    expect(formatMoney("1234567.5000", "USD")).toBe("1,234,567.50 USD");
    expect(formatMoney("500.0000", "JPY")).toBe("500 JPY");
    expect(formatMoney("0.1235", "BHD")).toBe("0.1235 BHD");
    expect(formatMoney("19.9950", "USD")).toBe("19.995 USD");
    expect(formatMoney("-0.0001", "USD")).toBe("-0.0001 USD");
    expect(formatMoney("999999999999999.9999", "JPY")).toBe("999,999,999,999,999.9999 JPY");
    expect(formatMoney(null, "USD")).toBe("");
    expect(formatMoney("5.0000", undefined)).toBe("5.00");
  });

  it("takes an amount in the forms as text, and shows a sequence without an input", () => {
    const page = file(`${pages}/pages/invoices.tsx`);
    expect(page).toContain(`<Input id="total" type="text" inputMode="decimal"`);
    expect(page).toContain(`{values.currency}`);
    expect(page).toContain(`<span className="text-sm text-muted-foreground">USD</span>`);
    expect(page).toContain("formatMoney(row.total, row.currency)");
    expect(page).toContain(`formatMoney(row.fee, "USD")`);
    expect(page).not.toMatch(/Number\(v\.(total|fee)\)/);
    expect(page).not.toMatch(/id="(total|fee)" type="number"/);
    // The number is on the page and in no form
    expect(page).toContain("row.number");
    expect(page).not.toContain(`id="number"`);
    expect(page).not.toMatch(/INVOICES_FIELDS = \[[^\]]*"number"/);
  });

  it("refuses a change of currency that leaves the amount out", () => {
    const resource = [...files.entries()].find(
      ([name]) => name.endsWith("resources/invoices.ts") || name.endsWith("routers/invoices.ts")
    )![1];
    expect(resource).toMatch(/\.data\.currency !== undefined && \w+\.data\.currency !== existing\.currency/);
    expect(resource).toMatch(/\.\.\.\(\w+\.data\.total === undefined \? \["total"\] : \[\]\)/);
  });
});

describe("money on gin-pgx", () => {
  let files: Map<string, string>;
  beforeAll(async () => {
    files = await filesOf(ginPgxBackend as Backend);
  });

  it("is a string from the body to the row and back, read as the text the database prints", () => {
    const models = files.get("generated/models/entities.go")!;
    const invoice = models.slice(models.indexOf("type Invoice struct"), models.indexOf("// ScanInvoice"));
    expect(invoice).toMatch(/Total\s+string\s/);
    expect(invoice).toMatch(/Fee\s+\*string\s/);
    expect(invoice).not.toContain("float");
    expect(invoice).not.toContain("pgtype.Numeric");
    expect(models).toMatch(/const InvoiceColumns = `[^`]*"total"::text, "fee"::text[^`]*`/);
    const resources = files.get("generated/validation/resources.go")!;
    expect(resources).toContain(`{Name: "total", Required: true, Type: Money{Min: "0"}}`);
    expect(resources).toContain(`{Name: "fee", Nullable: true, Type: Money{}}`);
    expect(resources).toContain(`{Name: "total", Type: Money{}}`);
  });

  it("validates an amount without a float: a JSON number does not unmarshal into it, bounds are big integers", () => {
    const types = files.get("generated/validation/types.go")!;
    const money = types
      .slice(types.indexOf("// Money validates an amount"), types.indexOf("// Boolean validates"))
      .split("\n")
      .filter(line => !line.trimStart().startsWith("//"))
      .join("\n");
    expect(money).toContain("var s string");
    expect(money).toContain("json.Unmarshal(raw, &s)");
    expect(money).toContain("moneyPattern.MatchString(value)");
    expect(money).toContain("new(big.Int).SetString(");
    expect(money).not.toMatch(/float|ParseFloat|number\(raw\)/);
    expect(types).toContain("var moneyPattern = regexp.MustCompile(`^-?\\d{1,15}(\\.\\d{1,4})?$`)");
  });

  it("refuses a change of currency that leaves the amount out", () => {
    const resource = files.get("generated/resources/invoices.go")!;
    expect(resource).toContain(`if next, ok := patch["currency"].(string); ok && next != existing.Currency {`);
    expect(resource).toContain(`if _, sent := patch["total"]; !sent {`);
  });
});
