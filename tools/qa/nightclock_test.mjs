// The night-only clock (human request 2026-10-01): the world runs 21:00 → 04:00
// and wraps, so no hour of daylight can ever reach the renderer.
//
//   node --experimental-detect-module tools/qa/nightclock_test.mjs
import {
  createWorldTime, NIGHT_ONLY_START, NIGHT_ONLY_END, NIGHT_WINDOW_SECONDS,
} from "../../src/worldtime.js";
import { skyState } from "../../src/daycycle.js";

let failed = 0;
const ok = (c, m) => { console.log(`${c ? "✓ PASS" : "❌ FAIL"}: ${m}`); if (!c) failed++; };
const inWindow = (h) => h >= NIGHT_ONLY_START || h < NIGHT_ONLY_END;

// ---- it opens at night, and it opens at the top of the window
{
  const w = createWorldTime();
  ok(inWindow(w.hours) && w.isNight(), `the clock opens at night (${w.label()})`);
  ok(w.hours === NIGHT_ONLY_START, `it opens at ${NIGHT_ONLY_START}:00, not mid-dusk (${w.hours})`);
  ok(w.dusk === 1, "and it opens fully dark");
}

// ---- nothing can talk it into daylight
{
  const w = createWorldTime();
  let bad = null;
  for (const h of [0, 4, 5, 6, 8, 12, 13, 17, 18.5, 19.5, 20, 20.99, 24, 36, -6]) {
    w.setTime(h);
    if (!inWindow(w.hours) || !w.isNight() || w.dusk !== 1) { bad = `${h} → ${w.hours}`; break; }
  }
  ok(bad === null, `a daylight setTime() (a story beat, a QA script) snaps to ${NIGHT_ONLY_START}:00${bad ? ` (got ${bad})` : ""}`);
  w.setTime(23.5); ok(w.hours === 23.5, "a night setTime() is still honoured");
  w.setTime(1.25); ok(w.hours === 1.25, "and so is one past midnight");
}

// ---- run it long enough to go round the loop several times, sampling every frame
{
  const w = createWorldTime({ scale: 60 });          // 60 game seconds per real second
  let minH = 24, maxH = 0, everOutside = false, everDaylight = false, everLampsOff = false;
  const dayAtStart = w.day;
  let daysSeen = 1;
  for (let i = 0; i < 40000; i++) {                   // ~11.6 real days of game time
    w.update(0.1);
    const h = w.hours;
    if (!inWindow(h)) everOutside = true;
    minH = Math.min(minH, h); maxH = Math.max(maxH, h);
    const sky = skyState(h);
    if (sky.day > 0.05) everDaylight = true;
    if (sky.lampsOn < 1) everLampsOff = true;
    daysSeen = Math.max(daysSeen, w.day - dayAtStart + 1);
  }
  ok(!everOutside, "40k frames of running never produced an hour outside 21:00 → 04:00");
  ok(maxH < 24 && minH >= 0, `hours stay on a wall clock, 0 … 24 (saw ${minH.toFixed(2)} … ${maxH.toFixed(2)})`);
  ok(!everDaylight && !everLampsOff, "and the sky it feeds is night: no daylight term, lamps always on");
  ok(daysSeen > 5, `the window rolls over rather than stopping (${daysSeen} in-world days)`);
  ok(inWindow(w.hours), `...and it lands back in the night (${w.label()}, day ${w.day})`);
}

// ---- the roll-over itself: 04:00 → 21:00 on the next day, and onHour still fires
{
  const w = createWorldTime({ scale: 3600 });        // one game hour per real second
  const seen = [];
  w.onHour((h) => seen.push(h));
  const dayBefore = w.day;
  w.setTime(2.9);
  for (let i = 0; i < 3; i++) w.update(0.5);          // 1.5 game hours → past 04:00, 1.4 past the wrap
  ok(w.hours >= NIGHT_ONLY_START && w.hours < NIGHT_ONLY_START + 2,
    `04:00 rolls on to ${NIGHT_ONLY_START}:00 and keeps running (got ${w.hours.toFixed(2)})`);
  ok(w.day === dayBefore + 1, "and it counts a day while doing it");
  ok(!seen.includes(4) && seen.includes(3) && seen.includes(21),
  `onHour went 03:00 → ${NIGHT_ONLY_START}:00 with nothing in between (${seen.join(", ")})`);
}

// ---- the loop is exactly 7 game hours long, so nothing can drift out of the window
{
  ok(NIGHT_WINDOW_SECONDS === 7 * 3600, "the night window is 7 hours (21:00 → 04:00)");
  ok(NIGHT_ONLY_END === 4 && NIGHT_ONLY_START === 21, "and its ends are the hours the banner shows");
}

if (failed) { console.error(`\n${failed} check(s) failed`); process.exit(1); }
console.log("\nAll night-clock checks passed");