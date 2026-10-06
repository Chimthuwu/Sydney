// Zombie difficulty: how big the horde is, how it arrives, and how fast it
// comes back — as pure functions of (kills so far, difficulty level).
//
// It lives in its own module, away from main.js's 6500 lines, for two reasons.
// The maths is the whole feature and it is worth testing on its own; and the
// numbers are all in one place, so re-tuning the Bayou's difficulty is editing
// this file rather than hunting through the spawn loop.
//
// THE RAMP. Difficulty used to be a straight line off the kill count —
// `60 + kills * 2` zombies alive, capped at 300, with every respawn tick
// dropping a cluster of *at least four*. That put sixty of them on the map in
// the first minute of a fresh save and had you at the ceiling after a hundred
// kills: there was no early game to speak of and no sense of the dead building
// up. The ramp here saturates instead (hordeProgress), so the first hour is
// mostly the flat part and the horde only becomes a horde once you have earned
// it — and it never quite stops climbing, so there is always a next step.

/** Blend between two numbers. `t` is not clamped: callers decide the range. */
const lerp = (a, b, t) => a + (b - a) * t;

/**
 * The named stops on the difficulty slider. `value` is the 0..1 level the
 * curves are scaled by; the slider is continuous, so these are landmarks
 * rather than the only settings available.
 */
export const DIFFICULTY_TIERS = Object.freeze([
  { id: "chill", label: "Chill", value: 0.0, blurb: "A quiet parish. The dead take their time." },
  { id: "standard", label: "Standard", value: 0.5, blurb: "The intended Bayou." },
  { id: "brutal", label: "Brutal", value: 1.0, blurb: "They come in waves, and they keep coming." },
]);

export const DEFAULT_DIFFICULTY = 0.5;

/** Coerce anything (a slider value, a stored setting) into a usable 0..1 level. */
export function normalizeDifficulty(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return DEFAULT_DIFFICULTY;
  return Math.min(1, Math.max(0, n));
}

/** The named stop a level sits nearest, for the slider's readout. */
export function tierFor(level) {
  const v = normalizeDifficulty(level);
  return DIFFICULTY_TIERS.reduce((best, t) =>
    Math.abs(t.value - v) < Math.abs(best.value - v) ? t : best, DIFFICULTY_TIERS[0]);
}

/**
 * How far through the ramp a run is, 0..1. Saturating rather than linear: at
 * `SCALE` kills you are halfway, and every kill after that buys a little less
 * than the one before it. This is the single reason the early game is calm.
 */
const SCALE = 240;
export function hordeProgress(kills) {
  return 1 - Math.exp(-Math.max(0, kills || 0) / SCALE);
}

// The cap, the cluster size and the spawn rate all lean on `p` through a power
// above 1, and the reason is worth writing down: interpolating linearly from a
// small start to a large end over a saturating `p` puts almost all of the
// climb in the first tenth of the run — the first fifty kills took the horde
// from 9 to 40, which is the exact complaint this module exists to fix. The
// powers buy a long, flat, survivable opening and spend the real growth on
// the middle of a run.
const CAP_CURVE = 2.2;
const CLUSTER_CURVE = 1.5;
const COOLDOWN_CURVE = 1.3;

/**
 * How many of them may be alive at once.
 *
 * Starts in the tens on a fresh save and climbs toward a few hundred on the
 * hardest setting, with the day's third of the night's (the horde thins out in
 * daylight rather than vanishing — see main.js).
 *
 * `start` was lerp(5, 12, level) — 5 to 12 alive, 8.5 at Standard. That is the
 * "not enough zombie swarms" report in a single number (human report
 * 2026-10-02: "there is not enough zombie swarms ... we used to have a lot more
 * in earlier builds"). The pre-difficulty.js formula this replaced was
 * `60 + kills * 2` capped at 300, so a fresh save really did have sixty on the
 * map; `start` was pulled down two orders of magnitude to answer "too chaotic
 * early" and overcorrected into "there are none".
 *
 * The fix is deliberately NOT a return to `60 + kills * 2`. That curve was a
 * straight line off the kill count, so it also put sixty on the map in the
 * first minute of a fresh save, which is what it was changed for. The ramp's
 * SHAPE is right and is left alone — saturating, monotonic, no cliff. Only the
 * opening moved: a fresh save now carries a real swarm that is still a small
 * fraction of the late-game ceiling, so there is a curve to climb.
 */
export function hordeCap(kills, level, night = true) {
  const start = lerp(18, 32, level);
  const end = lerp(90, 260, level);
  const shaped = Math.pow(hordeProgress(kills), CAP_CURVE);
  return Math.max(3, Math.round(lerp(start, end, shaped) * (night ? 1 : 0.35)));
}

/**
 * How many land in one spawn. Always at least one.
 *
 * The floor was `lerp(2, 22, t)` with t = progress^1.5 * (0.65 + level*0.35),
 * which at 0 kills is t = 0 → max 2, so the first spawns were a single zombie
 * or a pair. That is the other half of the "not enough zombie swarms" report
 * (human report 2026-10-02): even with the cap raised, one-at-a-time arrivals
 * read as a trickle no matter how high the ceiling is. A knot of three to six
 * landing together reads as a swarm on sight.
 *
 * `CLUSTER_BASE` keeps a genuine floor on `t` so the opening spawn is a knot
 * rather than a pair, while the ramp above it is untouched — a late-game
 * cluster is still the same up-to-22 it was.
 *
 * `level` scales the top of the range but not the opening as hard: even on
 * Brutal the first clusters are three or four, because a fresh save should not
 * open with a wall of bodies.
 */
