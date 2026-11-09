#!/usr/bin/env node
/** pnpm conformance [fixture ...] [--backend <name>] [--package-manager pnpm|bun|npm] [--update] [--snapshot-only] [--keep] [--walks [rule,tenant,leak,fuzz,contract]] [--no-walks] [--seed <n>] */
import path from "node:path";
import { formatResult, listFixtures, runFixture } from "./index.js";

const args = process.argv.slice(2);
const valueOf = (flag: string) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};
const onlyBackend = valueOf("--backend");
const packageManager = valueOf("--package-manager");
const seed = valueOf("--seed");
// --walks may name the walks to run (a comma list) or stand alone for all of them
const walksValue = valueOf("--walks");
const walkSet = walksValue && !walksValue.startsWith("--") ? walksValue.split(",") : undefined;
const valueFlags = ["--backend", "--package-manager", "--seed", ...(walkSet ? ["--walks"] : [])];
const valueIndexes = new Set(valueFlags.map(flag => args.indexOf(flag) + 1).filter(i => i > 0));
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
      walks: !flags.has("--no-walks"),
      walksOnly: flags.has("--walks"),
      walkSet: walkSet as never,
      seed: seed ? Number(seed) : undefined,
      log: line => console.log(line)
    });
    console.log(formatResult(result));
    if (!result.ok) failed++;
  }
}
console.log(`\n${total - failed}/${total} fixture runs passed`);
process.exit(failed ? 1 : 0);
