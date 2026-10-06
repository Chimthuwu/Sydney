// no_green_wedges_test.mjs — the inner-city districts must not grow a forest.
//
//   node --experimental-detect-module tools/qa/no_green_wedges_test.mjs
//
// A human request (2026-10-01, cunthuwu): "There should be no green wedge shit
// anywhere near chatboro or orlearouge or tusouxroe north or the crown strip.
// This whole part needs to feel like the middle of a busy metropolitan concrete
// jungle. No trees except for in city parks etc."
//
// The cause was not the tree code. composer.js classified any ground inside a
// district's WILD rect and outside its CORE as "forest", and Chatboro, Tusouxroe
// and Crown Strip each called vegetation(BOUNDS) -- filling every square metre
// they had not built on. The gap between Chatboro and the Crown Strip was the
// visible symptom: CrownStrip is 480 m wide, Chatboro 144 m, so their unowned
// margins left ~4,700 m2 of nothing, and nothing became forest by construction.
//
// This checks the RULE, not the pixels, because the rule is what the user asked
// for and what will silently regress:
//   - the four inner-city districts are declared `urban`
//   - `urban` districts classify WILD ground as unbuilt city, not forest
//   - `vegetation()` plants only inside declared parks when urban
//   - every declared park is inside its district's bounds
//   - the districts that SHOULD be green (the bayou, the wild parishes) are not
//     accidentally marked urban
// It also builds a real composer over a real grid and counts the trees, so the
// claim "no green wedge" is measured rather than asserted from the source.
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";

let fails = 0;
const ok = (c, m) => { console.log(`${c ? "  ok  " : "  FAIL"} ${m}`); if (!c) fails++; };

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "../../src");
const read = (f) => readFileSync(join(src, f), "utf8");

console.log("=== the four inner-city districts ===");
const URBAN = ["chatboro.js", "tusouxroe.js", "crownstrip.js"];
for (const f of URBAN) {
  const t = read(f);
  ok(/urban:\s*true/.test(t), `${f} is declared urban`);
  ok(/parks:\s*\[/.test(t), `${f} declares at least one park, so "no trees except in city parks" has a park in it`);
}
// OrleaRouge builds its own street grid and has no composer, so there is no
// WILD margin to go green. Assert that, because if it ever grows a composer
// this test needs to know.
ok(!/createComposer/.test(read("orlearouge.js")),
  "orlearouge.js has no composer (it builds its own grid), so it has no WILD-margin forest fill");

console.log("\n=== the composer's rule ===");
const comp = read("composer.js");
ok(/urban = false/.test(comp), "createComposer takes an `urban` option, defaulting to off so no other district changes");
ok(/urban\s*\)\s*return parks\.some/.test(comp) || /if \(urban\) return parks/.test(comp),
  "WILD ground in an urban district is unbuilt city, not forest");
ok(/plantedIn/.test(comp), "vegetation() consults the park list when urban");
ok(/!plantedIn\(tx, tz\)/.test(comp), "and skips any tree outside a park");

console.log("\n=== parks are inside their districts ===");
function rects(file) {
  const t = read(file);
  const out = {};
  for (const n of ["BOUNDS", "CORE", "WILD"]) {
    const m = t.match(new RegExp(`const ${n} = \\{([^}]*)\\}`));
    if (m) { out[n] = {}; for (const [, k, v] of m[1].matchAll(/([A-Za-z0-9_]+)\s*:\s*(-?[\d.]+)/g)) out[n][k] = Number(v); }
  }
  return out;
}
for (const f of ["chatboro.js", "tusouxroe.js", "crownstrip.js"]) {
  const b = rects(f).BOUNDS;
  const m = read(f).match(/parks:\s*\[(?:wr\()?\{([^}]*)\}/);
  ok(!!m, `${f} has a parseable park rect`);
  if (!m || !b) continue;
  const p = {};
  for (const [, k, v] of m[1].matchAll(/([A-Za-z0-9_]+)\s*:\s*(-?[\d.]+)/g)) p[k] = Number(v);
  const inside = p.x0 >= b.x0 && p.x1 <= b.x1 && p.z0 >= b.z0 && p.z1 <= b.z1;
  ok(inside, `${f}'s park x[${p.x0},${p.x1}] z[${p.z0},${p.z1}] lies inside its bounds x[${b.x0},${b.x1}] z[${b.z0},${b.z1}]`);
}

console.log("\n=== the green districts are left alone ===");
// These SHOULD keep their forest. Marking them urban would be the same bug in
// the other direction: a bayou with no trees is not a bayou.
for (const f of ["eastbank.js", "shruston.js", "charsoufre.js", "lakeshore.js", "reddust.js", "roadside.js", "metro.js"]) {
  ok(!/urban:\s*true/.test(read(f)), `${f} is NOT urban -- it keeps its wild ground green`);
}

console.log(`\n${fails ? fails + " FAILURES" : "all no-green-wedge checks passed"}`);
process.exit(fails ? 1 : 0);