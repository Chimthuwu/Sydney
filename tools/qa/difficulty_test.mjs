// Zombie difficulty (difficulty.js) — is the ramp gradual, and is the early
// game actually calm?
//
// The bug this guards: difficulty used to be `60 + kills * 2` alive with a
// cluster floor of four, so a fresh save had sixty zombies on the map within a
// minute and hit the ceiling of 300 after a hundred kills. These assertions
// are about the SHAPE of the curve, not exact numbers — a tuning change should
// not have to rewrite this file, but reintroducing the old shape must fail it.
import assert from "node:assert/strict";
import {
  hordeCap, hordeCluster, hordeCooldown, hordeSpread, hordeProgress,
  normalizeDifficulty, tierFor, describeHorde, DIFFICULTY_TIERS, DEFAULT_DIFFICULTY,
} from "../../src/difficulty.js";

let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? `  — ${detail}` : ""}`);
};

const NORMAL = DEFAULT_DIFFICULTY;
const rng = (n) => () => n;

// ---- the early game is a swarm, not a trickle -------------------------------
// RE-READ THESE THRESHOLDS before "simplifying" them back down. They used to
// assert a fresh save is calm: hordeCap(0, NORMAL, true) <= 12, first clusters
// <= 2, chill <= 8, brutal <= 16. Those were correct against `start =
// lerp(5, 12, level)`, which put 8.5 zombies on a fresh save at Standard and
// arrived them one or two at a time — the human report "there is not enough
// zombie swarms ... we used to have a lot more in earlier builds" (2026-10-02).
// The floor of the pre-difficulty.js formula was 60, so "calm" was overcorrected
// into "absent". What is asserted below is that the opening is a real horde that
// is still well short of the late-game ceiling.
const freshCap = hordeCap(0, NORMAL, true);
check("a fresh save already carries a swarm", freshCap >= 18, `${freshCap} zombies alive at 0 kills (was 8.5)`);
check("...but it is still early, not the late-game ceiling",
  freshCap < hordeCap(4000, NORMAL, true) / 2,
  `${freshCap} now vs ${hordeCap(4000, NORMAL, true)} once established`);
check("...and still nowhere near the old 60-at-minute-one wall",
  freshCap < 40,
  `${freshCap} (the old formula's value at 0 kills was 60)`);

const freshClusterMax = hordeCluster(0, NORMAL, rng(0.9999));
check("the first clusters are a knot, not a pair", freshClusterMax >= 3 && freshClusterMax <= 8,
  `largest first cluster: ${freshClusterMax} (was 2 — one-at-a-time arrivals read as a trickle)`);
check("a cluster can be a single zombie", hordeCluster(0, NORMAL, rng(0)) === 1,
  "the old floor was 4, which is why a low cap still read as a flood");

const freshCd = hordeCooldown(0, NORMAL, true);
check("the first spawns are slow", freshCd >= 1.5, `${freshCd.toFixed(2)}s between attempts`);
check("...and daylight is thinner still", hordeCap(0, NORMAL, false) < freshCap,
  `${hordeCap(0, NORMAL, false)} by day vs ${freshCap} at night`);

// ---- the ramp is gradual, and monotonic -------------------------------------
const marks = [0, 50, 100, 200, 400, 800, 2000];
const caps = marks.map((k) => hordeCap(k, NORMAL, true));
check("the cap never falls as you kill more", caps.every((c, i) => i === 0 || c >= caps[i - 1]),
  caps.join(" -> "));
check("the cap never runs away in the first hundred kills", caps[2] < 40,
  `100 kills -> ${caps[2]} (the old curve was already at its 300 ceiling here)`);

// no single 25-kill step may double the horde
const fine = [];
for (let k = 0; k <= 400; k += 25) fine.push(hordeCap(k, NORMAL, true));
const steps = fine.slice(1).map((c, i) => c / fine[i]);
check("the ramp has no cliff in it", steps.every((s) => s < 2),
  `biggest 25-kill step: x${Math.max(...steps).toFixed(2)} (9 -> 40 over 50 kills before the curves were shaped)`);

const p = marks.map(hordeProgress);
check("progress saturates rather than running off to infinity", p[p.length - 1] < 1.001 && p[1] < p[3],
  p.map((x) => x.toFixed(2)).join(" -> "));
check("...and is still climbing at 2000 kills", hordeProgress(2000) > hordeProgress(800),
  `${hordeProgress(800).toFixed(3)} -> ${hordeProgress(2000).toFixed(3)}`);

// ---- the slider orders everything -------------------------------------------
for (const k of [0, 200, 800]) {
  const lo = hordeCap(k, 0, true), hi = hordeCap(k, 1, true);
  check(`chill is below brutal at ${k} kills`, lo < hi, `${lo} vs ${hi}`);
  check(`...and brutal spawns at least as fast at ${k} kills`,
    hordeCooldown(k, 1, true) <= hordeCooldown(k, 0, true),
    `${hordeCooldown(k, 0, true).toFixed(2)}s vs ${hordeCooldown(k, 1, true).toFixed(2)}s`);
}
check("even chill opens with a swarm", hordeCap(0, 0, true) >= 14, `${hordeCap(0, 0, true)}`);
check("brutal opens harder, but is still not a wall", hordeCap(0, 1, true) >= 30 && hordeCap(0, 1, true) <= 40,
  `${hordeCap(0, 1, true)}`);

// ---- the slider input is defensive ------------------------------------------
check("garbage settings fall back to the default", normalizeDifficulty(NaN) === DEFAULT_DIFFICULTY);
check("out-of-range settings are clamped", normalizeDifficulty(9) === 1 && normalizeDifficulty(-4) === 0);
check("the named stops are ordered and land where they say",
  DIFFICULTY_TIERS.every((t) => tierFor(t.value).id === t.id),
  DIFFICULTY_TIERS.map((t) => `${t.label}=${t.value}`).join(" "));

// ---- the summary the options panel shows matches the curves -----------------
const d = describeHorde(0, NORMAL, true);
check("the options readout agrees with the cap", d.cap === hordeCap(0, NORMAL, true), `${d.cap}`);
check("...and with the largest possible cluster", d.maxCluster === hordeCluster(0, NORMAL, rng(0.9999)), `${d.maxCluster}`);

console.log(failures ? `\n${failures} difficulty check(s) FAILED` : "\nAll difficulty checks passed");
process.exit(failures ? 1 : 0);
