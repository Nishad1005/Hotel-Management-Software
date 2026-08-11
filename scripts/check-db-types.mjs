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

/**
 * Returns the body of the `{ ... }` that begins at or after `from`, by counting
 * braces.
 *
 * The first version of this matched on indentation and picked the wrong block: the
 * generator emits `graphql_public` before `public`, and graphql_public's Tables is
 * `{ [_ in never]: never }` — empty. Searching for the first "Tables:" therefore found
 * an empty one and reported that the schema had no tables at all. Brace matching does
 * not care about ordering or indentation.
 */
function blockAfter(source, from) {
  const open = source.indexOf("{", from);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return null;
}

function publicTableNames(source, label) {
  // Anchor on the public schema specifically, not on whichever schema appears first.
  const schemaAt = source.search(/\bpublic\s*:\s*\{/);
  if (schemaAt === -1) {
    console.error(`::error::No 'public' schema block found in ${label}.`);
    console.error(`::error::First 400 characters were: ${source.slice(0, 400).replace(/\n/g, " ")}`);
    process.exit(2);
  }

  const schemaBody = blockAfter(source, schemaAt);
  if (schemaBody === null) {
    console.error(`::error::Unbalanced braces in the public schema block of ${label}.`);
    process.exit(2);
  }

  const tablesAt = schemaBody.search(/\bTables\s*:\s*\{/);
  if (tablesAt === -1) {
    console.error(`::error::No Tables block inside the public schema of ${label}.`);
    process.exit(2);
  }

  const tablesBody = blockAfter(schemaBody, tablesAt);
  if (tablesBody === null) {
    console.error(`::error::Unbalanced braces in the Tables block of ${label}.`);
    process.exit(2);
  }

  // Table entries are the keys at depth 0 of the Tables block.
  const names = new Set();
  let depth = 0;
  for (const line of tablesBody.split("\n")) {
    if (depth === 0) {
      const match = line.match(/^\s*([a-z_][a-z0-9_]*)\s*:\s*\{/i);
      if (match?.[1]) names.add(match[1]);
    }
    for (const ch of line) {
      if (ch === "{") depth += 1;
      else if (ch === "}") depth -= 1;
    }
  }
  return names;
}

const generated = publicTableNames(readFileSync(generatedPath, "utf8"), "generated types");
const committed = publicTableNames(readFileSync(committedPath, "utf8"), "committed types");

if (generated.size === 0) {
  console.error("::error::The public schema reports no tables. The generator likely failed.");
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
      `exist in the database. Remove it, or its migration is missing.`,
  );
}

if (missing.length || extra.length) {
  console.error(
    `::error::Database types are out of step: ${missing.length} missing, ${extra.length} extra.`,
  );
  process.exit(1);
}

console.log(`Database types cover all ${generated.size} tables: ${[...generated].sort().join(", ")}`);
