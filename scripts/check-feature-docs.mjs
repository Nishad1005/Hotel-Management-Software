#!/usr/bin/env node
/**
 * Fails when a new feature arrives without an entry in docs/HOW_IT_WORKS.md.
 *
 * ## Why it only looks at ADDED files
 *
 * A doc rule enforced on every edit becomes noise, and a noisy check gets bypassed — at
 * which point it protects nothing and costs a CI minute per push. So the discriminator is
 * a file being ADDED under `supabase/migrations/` or `apps/mobile/app/`, which is almost
 * always a new table, a new gate or a new screen. Editing an existing file is more often
 * a fix, and fixes do not need a map entry.
 *
 * ## What this deliberately cannot catch
 *
 * An entry going stale while its file is merely edited. Renaming a feature. A gap closing
 * so the "deliberately not built" list is now wrong. None of those add a file, and no
 * script is going to read prose and tell you it stopped being true.
 *
 * That is the point worth being honest about: this is a floor, not the standard. The
 * standard is in CLAUDE.md and it is a person's job. A green check here means nobody added
 * a screen and forgot — it does not mean the document is accurate.
 *
 * usage: node scripts/check-feature-docs.mjs [base-ref]
 */
import { execFileSync } from "node:child_process";

const DOC = "docs/HOW_IT_WORKS.md";
const WATCHED = [/^supabase\/migrations\/.+\.sql$/, /^apps\/mobile\/app\/.+\.tsx$/];

const base = process.argv[2] ?? "origin/main";

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

let range;
try {
  // The merge base, so a branch is compared against where it diverged rather than
  // against whatever main has moved on to — otherwise somebody else's new migration
  // would be blamed on this branch.
  range = `${git(["merge-base", base, "HEAD"])}...HEAD`;
} catch {
  /*
    Could not resolve the base ref.

    Locally that means a clone without `origin/main`, which is not worth failing over. In
    CI it means the checkout is shallow and this check would otherwise pass every time
    without looking at anything — which is worse than not having it, because the green
    tick would be read as "the doc is current". So it is fatal there, and the fix is
    `fetch-depth: 0` on the checkout.
  */
  if (process.env["CI"]) {
    console.error(`Could not resolve ${base}. The checkout is probably shallow —`);
    console.error("the workflow needs `fetch-depth: 0` for this check to see anything.");
    process.exit(2);
  }
  console.log(`Could not resolve ${base} locally; skipping the feature-doc check.`);
  process.exit(0);
}

const changed = git(["diff", "--name-status", range])
  .split("\n")
  .filter(Boolean)
  .map((line) => {
    const [status, ...rest] = line.split("\t");
    return { status: status ?? "", path: rest[rest.length - 1] ?? "" };
  });

if (changed.length === 0) {
  console.log("No changes to check.");
  process.exit(0);
}

const added = changed
  .filter((c) => c.status.startsWith("A"))
  .filter((c) => WATCHED.some((re) => re.test(c.path)))
  .map((c) => c.path);

const docTouched = changed.some((c) => c.path === DOC);

if (added.length === 0) {
  console.log("No new migrations or screens; nothing for the feature-doc check to ask about.");
  process.exit(0);
}

if (docTouched) {
  console.log(`${added.length} new file(s), and ${DOC} was updated. Good.`);
  process.exit(0);
}

console.error("");
console.error(`  These arrived without an entry in ${DOC}:`);
console.error("");
for (const path of added) console.error(`    ${path}`);
console.error("");
console.error("  A new migration or screen is a new feature, and the map has to say what it");
console.error("  is for. Record the rule it enforces and what it deliberately does not do —");
console.error("  not how it works, which the code already says and says accurately.");
console.error("");
console.error("  If this genuinely is not a feature, add the note to the doc anyway saying");
console.error("  so; a reader wondering why a table exists is the cost of skipping it.");
console.error("");
process.exit(1);
