// weather.js director + daycycle.js soft day (zombie mode). node --experimental-detect-module tools/qa/weather_test.mjs
import { createWeather, WEATHER_PROFILES } from "../../src/weather.js";
import { skyState, SOFT_DAY_MAX_ELEVATION } from "../../src/daycycle.js";

let failed = 0;
const ok = (c, m) => { console.log(`${c ? "✓ PASS" : "❌ FAIL"}: ${m}`); if (!c) failed++; };

// ---- the director: runs 10 real days of weather, seeded so it is repeatable
let seed = 12345; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const realRandom = Math.random; Math.random = rnd;
const w = createWeather();
const seen = {}; let hurricanes = 0, changes = 0, longestHurricane = 0, hStart = 0, t = 0, dropped = 0;
w.onChange((n) => { changes++; seen[n] = (seen[n] || 0) + 1; if (n === "hurricane") { hurricanes++; hStart = t; } });
for (t = 0; t < 10 * 86400; t += 1) {
  const before = w.type;
  w.director(1); w.update(1);
  if (before === "hurricane" && w.type !== "hurricane") longestHurricane = Math.max(longestHurricane, t - hStart);
}
Math.random = realRandom;
ok(changes > 100, `the weather keeps changing on its own (${changes} changes in 10 days)`);
ok(["clear", "cloudy", "rain", "storm", "fog"].every((k) => seen[k] > 0), `every ordinary type turns up (${JSON.stringify(seen)})`);
ok(hurricanes >= 5 && hurricanes <= 80, `hurricanes are rare but happen (${hurricanes} in 10 real days of play = about one per ${Math.round(240 / Math.max(1, hurricanes))} h)`);
ok(longestHurricane >= 200 && longestHurricane <= 420, `a hurricane lasts minutes, not seconds or hours (${longestHurricane} s)`);
ok(WEATHER_PROFILES.hurricane.wind >= WEATHER_PROFILES.storm.wind && WEATHER_PROFILES.hurricane.light < WEATHER_PROFILES.storm.light, "a hurricane is windier and darker than a storm");

// ---- blends: set() eases, precip follows
const w2 = createWeather();
w2.set("storm", { seconds: 10 });
w2.update(5); const mid = w2.precip;
w2.update(6);
ok(mid > 0 && mid < WEATHER_PROFILES.storm.precip && Math.abs(w2.precip - WEATHER_PROFILES.storm.precip) < 1e-6, "rain eases in over the blend time");

// ---- the soft day: bright only like dawn/dusk, all day, and the night is untouched
let maxSoft = 0, maxHard = 0;
for (let h = 0; h < 24; h += 0.05) { maxSoft = Math.max(maxSoft, skyState(h, true).day); maxHard = Math.max(maxHard, skyState(h, false).day); }
ok(maxSoft < 0.6, `zombie-mode daylight never gets bright (peak day factor ${maxSoft.toFixed(2)})`);
ok(SOFT_DAY_MAX_ELEVATION <= 12, "the flattened noon is a low sun");
const a = skyState(2, true), b = skyState(2, false);
ok(a.night === b.night && a.lightIntensity === b.lightIntensity, "the soft day leaves the night alone");
ok(skyState(12, true).elevation > 0 && skyState(7, true).elevation !== skyState(12, true).elevation, "the sun still moves through the soft day (not frozen)");

console.log(failed ? `\n${failed} FAILED` : "\nAll weather checks passed");
process.exit(failed ? 1 : 0);
