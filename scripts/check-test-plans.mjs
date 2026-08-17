import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Every pgTAP file must plan the number of assertions it actually contains.
 *
 * pgTAP treats a mismatch as a failure, and rightly: the plan is what catches a test
 * that silently did not run. But the feedback loop is expensive — the count is only
 * checked inside a Postgres container, so a hand-counting slip costs a full CI round
 * on a job that spins up a database. It cost one.
 *
 * This is the same check, a second earlier and without Docker.
 *
 * It is deliberately a plain regex rather than anything clever. The alternative is
 * parsing SQL, and a checker that needs maintaining is a checker that gets disabled.
 * If a file ever legitimately confuses it, the fix is to make the file more ordinary.
 */

const TESTS = join(process.cwd(), "supabase", "tests");

/** pgTAP assertion functions used in this suite. Extend as new ones get used. */
const ASSERTIONS = [
  "ok",
  "is",
  "isnt",
  "is_empty",
  "isnt_empty",
  "lives_ok",
  "throws_ok",
  // Pattern-matching variants. Their absence here counted a real assertion as absent
  // and blocked a correct file, which is the failure mode that gets a checker disabled.
  "throws_like",
  "throws_matching",
  "lives_like",
  "matches",
  "imatches",
  "results_eq",
  "set_eq",
  "bag_eq",
  "row_eq",
  "is_deeply",
  // Comparisons other than equality. `cmp_ok` was missing and undercounted a correct
  // file by one, which is the second time this list has caused exactly that — so its
  // near-neighbours are added at the same time rather than one per incident.
  "cmp_ok",
  "isa_ok",
  "has_table",
  "has_column",
  "has_function",
  "has_index",
  "col_is_pk",
];

const assertionPattern = new RegExp(`\\bselect\\s+(?:${ASSERTIONS.join("|")})\\s*\\(`, "gi");
const planPattern = /\bselect\s+plan\(\s*(\d+)\s*\)/i;

const files = readdirSync(TESTS)
  .filter((name) => name.endsWith(".test.sql"))
  .sort();

if (files.length === 0) {
  console.error(`No pgTAP files found in ${TESTS}. That is almost certainly wrong.`);
  process.exit(1);
}

const problems = [];

for (const name of files) {
  const sql = readFileSync(join(TESTS, name), "utf8");

  const planned = planPattern.exec(sql);
  if (!planned) {
    problems.push(`${name}: no select plan(n). Every file needs one, or nothing checks it ran.`);
    continue;
  }

  // Comment lines are stripped first, so an assertion quoted in a comment — and these
  // files explain themselves at length — is not counted as a real one.
  const code = sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");

  const counted = (code.match(assertionPattern) ?? []).length;
  const expected = Number(planned[1]);

  if (counted !== expected) {
    problems.push(`${name}: plans ${expected} assertions, contains ${counted}.`);
  }
}

if (problems.length > 0) {
  console.error("\n  pgTAP plan counts do not match:\n");
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error(
    "\n  pgTAP fails on a mismatch anyway. Fixing it here saves a database container.\n",
  );
  process.exit(1);
}

console.log(`pgTAP plans match assertions in all ${files.length} files.`);
