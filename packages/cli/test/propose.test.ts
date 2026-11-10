import { readFile } from "node:fs/promises";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { Model, applyDiff, fromYaml, parseDiff } from "@osl/core";
import { DEFAULT_MAX_TOKENS, ProposeCutOffError, propose, validateCandidate } from "../src/propose.js";

const FIXTURE = path.resolve(__dirname, "../../../fixtures/blog/intents");

async function modelAfter(...ids: string[]) {
  let model = Model.parse({ osl: "1.0", name: "blog", entities: {} });
  for (const id of ids) {
    const diff = parseDiff(fromYaml(await readFile(path.join(FIXTURE, id, "diff.yaml"), "utf8")));
    model = applyDiff(model, diff).model;
  }
  return model;
}

describe("propose validation", () => {
  it("rejects YAML that is not a diff, with the path", async () => {
    const model = await modelAfter("FEAT-1");
    expect(validateCandidate(model, "osl: '1.0'\nops: []\n").problems[0]).toMatch(/ops/);
    expect(validateCandidate(model, "ops: [\n").problems[0]).toMatch(/not valid YAML/);
    const unknownOp = validateCandidate(model, "osl: '1.0'\nops:\n  - op: add_table\n    name: X\n");
    expect(unknownOp.problems.join(" ")).toMatch(/op/);
  });

  it("rejects diffs that apply but produce an invalid model", async () => {
    const model = await modelAfter("FEAT-1");
    const result = validateCandidate(
      model,
      [
        "osl: '1.0'",
        "ops:",
        "  - op: add_entity",
        "    name: Comment",
        "    entity:",
        "      fields:",
        "        id: { type: uuid, primary: true }",
        "        post_id: { type: uuid, required: true, relation: { entity: Post } }",
        ""
      ].join("\n")
    );
    expect(result.diff).toBeDefined();
    expect(result.problems.join("\n")).toMatch(/relation target Post does not exist/);
  });

  it("rejects diffs that fail apply-time checks", async () => {
    const model = await modelAfter("FEAT-1");
    const result = validateCandidate(
      model,
      "osl: '1.0'\nops:\n  - op: add_resource\n    name: users\n    resource: { entity: User, operations: [list] }\n"
    );
    expect(result.problems[0]).toMatch(/already exists/);
  });

  it("accepts the fixture's own next diff", async () => {
    const model = await modelAfter("FEAT-1");
    const yaml = await readFile(path.join(FIXTURE, "FEAT-2", "diff.yaml"), "utf8");
    const result = validateCandidate(model, yaml);
    expect(result.problems).toEqual([]);
    expect(result.diff?.ops.length).toBe(6);
  });
});

/** One streamed answer as the API sends it: a text block in pieces, then the stop reason and the output tokens */
function answer(pieces: string[], stopReason: string, outputTokens: number): Response {
  const events = [
    {
      type: "message_start",
      message: {
        id: "msg_test",
        type: "message",
        role: "assistant",
        model: "claude-opus-5-5",
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 120, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
      }
    },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    ...pieces.map(text => ({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text } })),
    { type: "content_block_stop", index: 0 },
    {
      type: "message_delta",
      delta: { stop_reason: stopReason, stop_sequence: null },
      usage: { output_tokens: outputTokens }
    },
    { type: "message_stop" }
  ];
  const body = events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("");
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

/** A client whose requests are answered here, and the bodies it sent */
function fakeClient(respond: () => Response) {
  const sent: { max_tokens: number; stream?: boolean }[] = [];
  const client = new Anthropic({
    apiKey: "test",
    maxRetries: 0,
    fetch: async (_url, init) => {
      sent.push(JSON.parse(String(init?.body)));
      return respond();
    }
  });
  return { client, sent };
}

describe("propose", () => {
  const intent = { osl: "1.0" as const, title: "Posts", ask: "Users write posts." };

  it("streams the request and reads a complete answer", async () => {
    const model = await modelAfter("FEAT-1");
    const yaml = await readFile(path.join(FIXTURE, "FEAT-2", "diff.yaml"), "utf8");
    const text = JSON.stringify({ summary: "Posts", diff_yaml: yaml, not_delivered: ["live updates"] });
    const half = Math.floor(text.length / 2);
    const { client, sent } = fakeClient(() => answer([text.slice(0, half), text.slice(half)], "end_turn", 900));
    const result = await propose("FEAT-2", intent, model, { client });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ max_tokens: DEFAULT_MAX_TOKENS, stream: true });
    expect(result.diff.ops.length).toBeGreaterThan(0);
    expect(result.notDelivered).toEqual(["live updates"]);
    expect(result).toMatchObject({ attempts: 1, usage: { input_tokens: 120, output_tokens: 900 } });
  });

  it("reports an answer cut off inside a string as a cut-off, once, with the tokens it spent", async () => {
    const model = await modelAfter("FEAT-1");
    const { client, sent } = fakeClient(() =>
      answer(['{"summary":"Posts","diff_yaml":"osl: \\"1.0'], "max_tokens", 20000)
    );
    const error = await propose("FEAT-2", intent, model, { client, maxTokens: 20000 }).catch(e => e);
    expect(error).toBeInstanceOf(ProposeCutOffError);
    expect(error.message).toMatch(/cut off at max_tokens \(20000\)/);
    expect(error).toMatchObject({ maxTokens: 20000, attempts: 1, usage: { input_tokens: 120, output_tokens: 20000 } });
    expect(sent).toHaveLength(1);
    expect(sent[0].max_tokens).toBe(20000);
  });
});
