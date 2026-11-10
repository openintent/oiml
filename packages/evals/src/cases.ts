/**
 * Eval cases: an intent, the model it starts from, and what a correct diff must contain.
 *
 * Names in expectations may offer alternatives separated by `|` ("Comment|PostComment"), since an
 * intent that does not name things leaves the agent free to pick. A check passes when any alternative does.
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { fromYaml } from "@osl/core";

const Names = z.array(z.string().min(1));

/** The model a case starts from: a fixture's intents applied through one of them, or an empty model */
export const Base = z.union([
  z
    .object({
      fixture: z.string().min(1),
      /** The last intent to apply; default: every intent of the fixture */
      through: z.string().min(1).optional()
    })
    .strict(),
  z.object({ empty: z.string().regex(/^[a-z][a-z0-9-]*$/) }).strict()
]);
export type Base = z.infer<typeof Base>;

export const ListExpect = z
  .object({
    filters: Names.optional(),
    sortable: Names.optional(),
    search: Names.optional(),
    include: Names.optional(),
    page_size: z.number().int().optional()
  })
  .strict();

export const ActionExpect = z
  .object({
    rule: z.string().optional(),
    scope: z.enum(["row", "collection", "global"]).optional(),
    returns: z.enum(["entity", "none", "fields"]).optional(),
    /** Input field names the action must accept */
    input: Names.optional()
  })
  .strict();

export const PageExpect = z
  .object({
    kind: z.enum(["resource", "dashboard", "custom"]).optional(),
    layout: z.enum(["split", "table", "board"]).optional(),
    group_by: z.string().optional(),
    resource: z.string().optional(),
    tiles_min: z.number().int().optional(),
    /** Who may open the page, with alternatives ("public", "role:admin|role:staff") */
    access: z.string().optional(),
    path: z.string().optional(),
    /** Filter keys the page must carry, with alternatives */
    filter: Names.optional(),
    refresh: z.boolean().optional()
  })
  .strict();

