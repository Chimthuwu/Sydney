// ---------------------------------------------------------------------------
// worldtime.js — the one clock. Anything that cares what time it is asks here.
//
//   worldTime.getCurrentTime()   → { day, hour, minute }
//   worldTime.isNight()          → true (always — the world is night only, see below)
//   worldTime.dusk               → 1 (full night)
//   worldTime.onHour(fn)         → called with (hour, day) on every new hour
//
// NIGHT ONLY (human request 2026-10-01: "I want the game to just only have night
// time the day time is god awful looking"). The clock runs 21:00 → 04:00 and then
// wraps back to 21:00, counting the day up. daycycle.js still models a full sun
// arc — it is simply never handed a daytime hour — so the sky is the moon, the
// street lamps, the night fog and the ground mist for the whole game. A daylight
// hour asked for by `setTime` (a story beat, a QA script) is snapped to 21:00
// rather than honoured, and `isNight()` is therefore always true.
// ---------------------------------------------------------------------------

export const SECONDS_PER_DAY = 24 * 3600;

// the dusk ramp: light starts going at DUSK_START, full night by NIGHT_START,
// and it lifts again from DAWN_START to DAWN_END. DUSK_START/DAWN_* are kept for
// the ramp itself and for anything that reasons about it, but the clock below can
// no longer report an hour inside them.
export const DUSK_START = 18.5;
export const NIGHT_START = 21;
export const DAWN_START = 5;
export const DAWN_END = 7;

// the hours the world actually runs in: 21:00 through 04:00, then back to 21:00
export const NIGHT_ONLY_START = 21;
export const NIGHT_ONLY_END = 4;        // 04:00, counted past midnight
/** How much game time one loop of the night window is, in seconds (7 hours). */
export const NIGHT_WINDOW_SECONDS = (24 - NIGHT_ONLY_START + NIGHT_ONLY_END) * 3600;

/**
 * The absolute second-of-cycle for `hour`, clamped into the night window.
 * 21:00–23:59 stay where they are, 00:00–03:59 count past midnight, and anything
 * from 04:00 to 20:59 (i.e. daylight) is snapped to 21:00.
 */
function nightSeconds(hour) {
  const h = ((hour % 24) + 24) % 24;
  if (h >= NIGHT_ONLY_START) return h * 3600;
  if (h < NIGHT_ONLY_END) return (h + 24) * 3600;
  return NIGHT_ONLY_START * 3600;
}

/**
 * @param {object} o
 * @param {number} o.hour   starting hour (21:00 by default, when the game opens).
 *   Anything outside 21:00–04:00 is snapped to 21:00.
 * @param {number} o.day    starting day
 * @param {number} o.scale  game seconds per real second. The default keeps the
 *   old feel: 3.5 game hours takes ~10.4 real minutes, so one full night (7 game
 *   hours from 21:00 to 04:00) runs about 20.8 real minutes before it rolls over.
 */
export function createWorldTime({ hour = NIGHT_ONLY_START, day = 1, scale = (3.5 * 3600) / 625 } = {}) {
  let t = nightSeconds(hour);
  let d = day;
  let paused = false;
  const hourListeners = [];
  let prevHour = Math.floor(t / 3600) % 24;

  // the wall clock: 0 … 24 even while `t` runs past midnight to reach 04:00
  const hours = () => (t / 3600) % 24;
  const lastHour = () => Math.floor(hours());

  function darkness(h) {
    if (h >= NIGHT_START || h < DAWN_START) return 1;
    if (h >= DUSK_START) return (h - DUSK_START) / (NIGHT_START - DUSK_START);
    if (h < DAWN_END) return 1 - (h - DAWN_START) / (DAWN_END - DAWN_START);
    return 0;
  }

  return {
    /** Advance the clock (call once per frame with real seconds). */
    update(dt) {
      if (paused) return;
      t += dt * scale;
      // 04:00 rolls straight on to 21:00 on the next day: no sunrise, ever
      while (t >= (NIGHT_ONLY_END + 24) * 3600) { t -= NIGHT_WINDOW_SECONDS; d++; }
      const h = lastHour();
      if (h !== prevHour) {
        prevHour = h;
        for (const fn of hourListeners) fn(h, d);
      }
    },
    getCurrentTime() {
      const h = hours();
      return { day: d, hour: Math.floor(h), minute: Math.floor((h % 1) * 60) };
    },
    /** Hours as a float, 0 … 24. */
    get hours() { return hours(); },
    get day() { return d; },
    isNight() {
      const h = hours();
      return h >= NIGHT_START || h < DAWN_START;
    },
    /** 1 for the whole night window; the ramp is kept for the hours nothing reports now. */
    get dusk() { return darkness(hours()); },
    /** Jump the clock (QA, story beats). Daylight hours snap to 21:00. */
    setTime(hour, day = d) { t = nightSeconds(hour); d = day; prevHour = lastHour(); },
    get scale() { return scale; },
    set scale(s) { scale = Math.max(0, s); },
    get paused() { return paused; },
    set paused(p) { paused = !!p; },
    onHour(fn) { hourListeners.push(fn); },
    /** "21:00" */
    label() {
      const { hour: h, minute: m } = this.getCurrentTime();
      return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    },
  };
}
