/**
 * Discover all available OIML schema versions
 * This script scans the packages/schema directory and generates
 * a list of available schema versions for bundling.
 */

const fs = require('fs');
const path = require('path');

const SCHEMA_BASE_PATH = path.resolve(__dirname, '../../../packages/schema/schemas/oiml.intent');

function discoverSchemaVersions() {
  const versions = [];
  
  if (!fs.existsSync(SCHEMA_BASE_PATH)) {
    console.warn(`Schema directory not found: ${SCHEMA_BASE_PATH}`);
    return versions;
  }
  
  const entries = fs.readdirSync(SCHEMA_BASE_PATH, { withFileTypes: true });
  
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const version = entry.name;
      const schemaPath = path.join(SCHEMA_BASE_PATH, version, 'schema.zod.js');
      
      if (fs.existsSync(schemaPath)) {
        versions.push(version);
      }
    }
  }
  
  return versions.sort();
}

const versions = discoverSchemaVersions();
console.log(JSON.stringify(versions, null, 2));

