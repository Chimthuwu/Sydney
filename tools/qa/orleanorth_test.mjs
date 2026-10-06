// orleanorth_test.mjs — the connective city must build, and must build GREEN-FREE.
//
//   node --experimental-detect-module tools/qa/orleanorth_test.mjs
//
// Orleanorth (orleanorth.js) exists to close the 69,550 m2 hole between
// OrleaRouge's north edge (z 130) and the Crown Strip's south edge (z -134),
// which read as "rural areas so quickly" when you drove north out of the strip
// (human request, cunthuwu, 2026-10-01).
//
// Two things have to hold, and neither is obvious from reading the source:
//   1. it BUILDS. composer.openArea throws if a site was never claimed with
//      C.site(), and townkit's shops.* expect a composer frontage `slot` while
//      openArea hands its callback (rect, centre) — so a wrong signature here
//      throws at load, not at review time.
//   2. it is green-free outside its one declared park. The whole point is that
//      the band stops being the wood in the middle of the city, so a stray pine
//      anywhere outside Memorial Green is the bug this module was written to
//      kill, showing up in the new district.
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";

let fails = 0;
const ok = (c, m) => { console.log(`${c ? "  ok  " : "  FAIL"} ${m}`); if (!c) fails++; };

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../..");
const read = (p) => readFileSync(join(root, p), "utf8");

console.log("=== it is wired into main.js ===");
const main = read("src/main.js");
ok(/import \{ createOrleanorth \} from "\.\/orleanorth\.js"/.test(main), "main.js imports createOrleanorth");
ok(/orleanorth = createOrleanorth\(/.test(main), "main.js constructs it");
ok(/orleanorth\.buildSet\(\)/.test(main), "main.js builds it");
ok(/orleanorth && orleanorth\.zoneAt\(x, z\)/.test(main), "orleanorth is in the extraZone chain, after crownStrip so the strip keeps its own ground");

console.log("\n=== every openArea has a site, and vice versa ===");
const src = read("src/orleanorth.js");
const sites = [...src.matchAll(/C\.site\("([^"]+)"/g)].map((m) => m[1]);
const areas = [...src.matchAll(/C\.openArea\("([^"]+)"/g)].map((m) => m[1]);
const templates = [...src.matchAll(/C\.openArea\(`([^`$]+) \$\{/g)].map((m) => m[1]);
for (const a of areas) ok(sites.includes(a), `openArea("${a}") has a matching C.site`);
// Templated names ("industrial ${i}") are claimed inside a forEach with the same
// template, so the pairing is checked by PREFIX rather than by literal name —
// comparing the bare prefix against a list of concrete names would always fail.
const sitePrefixes = new Set([...src.matchAll(/C\.site\(`([^`$]+) \$\{/g)].map((m) => m[1]));
for (const t of templates)
  ok(sitePrefixes.has(t), `templated openArea(${t} \${i}) is claimed by a templated C.site (${t} …)`);
// and the counts must agree, or one side gained a name the other never claims
ok(templates.length === sitePrefixes.size,
  `${templates.length} templated openAreas vs ${sitePrefixes.size} templated C.site claims`);
ok(new Set(sites).size === sites.length, "no duplicate site names (sites is a Map — a dup silently overwrites)");

console.log("\n=== it does not pave US-167 a second time ===");
ok(/US-167 Orleanorth"[\s\S]{0,120}paved: false/.test(src),
  "the Orleanorth US-167 marker is paved: false — stateWorld already lays the road");

console.log("\n=== green-free outside the park ===");
ok(/urban: true/.test(src), "orleanorth is urban, so composer fills no WILD ground with pines");
ok(/parks: \[PARK\]/.test(src), "it declares exactly one park");
const parkM = src.match(/const PARK = \{ x0: (-?\d+), x1: (-?\d+), z0: (-?\d+), z1: (-?\d+) \}/);
ok(!!parkM, "PARK is a parseable rect");
const bM = src.match(/const BOUNDS = \{ x0: (-?\d+), x1: (-?\d+), z0: (-?\d+), z1: (-?\d+) \}/);
ok(!!bM, "BOUNDS is a parseable rect");
if (parkM && bM) {
  const p = parkM.slice(1).map(Number), b = bM.slice(1).map(Number);
  ok(p[0] >= b[0] && p[1] <= b[1] && p[2] >= b[2] && p[3] <= b[3],
    `the park x[${p[0]},${p[1]}] z[${p[2]},${p[3]}] lies inside the district bounds`);
  // it must reach north past the strip's south edge, or the seam is still open
  ok(b[2] <= -134, `the band reaches z ${b[2]}, at or past the Crown Strip's south edge (-134)`);
  ok(b[3] >= 130, `the band reaches z ${b[3]}, at or past OrleaRouge's north edge (130)`);
}

console.log("\n=== no second OrleaRouge VO beat (keseme's corny line) ===");
// Check for the lines as SPOKEN DIALOGUE. A plain substring search fails: the
// removal is documented in a comment at orlearouge.js:2413, which quotes both
// lines, so searching the file text finds the comment and reports the line as
// still present. Match `c.say(` instead, which is the only place dialogue lives.
const orl = read("src/orlearouge.js");
const spoken = [...orl.matchAll(/c\.say\([^)]*["']([^"']*)["']/g)].map((m) => m[1]).join(" | ");
ok(!/teaches you two things/.test(spoken), "keseme's 'teaches you two things' line is no longer spoken");
ok(!/Life can be beautiful/.test(spoken), "'Life can be beautiful' is no longer spoken");
ok(!/beauty doesn't make you safe/.test(spoken), "'beauty doesn't make you safe' is no longer spoken");
ok(!/KESEME \(V\.O\.\)/.test(spoken), "no KESEME voice-over lines remain in OrleaRouge at all");

console.log(`\n${fails ? fails + " FAILURES" : "orleanorth checks passed"}`);
process.exit(fails ? 1 : 0);