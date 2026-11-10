import { describe, expect, it } from "vitest";
import { Model, compile } from "@osl/core";
import type { HarnessClient } from "../src/client.js";
import { FieldWatch } from "../src/fields.js";
import type { Resolver, Row } from "../src/rules.js";

/** Products with a cost managers read, and owners whose phone is theirs and a manager's */
const ir = compile(
  Model.parse({
    osl: "1.0",
    name: "shop",
    entities: {
      User: {
        fields: {
          id: { type: "uuid", primary: true },
          email: { type: "string", required: true, unique: true },
          role: { type: "enum", enum_values: ["staff", "manager"], required: true, default: "staff", read_only: true },
          phone: { type: "string", read: "owner:id or role:manager" }
        },
        rules: { read: "public", update: "owner:id", delete: "none" }
      },
      Product: {
        fields: {
          id: { type: "uuid", primary: true },
          owner_id: { type: "uuid", required: true, relation: { entity: "User", on_delete: "cascade" } },
          name: { type: "string", required: true },
          listed: { type: "boolean", required: true, default: false },
          cost: { type: "integer", read: "role:manager or public when listed = true" }
        },
        rules: { read: "public", create: "role:manager", update: "role:manager", delete: "role:manager" }
      }
    },
    resources: {
      users: { entity: "User", operations: ["list", "get"] },
      products: {
        entity: "Product",
        operations: ["list", "get", "create", "update"],
        list: { include: ["owner"] }
      }
    },
    auth: { identity: "User", provider: "credentials" }
  })
);

const USERS: Record<string, Row> = {
  s1: { id: "s1", email: "sam@example.com", role: "staff", phone: "1" },
  m1: { id: "m1", email: "mia@example.com", role: "manager", phone: "2" }
};
const PRODUCTS: Record<string, Row> = {
  p1: { id: "p1", owner_id: "m1", name: "Lamp", listed: false, cost: 7 },
  p2: { id: "p2", owner_id: "m1", name: "Desk", listed: true, cost: 90 }
};

/** A resolver over two tables in memory */
const resolver = {
  fresh: async (entity: { name: string }, id: unknown) =>
    (entity.name === "User" ? USERS : PRODUCTS)[String(id)] ?? null,
  memberships: async () => []
} as unknown as Resolver;

const client = () => ({}) as HarnessClient;

async function signedIn(watch: FieldWatch, id: string): Promise<HarnessClient> {
  const c = client();
  await watch.observe("auth.login", { status: 200, body: { data: { id, phone: USERS[id].phone } } }, c);
  return c;
}

describe("the leak walk's field rules", () => {
  it("wants a field in a row exactly when its rule allows the caller on that row", async () => {
    const watch = new FieldWatch(ir, resolver, 40);
    expect(watch.active).toBe(true);
    const staff = await signedIn(watch, "s1");
    const manager = await signedIn(watch, "m1");
    // The unlisted product: its cost is the manager's; the listed one shows it to everyone
    await watch.observe("products.get", { status: 200, body: { data: { id: "p1", name: "Lamp" } } }, staff);
    await watch.observe("products.get", { status: 200, body: { data: { id: "p1", name: "Lamp", cost: 7 } } }, manager);
    await watch.observe(
      "products.get",
      { status: 200, body: { data: { id: "p2", name: "Desk", cost: 90 } } },
      client()
    );
    expect(watch.findings).toEqual([]);
    // Both sign-ins answered the caller's own phone, which their own session reads
    expect([watch.present, watch.absent]).toEqual([4, 1]);
  });

  it("names a field that came back to a caller the rule refuses, and one withheld from a caller it allows", async () => {
    const watch = new FieldWatch(ir, resolver, 40);
    const staff = await signedIn(watch, "s1");
    const manager = await signedIn(watch, "m1");
    await watch.observe("products.update", { status: 200, body: { data: { id: "p1", name: "Lamp", cost: 7 } } }, staff);
    await watch.observe("products.get", { status: 200, body: { data: { id: "p1", name: "Lamp" } } }, manager);
    expect(watch.findings).toEqual([
      'products.update as sam@example.com: data.cost is in the response, and Product.cost is read by "role:manager or public when listed = true", which refuses this caller on this row',
      'products.get as mia@example.com: data.cost is missing, and Product.cost is read by "role:manager or public when listed = true", which allows this caller on this row'
    ]);
  });

  it("holds the rows of a list and the rows under them, and knows nobody is signed in after a logout", async () => {
    const watch = new FieldWatch(ir, resolver, 40);
    const staff = await signedIn(watch, "s1");
    const list = {
      status: 200,
      body: {
        data: [
          { id: "p1", name: "Lamp", owner: { id: "m1", email: "mia@example.com", role: "manager", phone: "2" } },
          { id: "p2", name: "Desk", cost: 90, owner: { id: "m1", email: "mia@example.com", role: "manager" } }
        ]
      }
    };
    await watch.observe("products.list", list, staff);
    expect(watch.findings).toEqual([
      'products.list as sam@example.com: data.owner.phone is in the response, and User.phone is read by "owner:id or role:manager", which refuses this caller on this row'
    ]);
    await watch.observe("auth.logout", { status: 204, body: null }, staff);
    await watch.observe("users.get", { status: 200, body: { data: { id: "s1", phone: "1" } } }, staff);
    expect(watch.findings[1]).toContain("users.get as anonymous: data.phone is in the response");
    // A refusal carries no row, and a row that is gone is counted, not judged
    await watch.observe("products.get", { status: 403, body: { error: { code: "forbidden" } } }, staff);
    await watch.observe("products.get", { status: 200, body: { data: { id: "gone", cost: 1 } } }, staff);
    expect(watch.findings).toHaveLength(2);
    expect(watch.gone).toBe(1);
  });

  it("compares what a session is told of its fields with what the rules say before any row", () => {
    const watch = new FieldWatch(ir, resolver, 40);
    const staff = { id: "s1", user: USERS.s1, memberships: [] };
    watch.compareFields("sam", staff, { users: { phone: true }, products: { cost: true } });
    watch.compareFields("mia", { id: "m1", user: USERS.m1, memberships: [] }, { users: { phone: true } });
    expect(watch.findings).toEqual([
      'fields as mia: products.cost is undefined, and "role:manager or public when listed = true" says true of this session'
    ]);
    expect(watch.summary()).toContain("the fields answer of 2 sessions compared");
  });

  it("has nothing to watch in a model without a field rule", () => {
    const plain = compile(
      Model.parse({
        osl: "1.0",
        name: "plain",
        entities: { Note: { fields: { id: { type: "uuid", primary: true }, body: { type: "text" } } } },
        resources: { notes: { entity: "Note", operations: ["list", "get"] } }
      })
    );
    const watch = new FieldWatch(plain, resolver, 40);
    expect(watch.active).toBe(false);
    expect(watch.summary()).toBe("");
  });
});
