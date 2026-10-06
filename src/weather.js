// ---------------------------------------------------------------------------
// weather.js — the current weather, as numbers other systems can use.
//
// Systems never check the weather type directly for their own tuning; they read
// the blended multipliers, so a change of weather eases in and new weather types
// only need a profile here:
//
//   weather.fogMultiplier     scene fog density
//   weather.mistMultiplier    ground mist height/strength
//   weather.lightMultiplier   moon / sky strength
//   weather.wetness           0 dry … 1 soaked (road reflections)
//   weather.grip              tyre grip multiplier (steering)
//   weather.wind              0 … 1 (rain slant, gusts)
//   weather.precip            0 dry … 1 downpour (rain.js streaks, the rain bed)
//   weather.lightning         flashes per real minute (main.js lightning)
//
// The weather also changes on its own (`director`, ticked from main.js in free
// roam and zombie mode): clear → cloudy → rain → storm and back, and, rarely,
// a HURRICANE — a long, dark, howling storm that comes up from the Gulf out of a
// storm and blows itself out over a few real minutes. Story chapters never call
// the director, so they keep their scripted skies.
// ---------------------------------------------------------------------------

export const WEATHER_TYPES = Object.freeze(["clear", "cloudy", "rain", "storm", "hurricane", "fog"]);

export const WEATHER_PROFILES = Object.freeze({
  clear:     { fog: 1.0, mist: 1.0, light: 1.0,  wetness: 0.35, grip: 1.0,  wind: 0.15, precip: 0,    lightning: 0 },
  cloudy:    { fog: 1.2, mist: 1.1, light: 0.85, wetness: 0.35, grip: 1.0,  wind: 0.3,  precip: 0,    lightning: 0 },
  rain:      { fog: 1.6, mist: 1.3, light: 0.7,  wetness: 1.0,  grip: 0.85, wind: 0.45, precip: 0.55, lightning: 0.4 },
  storm:     { fog: 2.0, mist: 1.5, light: 0.55, wetness: 1.0,  grip: 0.75, wind: 0.8,  precip: 0.9,  lightning: 4 },
  hurricane: { fog: 2.8, mist: 1.9, light: 0.38, wetness: 1.0,  grip: 0.6,  wind: 1.0,  precip: 1.0,  lightning: 9 },
  fog:       { fog: 3.0, mist: 2.2, light: 0.8,  wetness: 0.5,  grip: 0.95, wind: 0.05, precip: 0,    lightning: 0 },
});

// What comes after what. Weights, not promises. A hurricane is not in this table: `director` rolls for it separately.
const NEXT = {
  clear:     [["clear", 4], ["cloudy", 4], ["fog", 0.8], ["rain", 0.5]],
  cloudy:    [["clear", 4.5], ["cloudy", 1.5], ["rain", 2.6], ["fog", 0.5], ["storm", 0.4]],
  rain:      [["cloudy", 5], ["rain", 1.8], ["storm", 1.1], ["clear", 1.5]],
  storm:     [["rain", 5], ["cloudy", 3], ["storm", 1]],
  hurricane: [["storm", 1]],
  fog:       [["clear", 4], ["cloudy", 3]],
};

const WEATHER_MSG = {
  clear: "The sky is clearing.",
  cloudy: "Clouds are building over the bayou.",
  rain: "Rain rolling in off the Gulf.",
  storm: "A storm is on top of us — thunder and lightning.",
  hurricane: "HURRICANE WARNING — winds, flooding, no visibility. Take cover.",
  fog: "A thick fog is settling in.",
};

/**
 * @param {object} o
 * @param {string} o.initial  starting weather type
 */
export function createWeather({ initial = "clear" } = {}) {
  let type = WEATHER_PROFILES[initial] ? initial : "clear";
  const cur = { ...WEATHER_PROFILES[type] };
  let from = { ...cur }, to = { ...cur }, blend = 1, blendTime = 0;
  const listeners = [];

  // the director: real seconds
  let nextChangeIn = 200;              // the first change waits ~3 minutes
  let sinceHurricane = 1e9;
  let holdT = 0;                       // how long the current weather has run

  const pick = (table) => {
    let total = 0; for (const [, w] of table) total += w;
    let r = Math.random() * total;
    for (const [t, w] of table) { if ((r -= w) < 0) return t; }
    return table[0][0];
  };

  const api = {
    WEATHER_TYPES,
    get type() { return type; },
    message(t = type) { return WEATHER_MSG[t] || ""; },
    /** Change the weather, easing over `seconds`. */
    set(next, { seconds = 8 } = {}) {
      if (!WEATHER_PROFILES[next] || next === type) return;
      const prev = type;
      type = next;
      holdT = 0;
      if (next === "hurricane") sinceHurricane = 0;
      from = { ...cur };
      to = { ...WEATHER_PROFILES[next] };
      blend = seconds > 0 ? 0 : 1;
      blendTime = Math.max(0.001, seconds);
      if (blend >= 1) Object.assign(cur, to);
      for (const fn of listeners) fn(next, prev);
    },
    update(dt) {
      if (blend >= 1) return;
      blend = Math.min(1, blend + dt / blendTime);
      const k = blend * blend * (3 - 2 * blend);
      for (const key of Object.keys(cur)) cur[key] = from[key] + (to[key] - from[key]) * k;
    },
    /**
     * Let the weather change by itself. Call once a frame with real seconds, only where the sky is free (free roam, zombie mode).
     * The eases are long (rain builds over ~25 s, drying takes longer) so it never pops.
     */
    director(dt) {
      holdT += dt;
      sinceHurricane += dt;
      nextChangeIn -= dt;
      if (nextChangeIn > 0) return;
      // a hurricane lasts 4-6 minutes, then it is a storm again
      if (type === "hurricane") { nextChangeIn = 240 + Math.random() * 120; api.set("storm", { seconds: 40 }); return; }
      nextChangeIn = 150 + Math.random() * 210;
      // RARE: only out of heavy weather, never twice within ~40 real minutes, ~4% of the changes that could
      if ((type === "storm" || type === "rain") && sinceHurricane > 2400 && Math.random() < 0.04) {
        nextChangeIn = 260 + Math.random() * 120;
        api.set("hurricane", { seconds: 45 });
        return;
      }
      const next = pick(NEXT[type] || NEXT.clear);
      if (next !== type) api.set(next, { seconds: WEATHER_PROFILES[next].precip > WEATHER_PROFILES[type].precip ? 25 : 40 });
    },
    onChange(fn) { listeners.push(fn); },
    get fogMultiplier() { return cur.fog; },
    get mistMultiplier() { return cur.mist; },
    get lightMultiplier() { return cur.light; },
    get wetness() { return cur.wetness; },
    get grip() { return cur.grip; },
    get wind() { return cur.wind; },
    get precip() { return cur.precip; },
    get lightning() { return cur.lightning; },
  };
  return api;
}
