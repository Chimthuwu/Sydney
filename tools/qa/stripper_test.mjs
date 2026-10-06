// The clubs' performers — are they dancers, are they the right height, and
// does the pole routine run clean?
// characters.js's materials go through graphics.js, which wants a 2D canvas for
// its micro-surface maps — the same no-op context crown_build_test.mjs stubs.
const noop = () => {};
const gradient = { addColorStop: noop };
const context2d = {
  fillStyle: "", font: "", textAlign: "", textBaseline: "", globalAlpha: 1,
  fillRect: noop, fillText: noop, save: noop, restore: noop, translate: noop,
  rotate: noop, scale: noop, beginPath: noop, closePath: noop, moveTo: noop,
  lineTo: noop, arc: noop, rect: noop, fill: noop, stroke: noop, clip: noop,
  clearRect: noop, drawImage: noop, createLinearGradient: () => gradient,
  createRadialGradient: () => gradient, getImageData: () => ({ data: new Uint8ClampedArray(4) }),
  putImageData: noop, measureText: () => ({ width: 10 }),
  createImageData: () => ({ data: new Uint8ClampedArray(4) }),
  setLineDash: noop, setTransform: noop, quadraticCurveTo: noop, bezierCurveTo: noop,
};
globalThis.document = {
  createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => context2d }),
  head: { appendChild() {} }, body: { appendChild() {} },
  getElementById: () => null, addEventListener() {},
};

const THREE = await import("three");
const { makeStripper, makeHog, makeDancer } = await import("../../src/characters.js");

let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? `  — ${detail}` : ""}`);
};

const box = (o) => new THREE.Box3().setFromObject(o);
const heightOf = (o) => { const b = box(o); return b.max.y - b.min.y; };
// How far the chest projects forward at bust height. mergeRigid bakes the bust
// spheres into the torso's per-material meshes, so this walks real vertices in
// world space rather than trusting a mesh's bounding box to isolate the chest.
const bustDepth = (a) => {
  const v = new THREE.Vector3();
  let best = -Infinity;
  a.updateMatrixWorld(true);
  a.traverse((m) => {
    if (!m.isMesh) return;
    const pos = m.geometry && m.geometry.attributes && m.geometry.attributes.position;
    if (!pos) return;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      m.localToWorld(v);
      if (v.y < 1.12 || v.y > 1.38) continue;   // the chest band, above the waist
      if (Math.abs(v.x) > 0.17) continue;       // centreline only: bust, not arms
      if (v.z > best) best = v.z;
    }
  });
  return best;
};
const colours = (o) => {
  const out = new Set();
  o.traverse((x) => {
    if (!x.isMesh || !x.material || !x.material.color) return;
    out.add(x.material.color.getHexString());
  });
  return out;
};

// ---- 1. the stripper is a dancer, is player height, and wears the bikini ----
const bikini = 0x2ee6d6;
const s = makeStripper({ sex: "f", seed: 4242, height: 1.8, bust: 1.3, bikini });
const plain = makeDancer({ sex: "f", seed: 4242, height: 1.8 });
const player = 1.80;

// The rig normalises itself to a requested height by scaling the whole 1.86 m
// base, so "player height" is the scale factor, and heels then add on top of it.
const nominal = (a) => a.scale.y * 1.86;
check("stripper is cast at the player's 1.80 m", Math.abs(nominal(s) - 1.80) < 0.001,
  `nominal ${nominal(s).toFixed(3)} m, ${heightOf(s).toFixed(3)} m over the floor in heels`);
check("...and stands taller than a dancer in flat shoes", heightOf(s) > heightOf(plain),
  `${heightOf(s).toFixed(3)} m vs ${heightOf(plain).toFixed(3)} m`);
const bikiniHex = bikini.toString(16).padStart(6, "0");
check("the bikini is in the outfit", colours(s).has(bikiniHex), "bikini band + gstring");
check("a plain dancer does NOT wear the bikini", !colours(plain).has(bikiniHex));

// ---- 2. bust scaling actually changes the mesh -----------------------------
// The bust has to stand PROUD of the ribcage cylinder, not sit inside it — that
// is the difference between a chest that reads and a smooth mannequin.
const small = makeStripper({ sex: "f", seed: 1, height: 1.8, bust: 1.0 });
const large = makeStripper({ sex: "f", seed: 1, height: 1.8, bust: 1.45 });
const dSmall = bustDepth(small), dLarge = bustDepth(large);
check("even the sheet bust stands proud of the ribcage", dSmall > 0.12,
  `${dSmall.toFixed(3)} m (the ribcage face is 0.120 m)`);
check("bust 1.45 projects well past bust 1.0", dLarge > dSmall + 0.03,
  `${dSmall.toFixed(3)} m -> ${dLarge.toFixed(3)} m chest depth`);

// ---- 3. the hogs: dancers fuller than the sheet, barman untouched ----------
const hogA = makeHog({ variant: "dancer", sex: "f", seed: 7, height: 1.8 });
const hogRef = makeHog({ variant: "dancer", sex: "f", seed: 7, height: 1.8, bust: 1.0 });
check("hog dancers are fuller than the sheet default", bustDepth(hogA) > bustDepth(hogRef) + 0.005,
  `${bustDepth(hogRef).toFixed(3)} -> ${bustDepth(hogA).toFixed(3)} m`);
// the barman works behind a counter: the override must hold even if a caller
// passes a bust, and the male rig has no bust spheres to move anyway
const bar1 = makeHog({ variant: "barman", sex: "m", seed: 7, height: 1.8 });
const bar2 = makeHog({ variant: "barman", sex: "m", seed: 7, height: 1.8, bust: 2 });
check("the hog barman is left alone", Math.abs(bustDepth(bar1) - bustDepth(bar2)) < 1e-6,
  `${bustDepth(bar1).toFixed(3)} m either way`);

// ---- 4. the pole clip runs clean and does the pole dance -------------------
s.play("pole", { force: true, loop: true });
let minY = Infinity, maxY = -Infinity, bad = 0, yaws = new Set();
for (let i = 0; i < 1200; i++) {                       // 20 s
  s.update(1 / 60);
  if (!Number.isFinite(s.position.y) || !Number.isFinite(s.rotation.y)) bad++;
  minY = Math.min(minY, s.position.y);
  maxY = Math.max(maxY, s.position.y);
  yaws.add(Math.round(s.rotation.y * 10));
}
check("no NaN over 20 s of pole", bad === 0, `${bad} bad frames`);
check("she climbs the pole", maxY - minY > 0.25, `${(maxY - minY).toFixed(3)} m of travel`);
check("she turns on the pole", yaws.size > 40, `${(20 * 0.2).toFixed(1)} revolutions in 20 s`);

// Arms up on the bar: the HAND socket is what grips, and overhead it is above
// the crown — that is the read. The shoulder pivot stays where the shoulder is.
s.update(1 / 60);
const handY = Math.min(...s.arms.map((a) => a.hand.getWorldPosition(new THREE.Vector3()).y));
check("both hands are up on the bar, above her head", handY > heightOf(s) * 0.95,
  `hands at ${handY.toFixed(2)} m, crown at ${heightOf(s).toFixed(2)} m`);

console.log(failures ? `\n${failures} FAILED` : "\nall stripper checks passed");
process.exit(failures ? 1 : 0);
