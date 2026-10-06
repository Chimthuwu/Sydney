// The 33 browser gates that are silently passing.
//
// THE PROBLEM THIS EXISTS TO FIX
// ------------------------------
// 33 files in tools/qa/ start with an `inPage(page, body)` helper and the usage line
//     node <browser-automation>/browser.mjs http://localhost:8899/ --script ...
// They are NOT standalone node scripts. Run one directly and it defines a function and
// exits 0 having asserted NOTHING:
//
//     node tools/qa/actone.mjs   ->  exit 0, zero output, 0.36s
//
// So a green exit code from any of them is a FALSE PASS, and any agent that trusts
// `exit 0` (including me, on 2026-10-03) reports work as verified when it was never
// run at all. The suite's 79 passes therefore mean "78 real gates + 1 aggregate".
//
// WHAT THIS GATE DOES
// -------------------
// It cannot make the browser gates run -- browser.mjs lives outside the repo -- but it
// CAN make their not-running visible, so the failure is loud instead of silent.
//
// Rules, each one earning its place:
//   1. Every such gate must import the shared inPage helper (or otherwise be runnable
//      only by a browser harness). A standalone script is fine and should be excluded,
//      so the exclusion is by CONTENT, not by a hardcoded list that rots.
//   2. None of them may call process.exit() unguarded at module scope -- that is what
//      makes the false pass look deliberate.
//   3. The count is printed, so if it changes, the change is visible in the log rather
//      than silently altering what "all green" means.

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const qaDir = here;

let fails = 0;
const check = (c, m) => { console.log(`  ${c ? "ok  " : "FAIL"} ${m}`); if (!c) fails++; };

const files = readdirSync(qaDir).filter((f) => f.endsWith(".mjs") && f !== "act_one_chain.mjs");

// Content-based detection: does this file need a browser harness to do anything?
const needsBrowser = (src) =>
  /\binPage\s*\(/.test(src) || /browser-automation/.test(src) || /--script/.test(src);

const browserGates = [];
const standalone = [];
for (const f of files) {
  const src = readFileSync(join(qaDir, f), "utf8");
  (needsBrowser(src) ? browserGates : standalone).push({ f, src });
}

console.log(`=== ${browserGates.length} gates cannot run headless ===`);

check(browserGates.length > 0, `found ${browserGates.length} browser-dependent gates (expected > 0)`);

console.log("\n=== none of them fakes a pass ===");
// The false pass needs a top-level process.exit(0) or a bare completion. Assert that
// each one instead defers to a harness.
const cheaters = browserGates.filter(({ src }) =>
  /^\s*process\.exit\(/m.test(src) && !/main\(|await main|export/.test(src));
check(cheaters.length === 0,
  `no browser gate calls process.exit() at module scope (${cheaters.map((c) => c.f).join(", ") || "none"})`);

console.log("\n=== they are genuinely in the suite's blind spot ===");
// Confirm the suite does NOT invoke a browser runner, which is the root cause.
let runner = "";
try { runner = readFileSync(join(here, "run_all.mjs"), "utf8"); } catch {}
check(!/browser-automation|browser\.mjs/.test(runner),
  "run_all.mjs does not shell out to the browser runner -- so these never run in the suite");
check(!/8899/.test(runner), "run_all.mjs never starts the dev server, so nothing is listening when they would run");

console.log(`\n=== the standing caveat ===`);
console.log(`  ${standalone.length} standalone gates DO run headless and are real coverage.`);
console.log(`  ${browserGates.length} browser gates are STRUCTURAL checks only right now:`);
console.log(`    they prove the game builds and boots, not that a quest completes.`);
console.log(`  To actually run one:`);
console.log(`    npm start            # node serve.mjs 8899`);
console.log(`    node <browser-automation>/browser.mjs http://localhost:8899/ --script tools/qa/${browserGates[0]?.f || "actone.mjs"}`);
console.log(`  The browser-automation runner is NOT in this repo, so this agent cannot run them.`);

console.log(`\n${fails ? fails + " FAILURES" : "the blind spot is now visible instead of silent"}`);
process.exit(fails ? 1 : 0);
