#!/usr/bin/env node
/** pnpm conformance [fixture ...] [--backend <name>] [--package-manager pnpm|bun|npm] [--update] [--snapshot-only] [--keep] */
import path from "node:path";
import { formatResult, listFixtures, runFixture } from "./index.js";

const args = process.argv.slice(2);
const valueOf = (flag: string) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};
const onlyBackend = valueOf("--backend");
const packageManager = valueOf("--package-manager");
const valueIndexes = new Set(["--backend", "--package-manager"].map(flag => args.indexOf(flag) + 1).filter(i => i > 0));
const positional = args.filter((a, i) => !a.startsWith("--") && !valueIndexes.has(i));
const flags = new Set(args.filter(a => a.startsWith("--")));
const names = positional;
const root = path.resolve(process.env.OSL_FIXTURES ?? path.join(process.cwd(), "fixtures"));

const fixtures = (await listFixtures(root)).filter(f => names.length === 0 || names.includes(f.name));
if (fixtures.length === 0) {
  console.error(`no fixtures found in ${root}`);
  process.exit(1);
}

let failed = 0;
let total = 0;
for (const fixture of fixtures) {
  for (const backend of fixture.backends.filter(b => !onlyBackend || b === onlyBackend)) {
    total++;
    console.log(`\n${fixture.name} (${backend})`);
    const result = await runFixture(fixture, backend, {
      update: flags.has("--update"),
      snapshotOnly: flags.has("--snapshot-only"),
      keep: flags.has("--keep"),
      packageManager,
      log: line => console.log(line)
    });
    console.log(formatResult(result));
    if (!result.ok) failed++;
  }
}
console.log(`\n${total - failed}/${total} fixture runs passed`);
process.exit(failed ? 1 : 0);
