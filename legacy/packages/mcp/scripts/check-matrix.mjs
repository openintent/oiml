#!/usr/bin/env node
// Verifies compatibility/matrix.json and the template packs in @osl/schema agree:
// every matrix version points at a pack with a matching manifest, and every pack is in the matrix.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const matrixPath = path.resolve(here, "../compatibility/matrix.json");
const schemaRoot = path.resolve(here, "../../schema");
const matrix = JSON.parse(fs.readFileSync(matrixPath, "utf8"));
const problems = [];
const listed = new Set();

for (const entry of matrix) {
  for (const version of entry.versions) {
    const where = `${entry.framework}${entry.capability ? ` (${entry.capability})` : ""}@${version.template_version}`;
    const dir = path.join(schemaRoot, version.template_path ?? "");
    listed.add(path.normalize(version.template_path ?? ""));

    if (!version.template_path) problems.push(`${where}: missing template_path`);
    else if (!fs.existsSync(path.join(dir, "AGENTS.md")))
      problems.push(`${where}: no AGENTS.md at ${version.template_path}`);
    else if (!fs.existsSync(path.join(dir, "manifest.json")))
      problems.push(`${where}: no manifest.json at ${version.template_path}`);
    else {
      const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
      if (manifest.name !== version.pack_name)
        problems.push(`${where}: pack_name ${version.pack_name} != manifest name ${manifest.name}`);
      if (manifest.version !== version.template_version)
        problems.push(`${where}: template_version != manifest version ${manifest.version}`);
      if (manifest.framework !== entry.framework)
        problems.push(`${where}: framework != manifest framework ${manifest.framework}`);
    }
    if (!version.compat?.osl) problems.push(`${where}: compat.osl is required`);
    if (!version.compat?.[entry.framework]) problems.push(`${where}: compat["${entry.framework}"] is required`);

    const parts = path.normalize(version.template_path ?? "").split(path.sep);
    if (entry.category === "capability" && (parts[1] !== "capability" || parts[2] !== entry.capability)) {
      problems.push(`${where}: capability packs must live in templates/capability/${entry.capability}/`);
    }
    if (entry.category !== "capability" && parts[1] !== entry.category) {
      problems.push(`${where}: category ${entry.category} does not match ${version.template_path}`);
    }
  }
}

const walk = dir =>
  fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap(e => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
for (const manifest of walk(path.join(schemaRoot, "templates")).filter(f => path.basename(f) === "manifest.json")) {
  const rel = path.relative(schemaRoot, path.dirname(manifest));
  if (!listed.has(rel)) problems.push(`${rel}: pack exists but is not in compatibility/matrix.json`);
}

if (problems.length > 0) {
  console.error(`✗ Compatibility matrix check failed:\n  - ${problems.join("\n  - ")}`);
  process.exit(1);
}
console.log(`✓ Compatibility matrix matches ${listed.size} template packs`);