const CLUSTER_BASE = 0.16;
export function hordeCluster(kills, level, rng = Math.random) {
  const t = (CLUSTER_BASE + (1 - CLUSTER_BASE) * Math.pow(hordeProgress(kills), CLUSTER_CURVE)) * (0.65 + level * 0.35);
  const max = Math.max(1, Math.round(lerp(2, 22, t)));
  return 1 + Math.floor(rng() * max);
}

/**
 * Seconds between spawn attempts. `hungry` is the "still well under the cap"
 * case, which refills faster than topping up.
 */
export function hordeCooldown(kills, level, hungry) {
  const base = hungry ? lerp(2.2, 0.3, Math.pow(hordeProgress(kills), COOLDOWN_CURVE))
                      : lerp(4.5, 0.7, Math.pow(hordeProgress(kills), COOLDOWN_CURVE));
  return base * lerp(1.6, 0.7, level);
}

/**
 * How far from the player a cluster may be dropped, in metres. They still
 * arrive out of sight (the spawn ring is 35-75 m), but a fresh save keeps its
 * first handful further out than a late one does.
 */
export function hordeSpread(kills) {
  return lerp(6, 16, Math.pow(hordeProgress(kills), COOLDOWN_CURVE));
}

/**
 * The hour a zombie run starts at (human request, 2026-09-28: "randomize the
 * time of day of spawn too"; narrowed 2026-10-01 when the whole game became night
 * only — worldtime.js now runs 21:00 → 04:00 and nothing else, so there is no
 * daylight left to draw and any hour outside the window is snapped to 21:00).
 *
 * It used to be a hardcoded 22.5, then a weighted draw across the whole day; it is
 * now a weighted draw across the night window only. Weighted rather than uniform,
 * because uniform is uniform over the WRONG range: 00:00–02:30 is the darkest
 * hour in the state, and dropping a new player into that is not variety, it is a
 * wall, so it carries the smallest share.
 *
 * @param {() => number} [rng]
 * @returns {number} 21–24 or 0–4, fractional, matching `worldTime.setTime`.
 */
export function zombieStartHour(rng = Math.random) {
  const BANDS = [
    [21, 23, 0.26],    // 21:00 → 23:00, the lamps are still coming on
    [23, 24, 0.24],    // 23:00 → midnight
    [0, 2.5, 0.34],    // the small hours — most of the pool
    [2.5, 4, 0.16],    // the darkest run-up to 04:00, when the night rolls over
  ];
  const total = BANDS.reduce((a, b) => a + b[2], 0);
  let r = rng() * total;
  for (const [lo, hi, w] of BANDS) {
    if (r < w) return lo + rng() * (hi - lo);
    r -= w;
  }
  return 23 + rng();              // unreachable in practice; keeps the range total
}

/**
 * What the chosen hour means for the run, for the launch banner. Every hour the
 * clock can report is now night, so the horde always gets its full cap; only the
 * depth of the dark varies.
 */
export function describeStartHour(hour) {
  if (hour < 4) return "Dead of night — the darkest hour, full horde";
  return "Full dark, full horde";
}

/** `h` as a 24h clock string, for the banner. */
export function clockText(hour) {
  const h = Math.floor(((hour % 24) + 24) % 24);
  const m = Math.round((hour - Math.floor(hour)) * 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * How far out a cluster is dropped, in metres (human request, 2026-09-28:
 * "randomize the spawn locations a bit more ... just to mix things up").
 *
 * This was a hardcoded 35–75 m on every spawn, which is a band a player learns
 * in about two minutes: the dead always materialised at the same distance, from
 * a distance. Three shapes, because "more random" that is only *more uniform*
 * is not variety either:
 *
 *   the usual  a narrow band — close enough to matter quickly
 *   a push     out past the treeline — a knot you have to go and find, which is
 *              a different minute of the game entirely
 *   a drift    in close — for when the ring is thin and you have somewhere to be
 *
 * The bearing was already uniform (spawnzones.js draws a random angle), so it is
 * left alone: re-rolling a uniform adds nothing and makes it worse.
 *
 * @returns {{minDist:number, maxDist:number}} metres, for spawnZones.pick().
 */
export function hordeRing(rng = Math.random) {
  const r = rng();
  if (r < 0.62) return { minDist: 35, maxDist: 75 };
  if (r < 0.88) return { minDist: 60, maxDist: 120 };
  return { minDist: 22, maxDist: 40 };
}

/**
 * A one-line summary of the curve, for the options panel and for QA. Reports
 * the same numbers the spawn loop will use, so a tuning change is visible in
 * one place instead of having to be inferred from a playtest.
 */
export function describeHorde(kills, level, night = true) {
  const p = hordeProgress(kills);
  return {
    progress: Math.round(p * 100) / 100,
    cap: hordeCap(kills, level, night),
    maxCluster: hordeCluster(kills, level, () => 0.9999),
    cooldown: Math.round(hordeCooldown(kills, level, true) * 10) / 10,
  };
}
