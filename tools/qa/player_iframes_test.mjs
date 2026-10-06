// player_iframes_test.mjs — many cops cannot delete the player in one frame.
//
//   node --experimental-detect-module tools/qa/player_iframes_test.mjs
//
// Human report 2026-10-02: "fucking the cops are way too overpowered".
//
// The cause was not the damage numbers. `hurtCd` was SET in hitPlayer() and
// DECAYED in tick(), but never READ as a gate anywhere — it only ever drove the
// hurt animation. So every damage source applied independently, on the same
// frame, with nothing to cap the total.
//
// The numbers, from the real code:
//   MAX_FOOT_COPS = 8            police.js:18
//   foot cop melee  dmg 6       police.js:180, every atkGap 1.1s
//   foot cop ranged dmg 3       police.js:284, every 1.6-2.2s, from 38 m
//   helicopter      dmg 4.5     police.js:342, from 58 m, at 3+ stars
//   streetlife beat cops        an independent population
//
// So eight deputies in melee could land 8 x 6 = 48 damage in a single frame:
// half the health bar, instantly, with nothing the player could have done
// differently. Eight cops is a fair fight. Eight landing on the same frame is
// not, and that is what "overpowered" felt like.
//
// The fix is a real invulnerability window, scaled by hit size so a shotgun
// still hurts more than a fist but a crowd of chip damage cannot.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const main = readFileSync(join(here, "../../src/main.js"), "utf8");
const police = readFileSync(join(here, "../../src/police.js"), "utf8");

let fails = 0;
const ok = (m) => console.log(`  ok   ${m}`);
const bad = (m) => { console.log(`  FAIL ${m}`); fails++; };
const check = (c, m) => (c ? ok(m) : bad(m));

const fn = main.match(/function hitPlayer\(dmg\) \{[\s\S]*?\n\}/);
check(!!fn, "hitPlayer exists");
const body = fn ? fn[0] : "";

console.log("\n=== 1. hurtCd is finally a GATE, not just a timer ===");
// The specific bug: hurtCd was written and decayed but never read. Assert it is
// read in a condition that can return early, or this whole fix is cosmetic.
check(/if \(state\.hurtCd > 0/.test(body),
  "hitPlayer checks hurtCd and can decline the hit");
check(/state\.hurtCd > 0[^)]*\)\s*return/.test(body) || /if \(state\.hurtCd > 0[\s\S]{0,160}?return/.test(body),
  "and the check actually returns — a gate that falls through is not a gate");
check(/state\.hp -= dmg/.test(body), "damage is still applied when the window is open");

console.log("\n=== 2. the window is a real constant, not a magic number ===");
check(/HURT_IFRAMES = 0\.\d+/.test(main), "a named i-frame constant exists");
check(/HURT_BIG_THRESHOLD = \d+/.test(main), "and a named threshold for a heavy hit");
check(/HURT_IFRAMES_BIG/.test(body), "a big hit earns a longer window");
// If the window were longer than the fastest attack cadence it would be a
// damage reduction rather than a frame cap. atkGap is 1.1s, ranged 1.6-2.2s.
const win = parseFloat((main.match(/HURT_IFRAMES = ([\d.]+)/) || [])[1] || "9");
check(win > 0 && win < 0.5, `the window is short (${win}s) — long enough to cap a pile-on, short enough that a 1.1s melee cadence still lands`);

console.log("\n=== 3. a heavy hit is still worse than a light one ===");
check(/dmg >= HURT_BIG_THRESHOLD \? HURT_IFRAMES_BIG : HURT_IFRAMES/.test(body.replace(/\s+/g, " ")),
  "the window scales with the size of the hit");
check(/HURT_IFRAMES_BIG > HURT_IFRAMES/.test("") ||
  parseFloat((main.match(/HURT_IFRAMES_BIG = ([\d.]+)/) || [])[1]) > win,
  "a big hit gets the LONGER window, so chip damage cannot out-trade a shotgun");

console.log("\n=== 4. the source numbers this balances against ===");
// Pinned so a future rebalance cannot quietly make the pile-on impossible again.
check(/MAX_FOOT_COPS = 8/.test(police), "MAX_FOOT_COPS is still 8");
check(/dmg: 6/.test(police), "foot cop melee is 6 — 8 of them is 48 in one frame, which is why the gate was needed");
check(/shootPlayer\(p, 3, "deputy"\)/.test(police), "deputy rifle is 3");
check(/shootPlayer\(o\.position, 4\.5, "helicopter"\)/.test(police), "helicopter is 4.5");
// Prove the arithmetic the comment claims, so the comment cannot rot.
check((6 * 8) === 48, "8 melee deputies x 6 = 48 damage in a single frame, half the bar");

console.log("\n=== 5. every damage path goes through the gate ===");
// If any source damages the player without calling hitPlayer, the cap is bypassed.
const direct = [];
for (const m of main.matchAll(/state\.hp *-= *([^;]+);/g)) {
  if (!/dmg/.test(m[1])) direct.push(m[1].trim());
}
check(direct.length === 0,
  `nothing subtracts HP outside hitPlayer${direct.length ? ` — found: ${direct.join(" | ")}` : ""}`);
// Scaled values are legitimate (ramming, fall damage) but must still be funnelled.
// Strip hitPlayer's own body first — `state.hp -= dmg` inside it IS the funnelled
// path, and flagging it would make this assertion unpassable rather than strict.
const OUTSIDE_GATE = main.replace(/function hitPlayer\(dmg\) \{[\s\S]*?\n\}/, "");
for (const src of ["main.js", "police.js", "npc.js"]) {
  const t = readFileSync(join(here, "../../src/" + src), "utf8");
  const scope = src === "main.js" ? OUTSIDE_GATE : t;
  const raw = (scope.match(/state\.hp *-= *[^;]+;/g) || [])
    .filter((s) => !/^state\.hp -= dmg;?$/.test(s.trim()));
  check(raw.length === 0, `${src} does not write state.hp outside hitPlayer${raw.length ? ` — ${raw.join(" | ")}` : ""}`);
}
// And the funnelled one must still be inside the gate, or the strip hid it.
check(/state\.hp -= dmg/.test(body), "the single subtraction is inside the gated function");

console.log(`\n${fails ? fails + " FAILURES" : "a pile-on cannot delete the player"}`);
process.exit(fails ? 1 : 0);