export const Expect = z
  .object({
    /** ok: a valid diff is required. invalid: no valid diff exists. declined: the agent should say nothing is expressible. any: whatever happens. */
    outcome: z.enum(["ok", "invalid", "declined", "any"]).default("ok"),
    /** The ask has a part the model cannot express: a valid diff must list it in not_delivered (or the agent declines) */
    flags_limit: z.boolean().optional(),
    entities: Names.optional(),
    absent_entities: Names.optional(),
    /** entity -> fields that must exist */
    fields: z.record(z.string(), Names).optional(),
    absent_fields: z.record(z.string(), Names).optional(),
    /** "Entity.field" -> type alternatives ("enum|string") */
    types: z.record(z.string(), z.string()).optional(),
    /** "Entity.field" -> field properties that must match exactly (max_length, required, default, unique, enum_values...) */
    field_props: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
    /** "Entity.field -> Target[:on_delete]"; field may be "*" for any relation field of the entity */
    relations: Names.optional(),
    /** entity -> fields that must share a unique constraint (entity unique list or a unique index) */
    unique_together: z.record(z.string(), Names).optional(),
    /** Pairs of entities joined by a junction entity: two relation fields that are the primary key or a unique pair */
    junction: z.array(z.tuple([z.string(), z.string()])).optional(),
    /** "Entity.relation -> Target": a relation through a junction to the far entity; relation may be "*" for any name */
    through: Names.optional(),
    /** entity -> the relation field its rows are ordered within (a position field); "*" for any parent */
    ordered: z.record(z.string(), z.string()).optional(),
    /** Entities that archive (`archive:` on the entity), not ones with a hand-written flag and action */
    archive: Names.optional(),
    /** "Entity.field -> Counted": a count_of field on Entity over rows of Counted; field may be "*" for any name */
    counts: Names.optional(),
    /**
     * entity -> transitions it must declare (`transitions:` on the entity, not actions with handlers), each with
     * alternatives; "from -> to" asks for a transition that takes a row from the one state to the other under any
     * name; [] asks only for the block
     */
    transitions: z.record(z.string(), Names).optional(),
    /** entity -> operation -> rule alternatives, compared after defaults are applied */
    rules: z.record(z.string(), z.record(z.string(), z.string())).optional(),
    resources: Names.optional(),
    absent_resources: Names.optional(),
    /** resource -> operations that must be offered */
    operations: z.record(z.string(), Names).optional(),
    absent_operations: z.record(z.string(), Names).optional(),
    /** resource -> list options that must be present (subset) */
    list: z.record(z.string(), ListExpect).optional(),
    /** "resource.action" or "actions.name", with alternatives */
    actions: Names.optional(),
    /** resource (or "actions" for global ones) -> an action with these properties must exist */
    actions_on: z.record(z.string(), ActionExpect).optional(),
    auth: z
      .object({
        none: z.boolean().optional(),
        identity: z.string().optional(),
        /** Provider kinds or "oauth:<provider>" that must be configured */
        providers: Names.optional(),
        absent_providers: Names.optional(),
        tenancy: z
          .object({
            entity: z.string().optional(),
            membership: z.string().optional(),
            /** "database" when the ask wants the tenant backstop in the database, "none" when it must stay off */
            isolation: z.enum(["none", "database"]).optional()
          })
          .strict()
          .optional()
      })
      .strict()
      .optional(),
    /** "Entity.created", "Entity.updated:queue", "resource.action", "actions.name" */
    events: Names.optional(),
    absent_events: Names.optional(),
    /** page name alternatives -> properties */
    pages: z.record(z.string(), PageExpect).optional(),
    /** Page names that must be linked from the sidebar */
    sidebar: Names.optional(),
    files: z.object({ read: z.string().optional(), upload: z.string().optional() }).strict().optional(),
    /** "Entity.field" -> a substring every accept entry of the file field must contain, e.g. "image/" */
    file_accept: z.record(z.string(), z.string()).optional(),
    seed_min: z.number().int().optional(),
    scenarios: z
      .object({
        min: z.number().int().default(1),
        /** Steps expecting a 4xx status */
        rejections: z.number().int().default(0),
        /** Statuses that some step must expect */
        statuses: z.array(z.number().int()).optional()
      })
      .strict()
      .optional(),
    /** Resources, "resource.op" or "actions.name" that the new scenarios must call */
    touches: Names.optional(),
    /** Actions that must be scheduled, in the step spelling with alternatives ("actions.send_digest|actions.digest") */
    schedules: Names.optional(),
    /** Timers that must exist: "Entity.field" or "Entity.field -> resource.action", with alternatives in each part */
    timers: Names.optional(),
    /** Some actor must set every one of these fields to the value (with alternatives), e.g. { role: admin } for an admin actor */
    actor_fields: z.record(z.string(), z.string()).optional(),
    ops: z
      .object({
        max: z.number().int().optional(),
        require: Names.optional(),
        forbid: Names.optional()
      })
      .strict()
      .optional(),
    /** Alternative designs: at least one of these expectation sets must pass in full */
    any_of: z.array(z.record(z.string(), z.unknown())).optional()
  })
  .strict();
export type Expect = z.infer<typeof Expect>;

export const CaseIntent = z
  .object({
    title: z.string().min(1),
    ask: z.string().min(1),
    acceptance: z.array(z.string()).optional()
  })
  .strict();

export const Case = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    /** Free-form labels for slicing the report: entity, rules, actions, files, auth, tenancy, app, gap, trap... */
    tags: z.array(z.string()).default([]),
    base: Base,
    intent: CaseIntent,
    expect: Expect.default({}),
    /** Run the generated app on a backend and its scenarios (default true) */
    full: z.boolean().default(true),
    /** A known-good diff for this intent, relative to the repo root; `--proposer oracle` uses it instead of Claude */
    oracle: z.string().optional(),
    /** Why the case exists, for readers of the corpus */
    notes: z.string().optional()
  })
  .strict();
export type Case = z.infer<typeof Case>;

export async function loadCases(dir: string): Promise<Case[]> {
  const files = (await readdir(dir)).filter(f => f.endsWith(".yaml") || f.endsWith(".yml")).sort();
  const cases: Case[] = [];
  for (const file of files) {
    const raw = fromYaml(await readFile(path.join(dir, file), "utf8"));
    const parsed = Case.safeParse(raw);
    if (!parsed.success)
      throw new Error(
        `${file}: ${parsed.error.issues.map(i => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`
      );
    if (parsed.data.id !== path.basename(file).replace(/\.ya?ml$/, ""))
      throw new Error(`${file}: id ${parsed.data.id} must match the file name`);
    cases.push(parsed.data);
  }
  return cases;
}
