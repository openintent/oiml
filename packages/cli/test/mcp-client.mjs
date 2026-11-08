import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const [cli, cwd] = process.argv.slice(2);
const transport = new StdioClientTransport({ command: "node", args: [cli, "mcp"], cwd, stderr: "pipe" });
const client = new Client({ name: "test", version: "0" });
await client.connect(transport);
const tools = (await client.listTools()).tools.map(t => t.name);
console.log("tools:", tools.join(", "));
const status = await client.callTool({ name: "osl_status", arguments: {} });
console.log(
  "status:",
  JSON.parse(status.content[0].text).entities,
  JSON.parse(status.content[0].text).pending_migrations
);
const bad = await client.callTool({
  name: "osl_check_diff",
  arguments: {
    diff_yaml: 'osl: "1.0"\nops:\n  - op: add_field\n    entity: Nope\n    name: x\n    field: { type: string }\n'
  }
});
console.log("bad diff:", JSON.parse(bad.content[0].text));
const good = await client.callTool({
  name: "osl_check_diff",
  arguments: {
    diff_yaml: 'osl: "1.0"\nops:\n  - op: add_field\n    entity: Post\n    name: summary\n    field: { type: text }\n'
  }
});
console.log("good diff:", JSON.parse(good.content[0].text));
const ref = await client.callTool({ name: "osl_reference", arguments: {} });
console.log("reference starts:", ref.content[0].text.slice(0, 40).replace(/\n/g, " "));
await client.close();
