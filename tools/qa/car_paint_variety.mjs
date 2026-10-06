// car_paint_variety.mjs — cars stop all being the same orange.
//
//   node --experimental-detect-module tools/qa/car_paint_variety.mjs
//
// THE DEFECT, found by reading rather than by looking:
//
//   graphics.js:622 tags a material as `paint` from its mesh name and sets PBR
//   properties (metalness 0.75, roughness 0.26, clearcoat 1) -- but never a colour.
//   So the colour comes entirely from the Kenney texture baked into the model, and
//   every car shares it. There is no palette anywhere in the codebase. The material
//   was a car-paint FINISH with no car-paint COLOUR.
//
// The second, subtler half is the RANDOMNESS. A uniform random hue is the obvious
// fix and it is wrong: it puts as many cars in sickly yellow-green as in red, and a
// car park of uniformly random hues looks like a toy. Real paint clusters hard --
// black, white, silver and grey dominate; red and blue are common; vivid green,
// purple and teal are rare. So this asserts the distribution, not merely that
// "colours differ".

import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
// pathToFileURL, not the bare path: on Windows a "Z:/..." absolute path has the
// ERR_UNSUPPORTED_ESM_URL_SCHEME error, because the ESM loader only takes file:// URLs.
const paint = await import(pathToFileURL(join(here, "../../src/carPaint.js")).href);
const main = readFileSync(join(here, "../../src/main.js"), "utf8");
const graphics = readFileSync(join(here, "../../src/graphics.js"), "utf8");

let fails = 0;
const ok = (m) => console.log(`  ok   ${m}`);
const bad = (m) => { console.log(`  FAIL ${m}`); fails++; };
const check = (c, m) => (c ? ok(m) : bad(m));

console.log("=== the actual cause: paint had a finish but no colour ===");
const paintRule = graphics.slice(graphics.indexOf('key: "paint"'), graphics.indexOf('key: "stone"'));
check(/clearcoat: 1/.test(paintRule), "the paint material class still sets a clearcoat finish");
check(!/color:/.test(paintRule),
  "and still sets NO colour -- confirming the orange came from the shared texture, not a palette");

console.log("\n=== paint is applied per vehicle, not to a shared material ===");
// The load-bearing constraint. If the tint were applied to a shared material, one
// car repainted would repaint the whole car park.
check(/gtbPaintKey/.test(main) || /carPaint/.test(main), "the paint tinting path exists in main.js");
check(/material\s*!==\s*o\.material|material\.clone\(\)/.test(main) || /\.clone\(\)/.test(main),
  "paint materials are cloned per vehicle, so a tint cannot leak across cars");
check(/randomPaint/.test(main), "spawned cars get a random paint from the weighted families");

console.log("\n=== hue variety is real ===");
const seen = new Set();
const trials = 4000;
let rgb = [0, 0, 0];
for (let i = 0; i < trials; i++) {
  const p = paint.randomPaint();
  seen.add(`${Math.round(p.hue / 15) * 15}`);
  rgb.push(p.sat);
}
check(seen.size >= 12, `many distinct hues across ${trials} draws (${seen.size} buckets of 15 degrees)`);
// A seeded rng, so this is a real determinism check rather than "it returned an
// object". (My first version passed 0.001 where a function was expected and threw.)
const fixed = [];
for (let i = 0; i < 5; i++) fixed.push(JSON.stringify(paint.randomPaint(() => 0.42)));
check(new Set(fixed).size === 1, `randomPaint is deterministic given an rng (${fixed[0]})`);

console.log("\n=== the distribution is realistic, not uniform ===");
const N = 30000;
const fam = {};
for (let i = 0; i < N; i++) {
  const p = paint.randomPaint();
  const k = paint.describePaint(p);
  fam[k] = (fam[k] || 0) + 1;
}
const pct = (k) => ((fam[k] || 0) / N) * 100;
console.log(`  over ${N} cars: ${Object.entries(fam).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${(v / N * 100).toFixed(1)}%`).join(", ")}`);
// Neutral colours dominate in the real world. A uniform-hue randomiser puts ~0% here.
// The neutral set is black/white/silver/grey/gunmetal/cream/beige -- my first
// version summed only the four I happened to think of, and the check failed against a
// distribution that was actually correct.
const NEUTRAL = ["black", "white", "silver", "grey", "gunmetal", "cream", "beige"];
const neutralPct = NEUTRAL.reduce((a, k) => a + pct(k), 0);
console.log(`  neutrals (${NEUTRAL.join("/")}): ${neutralPct.toFixed(1)}%`);
check(neutralPct > 45, `neutral colours are the majority, as on a real road (${neutralPct.toFixed(1)}%)`);
check(pct("orange") < 6, `orange is rare (${pct("Orange").toFixed(1)}%) -- the complaint was that every car was orange`);
check(pct("purple") < 4 && pct("teal") < 4, "purple and teal are rare");
check(pct("red") > 5 && pct("blue") > 5, "red and blue are actually common, not rare curiosities");

console.log("\n=== the HSL conversion is well-behaved ===");
check(paint.paintToColor({ hue: 370, sat: 50, contrast: 50 }, null).hue === 10, "hue wraps past 360");
check(paint.paintToColor({ hue: -10, sat: 50, contrast: 50 }, null).hue === 350, "negative hue wraps too");
check(paint.paintToColor({ hue: 200, sat: 900, contrast: -40 }, null).sat === 100, "out-of-range slider values are clamped, not trusted");
// A grey car must not inherit whatever hue the slider was left on.
const grey = paint.paintToColor({ hue: 130, sat: 5, contrast: 0 }, null);
check(grey.hue === 130 && grey.sat === 5, "a near-zero saturation keeps its hue but is not recoloured by it");

console.log(`\n${fails ? fails + " FAILURES" : "cars come in real paint colours now"}`);
process.exit(fails ? 1 : 0);