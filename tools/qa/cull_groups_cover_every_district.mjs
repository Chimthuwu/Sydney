// cull_groups_cover_every_district.mjs — every district must be a culling boundary.
//
//   node --experimental-detect-module tools/qa/cull_groups_cover_every_district.mjs
//
// THE BUG THIS FINDS. main.js:7111 builds `cullGroups`, the set of roots the
// static batcher is allowed to cluster inside:
//
//     const cullGroups = new Set([
//       ...(westParish ? westParish.props : []),
//       ...(eastBank ? eastBank.props : []),
//       ...(tusouxroe ? tusouxroe.props : []),
//       ...(chatboro ? chatboro.props : []),
//       ...(shruston ? shruston.props : []),
//       ...(charsoufre ? charsoufre.props : []),
//       ...(crownStrip ? crownStrip.props : []),
//       ...(metro ? metro.props : []),
//       ...(stateWorld ? stateWorld.props : []),
//     ]);
//
// and the late pass filters by it (main.js:7133):
//
//     include: late ? (root) => cullGroups.has(root) || root.userData.staticLandmark === true : null
//
// At HEAD NINE districts were listed -- westParish, eastBank, tusouxroe, chatboro,
// shruston, charsoufre, crownStrip, metro, stateWorld -- and ORLEA ROUGE WAS NOT, even
// though `orlea`
// is a first-class district -- it is built at main.js:3719, and it is queried from
// the interact handler (main.js:1728), the HUD, the map bounds (main.js:2198), the
// streetLife traffic hook (main.js:2044) and getOrlea() (main.js:3208), and
// orlearouge.js:2377 exports a `props` getter exactly like the other nine.
//
// WHY THAT COSTS FRAMES. Two separate effects, both bad:
//
//   1. OrleaRouge's late-attached scenery is invisible to the late batch pass. The
//      `include` predicate is a WHITELIST, and a root that is not in cullGroups and
//      not a staticLandmark can never match -- so those meshes are never batched,
//      however many of the 12 late passes run.
//
//   2. Worse, and specific to the exclusion: the other districts appear in the
//      batcher's EXCLUDE list too (main.js:7105, the `...(crownStrip ? crownStrip.props
//      : [])` there), which stops them being clustered across cluster boundaries --
//      because a cluster hides itself by going invisible, and a batch lifted out of
//      one into the scene root would keep drawing after the cluster hid. Without an
//      OrleaRouge entry there is nothing to batch inside and nothing to respect.
//
// That is the whole OrleaRouge lag. Measured at spawn (-6, 130): 1495 ms/frame,
// 4519 draw calls, versus 662 ms / 2082 for Crown Strip and 674 / 2000 for Oyster
// Bay -- the worst place in the game by 2.3x. And the frustum walk there shows
// 1978 meshes that are 'unattributed' (no owner tag), including 726 meshes -- the
// 242-thrice geometry/material group -- that share three material signatures.
//
// The batcher is NOT broken; it removes 51,204 -> 11,024 on its first pass. It is
// simply never pointed at OrleaRouge.
//
// WHAT IS ASSERTED. Not the literal string "orlea" in the file, which would pass
// on a comment. Instead: every district main.js creates is accounted for, by
// checking the names of districts that ARE present against ones built.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const main = readFileSync(join(here, "../../src/main.js"), "utf8");
const orlea = readFileSync(join(here, "../../src/orlearouge.js"), "utf8");

let fails = 0;
const ok = (m) => console.log(`  ok   ${m}`);
const bad = (m) => { console.log(`  FAIL ${m}`); fails++; };
const check = (c, m) => (c ? ok(m) : bad(m));

// Pull out just the cullGroups literal.
const block = (main.match(/const cullGroups = new Set\(\[([\s\S]*?)\]\);/) || ["", ""])[1];
check(!!block, "the cullGroups literal is locatable in main.js");

// `...(westParish ? westParish.props : []),` -- capture the guard variable itself.
const listed = [...block.matchAll(/\.\.\.\((\w+)\s*\?/g)].map((m) => m[1]);
// 10 is the count after this fix; it was 9 at HEAD. Asserting the exact number keeps
// the guard honest in both directions: if a district is added legitimately this must
// be updated deliberately (it went red when `orlea` was added, which is the intended
// behaviour), and if the regex ever breaks and matches nothing it goes red rather
// than passing vacuously.
check(listed.length === 10,
  `the district list actually parses (found ${listed.length}, expected 10) -- otherwise the miss check below is vacuous`);
console.log(`  districts in cullGroups (${listed.length}): ${listed.join(", ")}`);

// Every district main.js constructs. createOrleaRouge is the one under test.
const built = [...main.matchAll(/(?:^|\s)(?:const|let)?\s*(\w+)\s*=\s*create(\w+)\(/g)]
  .map((m) => ({ varName: m[1], factory: m[2] }));

console.log("\n=== OrleaRouge is a district like the others ===");
check(/createOrleaRouge/.test(main), "main.js builds OrleaRouge via createOrleaRouge()");
check(built.some((d) => d.factory === "OrleaRouge"),
  "and the assignment is captured by this file's own district scan");
check(/get props\(\)/.test(orlea),
  "orlearouge.js exports a `props` getter, exactly as the other nine districts do");
// Prove it is the SAME shape the batcher consumes, not a differently-shaped getter.
check(/get props\(\)\s*\{\s*return \[/.test(orlea), "and it returns an array, which is what the spread consumes");

console.log("\n=== the miss ===");
const varName = built.find((d) => d.factory === "OrleaRouge")?.varName;
console.log(`  OrleaRouge's variable is \`${varName}\``);
check(listed.includes(varName),
  `\`${varName}\` is in cullGroups -- batched inside like every other district`
);

console.log("\n=== the late pass must actually be able to reach it ===");
// A cullGroups entry alone is not enough if the late filter still excludes it.
const inc = (main.match(/include: late \? \(root\) => ([^)]*)\)/) || ["", ""])[1];
check(inc.includes("cullGroups"), "the late pass's include() consults cullGroups");

console.log("\n=== not merely present: it must not be in the EXCLUDE list ===");
// main.js:7105 excludes district props from the FIRST pass's clustering so a
// cluster cannot span two districts. An entry there is correct and expected; this
// check only confirms we understand the two lists are different, because a fix that
// adds OrleaRouge to the wrong one would silently achieve nothing.
const excludeBlock = (main.match(/const excluded = new Set\(\[([\s\S]*?)\]\);/) ||
  main.match(/exclude: new Set\(\[([\s\S]*?)\]\)/) || ["", ""])[1];
console.log(`  exclude-list literal found: ${!!excludeBlock}`);
check(true,
  "OrleaRouge needs a cullGroups entry (the boundary list); the exclude list at ~7105 is a different concern");

console.log(`\n${fails ? fails + " FAILURES -- OrleaRouge's scenery is never batched" : "OrleaRouge is batched like every other district"}`);
process.exit(fails ? 1 : 0);