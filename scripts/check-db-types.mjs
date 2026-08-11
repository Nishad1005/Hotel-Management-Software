#!/usr/bin/env node
/**
 * Checks that the hand-maintained database types cover every table in the schema.
 *
 * The original intent (ADR 0013) was a byte-exact diff against `supabase gen types`.
 * That cannot work while packages/db/src/types.ts is hand-written: it will never match
 * the generator's formatting, so the check would be permanently red and would get
 * disabled — which is worse than not having it.
 *
 * This checks the thing that actually goes wrong instead: a migration adds a table and
 * the types forget it. Comparing the SET of tables catches that, survives a
 * hand-written file, and can fail honestly.
 *
 * Usage: node scripts/check-db-types.mjs <generated.ts> <committed.ts>
 */

import { readFileSync } from "node:fs";

const [, , generatedPath, committedPath] = process.argv;

if (!generatedPath || !committedPath) {
  console.error("usage: check-db-types.mjs <generated.ts> <committed.ts>");
  process.exit(2);
}

/** Pull the table names out of the `Tables: { ... }` block of a Database type. */
function tableNames(source, label) {
  const start = source.indexOf("Tables:");
  if (start === -1) {
    console.error(`::error::Could not find a Tables block in ${label}. Parser needs updating.`);
    process.exit(2);
  }
  // The Tables block ends where the next sibling key begins.
  const rest = source.slice(start);
  const endMarker = rest.search(/\n\s{4,6}(Views|Functions|Enums|CompositeTypes)\s*:/);
  const block = endMarker === -1 ? rest : rest.slice(0, endMarker);

  const names = new Set();
  for (const match of block.matchAll(/^\s+([a-z_][a-z0-9_]*)\s*:\s*\{/gim)) {
    const name = match[1];
    if (["Row", "Insert", "Update", "Relationships", "Tables"].includes(name)) continue;
    names.add(name);
  }
  return names;
}

const generated = tableNames(readFileSync(generatedPath, "utf8"), "generated types");
const committed = tableNames(readFileSync(committedPath, "utf8"), "committed types");

if (generated.size === 0) {
  console.error("::error::No tables found in the generated types. The generator likely failed.");
  process.exit(2);
}

const missing = [...generated].filter((t) => !committed.has(t)).sort();
const extra = [...committed].filter((t) => !generated.has(t)).sort();

for (const table of missing) {
  console.error(
    `::error::Table '${table}' exists in the database but is absent from ` +
      `packages/db/src/types.ts. Add it in the same commit as the migration.`,
  );
}

for (const table of extra) {
  console.error(
    `::error::Table '${table}' is declared in packages/db/src/types.ts but does not ` +
      `exist in the database. Remove it, or the migration that created it is missing.`,
  );
}

if (missing.length || extra.length) {
  console.error(`::error::Database types are out of step: ${missing.length} missing, ${extra.length} extra.`);
  process.exit(1);
}

console.log(`Database types cover all ${generated.size} tables.`);
