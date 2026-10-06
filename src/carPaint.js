// carPaint.js — per-vehicle paint colour.
//
// WHY THIS EXISTS
//
// Every vehicle in the game came out the same orange. The cause is not a palette
// that was picked badly, it is that there IS no palette: graphics.js:622 tags a
// material as `paint` from its mesh name and then sets PBR properties
// (metalness 0.75, roughness 0.26, clearcoat 1) — but never a colour. The colour
// therefore comes entirely from the Kenney texture baked into the model, and every
// car in the pack shares it. The material is a car-paint *finish* with no
// car-paint *colour*, so all cars look identical.
//
// This module supplies the missing half: a per-vehicle HSL paint override applied
// to the tintable paint materials only.
//
// WHY HSL AND NOT RGB SLIDERS
//
// The human asked for "hue, saturation and contrast". Hue is the channel that
// matters and the only one RGB can express badly: to get "the same red, but
// darker" in RGB you drag all three channels down together and the hue ROTATES
// visibly (a pure red slid toward black goes muddy brown). HSL holds the hue
// fixed and moves lightness, which is what a paint chip actually does. So the
// three controls are HUE (0-360), SATURATION (0-100) and CONTRAST (0-100), and
// LIGHTNESS is deliberately NOT exposed as a fourth slider: in HSL, saturation and
// lightness are coupled, and a 4th slider would let the player author colours that
// clip. Saturation and contrast give the range a paint menu needs without that.
//
// REAL CAR PAINT, NOT HSV ARCS
//
// The random picker deliberately does NOT sample hue uniformly. A uniform pick puts
// as many cars in sickly yellow-green as in red, and a parking lot of uniformly
// random hues looks like a toy. Real car paint clusters: blacks, whites, greys and
// silvers dominate, then reds and blues, and the vivid greens and magentas are rare.
// So the picker is a weighted set of real-world paint families (see PAINT_FAMILIES)
// with per-family saturation/lightness ranges, and hue jitter WITHIN the family.
// That is the whole difference between "random colours" and "a car park".

/** Clamp helper. Values arrive from sliders and from save data, so never trust them. */
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export const DEFAULT_PAINT = Object.freeze({ hue: 28, sat: 62, contrast: 18 });

/**
 * Real-world automotive paint families, weighted by roughly how often each turns up
 * on a real road. `w` is the weight, `h` the hue centre in degrees, and `hj` the
 * jitter allowed around it, so a "red" car can be any of crimson through rust
 * without wandering into brown mud.
 */
export const PAINT_FAMILIES = Object.freeze([
  // neutrals dominate on a real road
  { name: "black",      w: 16, h: 220, hj: 14, s: [4, 14],  c: [22, 40] },
  { name: "white",      w: 13, h: 210, hj: 20, s: [2, 10],  c: [10, 24] },
  { name: "silver",     w: 11, h: 208, hj: 10, s: [3, 9],   c: [14, 30] },
  { name: "grey",       w: 10, h: 215, hj: 25, s: [2, 8],   c: [12, 30] },
  { name: "gunmetal",   w: 4,  h: 225, hj: 15, s: [6, 16],  c: [18, 36] },
  // then the common colours
  { name: "blue",       w: 12, h: 215, hj: 20, s: [48, 80], c: [28, 50] },
  { name: "navy",       w: 6,  h: 222, hj: 12, s: [38, 66], c: [22, 40] },
  { name: "red",        w: 11, h: 355, hj: 14, s: [58, 88], c: [30, 55] },
  { name: "burgundy",   w: 4,  h: 348, hj: 10, s: [42, 68], c: [22, 40] },
  { name: "cream",      w: 6,  h: 42,  hj: 12, s: [10, 24], c: [12, 26] },
  { name: "brown",      w: 5,  h: 26,  hj: 10, s: [30, 55], c: [20, 38] },
  { name: "beige",      w: 3,  h: 36,  hj: 10, s: [16, 32], c: [14, 28] },
  { name: "green",      w: 4,  h: 130, hj: 20, s: [35, 70], c: [24, 44] },
  { name: "yellow",     w: 3,  h: 50,  hj: 12, s: [55, 85], c: [32, 55] },
  // vivid colours are rare, and orange is the rarest of all -- it is what every car
  // used to be, which is the entire complaint
  { name: "orange",     w: 1,  h: 28,  hj: 10, s: [60, 92], c: [34, 58] },
  { name: "purple",     w: 1,  h: 278, hj: 22, s: [40, 72], c: [24, 44] },
  { name: "teal",       w: 1,  h: 190, hj: 18, s: [40, 70], c: [24, 44] },
  { name: "magenta",    w: 1,  h: 315, hj: 18, s: [45, 75], c: [26, 46] },
]);

/** Random paint, drawn from the weighted families rather than a uniform hue. */
export function randomPaint(rng = Math.random) {
  const total = PAINT_FAMILIES.reduce((a, f) => a + f.w, 0);
  let r = rng() * total;
  let fam = PAINT_FAMILIES[0];
  for (const f of PAINT_FAMILIES) {
    r -= f.w;
    if (r <= 0) { fam = f; break; }
  }
  const range = (pair) => pair[0] + rng() * (pair[1] - pair[0]);
  return {
    hue: wrapHue(fam.h + (rng() * 2 - 1) * fam.hj),
    sat: Math.round(range(fam.s)),
    contrast: Math.round(range(fam.c)),
    family: fam.name,          // carried, not re-inferred -- see note on describePaint
  };
}

export function wrapHue(h) {
  const v = h % 360;
  return v < 0 ? v + 360 : v;
}

/**
 * Paint control as a THREE.Color multiplier.
 *
 * `contrast` is applied in RGB around 0.5 grey, because contrast is a property of
 * tonal separation, not of saturation. In HSL terms: low contrast pulls lightness
 * toward the mid grey (a chalky, faded, sun-bleached panel); high contrast pushes
 * lightness away from it (a deep, rich panel). That maps onto how paint actually
 * weathers, which is the point.
 */
export function paintToColor(paint, ColorCtor) {
  // Clamp ONCE, here, and use these clamped values for the early return too. The
  // first version clamped into local consts but then returned the RAW paint values on
  // the no-ColorCtor path, so sat: 900 came back as 900.
  // wrapHue FIRST, clamp second: wrapHue already normalises into 0..360, and clamping
  // before it pins 370 to 360 instead of 10. (Order matters here and I got it wrong.)
  const rawHue = Number(paint?.hue);
  const hue = wrapHue(Number.isFinite(rawHue) ? rawHue : 0);
  const sat = clamp(Number.isFinite(Number(paint?.sat)) ? Number(paint.sat) : DEFAULT_PAINT.sat, 0, 100);
  const contrast = clamp(Number.isFinite(Number(paint?.contrast)) ? Number(paint.contrast) : DEFAULT_PAINT.contrast, 0, 100);
  const s01 = sat / 100, c01 = contrast / 100;
  // A low-saturation colour has no hue to shift, so hue is deliberately not applied
  // to it -- otherwise the "black" and "silver" families would drift into whatever
  // hue the slider happened to be left on, which is exactly the bug where every
  // grey car turns faintly green.
  const base = ColorCtor ? new ColorCtor() : null;
  if (!base) return { hue, sat, contrast };
  base.setHSL(hue / 360, s01, 0.5);
  // contrast: remap 0..1 to -1..1 and scale the RGB distance from mid grey.
  const k = (c01 * 2 - 1) * 0.34;
  base.r = clamp(base.r + k, 0, 1);
  base.g = clamp(base.g + k, 0, 1);
  base.b = clamp(base.b + k, 0, 1);
  return base;
}

/**
 * A human label for the paint, for the respray UI and the distribution report.
 *
 * PREFERS `paint.family` when present, because inferring a name back out of a hue is
 * lossy: a red at 355 and a magenta at 350 are indistinguishable once all you have is
 * the hue, so a report built from describePaint() merged families and then blamed the
 * merger on the picker. Only falls back to hue bucketing for a hand-edited paint.
 */
export function describePaint(paint) {
  if (paint && typeof paint.family === "string" && paint.family) return paint.family;
  const hue = wrapHue(Number(paint?.hue) || 0);
  const sat = Number(paint?.sat) ?? 0;
  if (sat < 10) return hue < 60 || hue > 200 ? "Black" : "Silver";
  if (sat < 20) return "Grey";
  const names = [[15, "Red"], [40, "Orange"], [65, "Yellow"], [160, "Green"], [200, "Teal"],
    [250, "Blue"], [290, "Purple"], [360, "Magenta"]];
  for (const [lim, nm] of names) if (hue < lim) return nm;
  return "Red";
}
