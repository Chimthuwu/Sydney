// ---------------------------------------------------------------------------
// cityparts.js — the pieces of a metropolis: modern glass towers, art-deco towers, hotel slabs, and French Quarter rowhouses with balconies
// (human request, 2026-09-27: "very metropolis, very modern New Orleans type vibe" around the Crown Strip and the spawn strip).
//
//   const P = createCityParts(ctx, { occluders })
//   P.tower(group, x, z, w, d, h, variant)     variant 0 glass, 1 art deco, 2 hotel slab, 3 dark glass
//   P.rowhouses(group, x0, x1, z, side, seed)  a terrace of 2-3 storey stucco houses with iron balconies; `side` = +1 faces +z, -1 faces -z
//   P.plaza(group, x, z, w, d, seed)           paving, trees, benches, planters
//
// And, added for "it needs to look AND feel like New Orleans" (human request,
// 2026-10-01): the vocabulary that makes a skyline New Orleans rather than
// generic. Every one of these is a real local type, and the reason they are
// worth modelling separately is that they are all SHAPED DIFFERENTLY — a
// Creole townhouse is a narrow box with a deep gallery, a Garden District
// mansion is wide and low with a cast-iron roof, a shotgun house is 3 m wide
// and 20 m deep, and a Superdome is a 210 m drum. One "building" function
// cannot make a city that reads as anywhere in particular.
//
//   P.creole(group, x, z, w, side, seed, d)   two-storey Creole townhouse, d deep (8)
//                                             gallery on tall cast-iron columns
//   P.gothic(group, x, z, w, side, seed)      Garden District Italianate:
//                                             wide, bracketed, low-pitched roof
//   P.shotgun(group, x, z, side, seed)        the 3 x 20 m house, gallery above
//   P.midrise(group, x, z, w, d, h, seed)     8-20 m brick walk-up with a shop
//                                             front and a fire escape
//   P.garage(group, x, z, w, d, floors)       an open-deck parking structure
//   P.stadium(group, x, z, r)                 the Superdome: a drum and a lid
//   P.statue(group, x, z, who)                a monument on a plinth
//   P.fountain(group, x, z)                   a basin and a jet
//   P.bandstand(group, x, z)                  City Park's cast-iron bandstand
//   P.park(group, x, z, w, d, seed)           lawn, live oaks, a path, benches
//
// Everything is built into the `group` it is given (composer clusters cull by distance), with shared materials so batchStatic can merge them.
// ---------------------------------------------------------------------------

import * as THREE from "three";

const PASTELS = [0xd98e73, 0xe8c98a, 0x9cc7b4, 0xc9a0c7, 0xe6b0a0, 0x8fb3d9, 0xefe4cf, 0xd9c27a];
// Garden District and the Marigny run on a different palette from the Quarter:
// deeper, dirtier, less of the Caribbean pink. Same city, different streets.
const GARDEN = [0xe4dccb, 0xd6cbb2, 0xc9b89a, 0xe8e2d2, 0xbfae90, 0xdcd0b8];
const hashf = (a, b, c = 0) => { let h = (a * 374761393 + b * 668265263 + c * 1442695041) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967295; };

export function createCityParts(ctx, { occluders = [] } = {}) {
  const { addBlocker } = ctx;
  const mats = new Map();
  const std = (color, name, o = {}) => {
    const k = name + color + JSON.stringify(o);
    if (!mats.has(k)) { const m = new THREE.MeshStandardMaterial({ color, name, roughness: 0.85, ...o }); m.userData.gtbRealized = true; mats.set(k, m); }
    return mats.get(k);
  };
  const basic = (color) => { const k = "b" + (color.getHex ? color.getHex() : color); if (!mats.has(k)) { const m = new THREE.MeshBasicMaterial({ color }); m.userData.gtbRealized = true; mats.set(k, m); } return mats.get(k); };

  // ---- window textures: 4 bays x 4 floors per tile, some lit
  const canvasTile = (bg, lit, dark, prob, seed, fins = false) => {
    const cv = document.createElement("canvas"); cv.width = cv.height = 128;
    const g = cv.getContext("2d");
    g.fillStyle = bg; g.fillRect(0, 0, 128, 128);
    for (let cy = 0; cy < 4; cy++) for (let cx = 0; cx < 4; cx++) {
      g.fillStyle = hashf(cx + seed * 7, cy, seed) < prob ? lit : dark;
      g.fillRect(cx * 32 + 5, cy * 32 + 7, 22, 18);
    }
    g.fillStyle = "rgba(255,255,255,0.07)"; for (let cy = 0; cy < 4; cy++) g.fillRect(0, cy * 32 + 1, 128, 2);
    if (fins) { g.fillStyle = "rgba(240,225,190,0.55)"; for (let cx = 0; cx < 4; cx++) g.fillRect(cx * 32 + 1, 0, 3, 128); }        // art-deco piers
    const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    return t;
  };
  const facade = (name, tex, emissive) => {
    const m = new THREE.MeshStandardMaterial({ name, map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: emissive, roughness: 0.3, metalness: 0.45 });
    m.userData.gtbRealized = true;
    return m;
  };
  const F = {
    glass: [0, 1, 2].map((v) => facade("glass tower facade", canvasTile(["#182430", "#1f2c38", "#1a2028"][v], ["#ffd89a", "#bfe6ff", "#fff1c8"][v], "#0b1118", [0.5, 0.32, 0.6][v], v), 0.55)),
    deco: [0, 1].map((v) => facade("deco tower facade", canvasTile(["#6d6552", "#7a6f5a"][v], "#ffd28a", "#1a1712", [0.45, 0.35][v], 20 + v, true), 0.4)),
    slab: [0, 1].map((v) => facade("hotel slab facade", canvasTile(["#3a3f48", "#2e3540"][v], "#ffe3a8", "#10151c", [0.55, 0.4][v], 30 + v), 0.5)),
    dark: [0, 1].map((v) => facade("glass tower facade", canvasTile(["#10161d", "#141b24"][v], "#9ad0ff", "#070b10", [0.3, 0.42][v], 40 + v), 0.6)),
  };
  const capMat = std(0x3a3d40, "concrete roof", { roughness: 0.9 });
  const stoneMat = std(0xcfc6ae, "limestone");
  const spireMat = std(0x9aa0a6, "steel mast", { metalness: 0.8, roughness: 0.4 });
  const beaconMat = basic(new THREE.Color(0xff2a1a).multiplyScalar(3));
  const neonMats = [0xff4fb3, 0x2ee6ff, 0xffc23a, 0x9dff6a].map((c) => basic(new THREE.Color(c).multiplyScalar(2.4)));

  /** A box whose window texture tiles once per 12 m x 14.4 m (4 bays x 4 floors), so nothing stretches on a 100 m tower. */
  const facadeBox = (w, h, d) => {
    const g = new THREE.BoxGeometry(w, h, d), uv = g.attributes.uv, nrm = g.attributes.normal;
    for (let k = 0; k < uv.count; k++) {
      if (Math.abs(nrm.getY(k)) > 0.5) { uv.setXY(k, 0.1, 0.1); continue; }
      const across = Math.abs(nrm.getX(k)) > 0.5 ? d : w;
      uv.setXY(k, uv.getX(k) * (across / 12), uv.getY(k) * (h / 14.4));
    }
    return g;
  };
  const put = (parent, geo, mat, x, y, z, o = {}) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z);
    m.castShadow = o.cast !== false; m.receiveShadow = true; if (o.ry) m.rotation.y = o.ry;
    parent.add(m); return m;
  };

  /**
   * A hipped roof that actually fits the building under it.
   *
   * Two mistakes hide in the obvious version of this. First, a 4-sided cone's
   * radius is its CORNER-to-corner distance, not its width, so scaling one by
   * the footprint gives a roof several metres wider than the walls. Second —
   * and this is the one that survives a casual look — three.js composes a mesh
   * transform as T * R * S, so a non-uniform scale is applied BEFORE the
   * rotation. Rotating a diamond into a square and then scaling it to a
   * non-square rectangle does not work: the 45-degree turn mixes the width back
   * into the depth, and a 8 x 9 m house gets eaves that reach 4.5 m sideways.
   *
   * So the turn is baked into the GEOMETRY, which puts the eaves axis-aligned
   * and leaves the mesh scale as a plain non-uniform scale of an already-square
   * shape. cos(45) = 0.707 is the half-width of the turned unit cone.
   */
  const SQRT1_2 = Math.SQRT1_2;
  function hipRoof(parent, w, d, h, mat, y) {
    const geo = new THREE.ConeGeometry(1, 1, 4).rotateY(Math.PI / 4);
    const roof = put(parent, geo, mat, 0, y + h / 2, 0);
    roof.scale.set(w * SQRT1_2, h, d * SQRT1_2);
    return roof;
  }
  const solid = (x, z, w, d) => { if (addBlocker) for (const [bx, bz] of [[-w / 4, -d / 4], [w / 4, -d / 4], [-w / 4, d / 4], [w / 4, d / 4], [0, 0]]) addBlocker(x + bx, z + bz, Math.min(w, d) / 3); };
  const occlude = (x, z, w, d, h) => occluders.push({ minX: x - w / 2, maxX: x + w / 2, minY: 0, maxY: h + 1.2, minZ: z - d / 2, maxZ: z + d / 2 });

  // ------------------------------------------------------------------ towers
  function tower(g, x, z, w, d, h, variant = 0, seed = 0) {
    const grp = new THREE.Group(); grp.position.set(x, 0, z); g.add(grp);
    const pick = (arr) => arr[Math.floor(hashf(x, z, seed + 5) * arr.length)];
    if (variant === 1) {
      // ART DECO: a wide base, three setbacks each narrower, a stone crown with a spire — the Hibernia / Pontchartrain look
      const mat = pick(F.deco);
      let y = 0, cw = w, cd = d;
      const tiers = [[0.34, 1], [0.3, 0.8], [0.22, 0.6], [0.14, 0.4]];
      for (const [frac, sc] of tiers) {
        const th = Math.max(6, h * frac); cw = w * sc; cd = d * sc;
        put(grp, facadeBox(cw, th, cd), mat, 0, y + th / 2, 0);
        put(grp, new THREE.BoxGeometry(cw + 1.2, 0.8, cd + 1.2), stoneMat, 0, y + th + 0.4, 0);       // a stone cornice at every setback
        y += th + 0.8;
      }
      put(grp, new THREE.CylinderGeometry(0.15, 0.6, 16 + h * 0.1, 6), spireMat, 0, y + 8 + h * 0.05, 0);
      put(grp, new THREE.SphereGeometry(0.55, 8, 6), beaconMat, 0, y + 16 + h * 0.1, 0, { cast: false });
    } else if (variant === 2) {
      // HOTEL SLAB: long, lower, banded balconies and a lit rooftop sign
      const mat = pick(F.slab);
      put(grp, facadeBox(w * 1.25, h * 0.14, d * 1.1), mat, 0, h * 0.07, 0);
      put(grp, facadeBox(w, h * 0.86, d * 0.55), mat, 0, h * 0.14 + h * 0.43, -d * 0.12);
      put(grp, new THREE.BoxGeometry(w + 0.6, 1.0, d * 0.55 + 0.6), capMat, 0, h + 0.5, -d * 0.12);
      put(grp, new THREE.BoxGeometry(w * 0.6, 2.4, 0.6), neonMats[Math.floor(hashf(x, z, 3) * neonMats.length)], 0, h + 2.4, -d * 0.12 + d * 0.28, { cast: false });
      for (let y = 6; y < h; y += 3.6 * 2) put(grp, new THREE.BoxGeometry(w + 0.4, 0.22, 1.1), stoneMat, 0, y, d * 0.16, { cast: false });
    } else {
      // MODERN GLASS: podium, a stepped shaft, a crown, mast and aviation light
      const mat = variant === 3 ? pick(F.dark) : pick(F.glass);
      const podium = Math.max(10, h * 0.16), shaft = h * 0.64, crown = h - podium - shaft;
      put(grp, facadeBox(w, podium, d), mat, 0, podium / 2, 0);
      put(grp, facadeBox(w * 0.82, shaft, d * 0.82), mat, 0, podium + shaft / 2, 0);
      put(grp, facadeBox(w * 0.58, crown, d * 0.58), mat, 0, podium + shaft + crown / 2, 0);
      for (const [y, sw, sd] of [[podium, w * 0.9, d * 0.9], [podium + shaft, w * 0.7, d * 0.7], [h, w * 0.62, d * 0.62]]) put(grp, new THREE.BoxGeometry(sw, 0.9, sd), capMat, 0, y + 0.45, 0);
      put(grp, new THREE.CylinderGeometry(0.18, 0.45, 12 + h * 0.08, 6), spireMat, 0, h + 6 + h * 0.04, 0);
      put(grp, new THREE.SphereGeometry(0.5, 8, 6), beaconMat, 0, h + 12 + h * 0.08, 0, { cast: false });
    }
    // a neon-edged ground floor: shops and a lobby glowing at street level
    const glow = neonMats[Math.floor(hashf(z, x, 9) * neonMats.length)];
    put(grp, new THREE.BoxGeometry(w * 0.7, 0.35, 0.3), glow, 0, 4.4, d / 2 + 0.2, { cast: false });
    put(grp, new THREE.BoxGeometry(w * 0.7, 0.35, 0.3), glow, 0, 4.4, -d / 2 - 0.2, { cast: false });
    solid(x, z, w, d); occlude(x, z, w, d, h);
    return grp;
  }

  // ------------------------------------------------------------------ French Quarter rowhouses
  const iron = () => std(0x1c1f22, "wrought iron railing", { metalness: 0.6, roughness: 0.5 });
  const trimM = () => std(0xf2eee4, "trim wood", { roughness: 0.7 });
  const shutterM = (i) => std([0x2f5a44, 0x1f3a5a, 0x5a2f2f, 0x2f2f2f][i % 4], "shutter wood");
  const litWin = () => basic(new THREE.Color(0xffc27a).multiplyScalar(1.4));
  const darkWin = () => basic(0x17202a);
  function rowhouse(g, x, z, w, side, floors, colorIdx, seed) {
    const h = floors * 3.3 + 0.6, d = 9;
    const grp = new THREE.Group(); grp.position.set(x, 0, z); grp.rotation.y = side < 0 ? Math.PI : 0; g.add(grp);
    const wall = std(PASTELS[colorIdx % PASTELS.length], "stucco wall");
    put(grp, new THREE.BoxGeometry(w, h, d), wall, 0, h / 2, 0);
    put(grp, new THREE.BoxGeometry(w + 0.4, 0.5, d + 0.4), trimM(), 0, h + 0.25, 0);
    // a hipped roof and a chimney, for the skyline
    hipRoof(grp, w + 0.5, d + 0.5, 1.6, std(0x5a4a44, "roof tile"), h + 0.5);
    for (let f = 0; f < floors; f++) {
      const y = 1.9 + f * 3.3;
      for (const wx of [-w * 0.28, w * 0.28]) {
        put(grp, new THREE.BoxGeometry(1.2, 2.0, 0.1), hashf(x + wx, f, seed) < 0.55 ? litWin() : darkWin(), wx, y, d / 2 + 0.02, { cast: false });
        put(grp, new THREE.BoxGeometry(0.45, 2.1, 0.08), shutterM(colorIdx), wx - 0.85, y, d / 2 + 0.05, { cast: false });
        put(grp, new THREE.BoxGeometry(0.45, 2.1, 0.08), shutterM(colorIdx), wx + 0.85, y, d / 2 + 0.05, { cast: false });
      }
      if (f > 0) {
        put(grp, new THREE.BoxGeometry(w - 0.4, 0.18, 1.3), trimM(), 0, y - 1.15, d / 2 + 0.65);
        put(grp, new THREE.BoxGeometry(w - 0.4, 0.07, 0.07), iron(), 0, y - 0.1, d / 2 + 1.25, { cast: false });
        const bal = Math.max(4, Math.round(w / 0.9));
        for (let b = 0; b <= bal; b++) put(grp, new THREE.BoxGeometry(0.05, 1.0, 0.05), iron(), -w / 2 + 0.3 + b * (w - 0.6) / bal, y - 0.6, d / 2 + 1.25, { cast: false });
      }
    }
    // a gaslight by the door
    put(grp, new THREE.SphereGeometry(0.22, 8, 6), basic(new THREE.Color(0xffd08a).multiplyScalar(2.2)), w * 0.42, 3.0, d / 2 + 0.3, { cast: false });
    occluders.push({ minX: x - w / 2, maxX: x + w / 2, minY: 0, maxY: h + 0.5, minZ: z - d / 2 - 1.3, maxZ: z + d / 2 + 1.3 });
    if (addBlocker) { addBlocker(x - w / 4, z, Math.min(w / 2, d / 2)); addBlocker(x + w / 4, z, Math.min(w / 2, d / 2)); }
    return grp;
  }
  /** A terrace along x0..x1 at depth z, houses 6-10 m wide, 2-3 floors, colours running along the block. */
  function rowhouses(g, x0, x1, z, side = 1, seed = 0) {
    let x = x0, i = 0;
    while (x < x1 - 5) {
      const w = Math.min(x1 - x, 6.5 + Math.floor(hashf(x, z, seed) * 4));
      if (w < 5.5) break;
      rowhouse(g, x + w / 2, z, w, side, 2 + (hashf(x, z, seed + 1) < 0.45 ? 1 : 0), Math.floor(hashf(x, z, seed + 2) * PASTELS.length) + i, seed);
      x += w; i++;
    }
  }

  // ------------------------------------------------------------------ plaza
  function plaza(g, x, z, w, d, seed = 0) {
    put(g, new THREE.BoxGeometry(w, 0.12, d), std(0xa9a397, "paving stone", { roughness: 0.95 }), x, 0.06, z, { cast: false });
    const leaf = std(0x2f5a34, "live oak leaves foliage"), trunk = std(0x4a3a28, "trunk bark");
    for (const [fx, fz] of [[-0.32, -0.3], [0.32, -0.3], [-0.32, 0.3], [0.32, 0.3]]) {
      const tx = x + fx * w, tz = z + fz * d;
      put(g, new THREE.CylinderGeometry(0.28, 0.4, 3, 6), trunk, tx, 1.6, tz);
      put(g, new THREE.SphereGeometry(2.6, 8, 6), leaf, tx, 4.4, tz).scale.set(1, 0.75, 1);
      if (addBlocker) addBlocker(tx, tz, 0.8);
    }
    put(g, new THREE.BoxGeometry(2.4, 0.5, 0.7), std(0x5a4632, "wood bench plank"), x, 0.35, z - d * 0.12, { cast: false });
    put(g, new THREE.BoxGeometry(2.4, 0.5, 0.7), std(0x5a4632, "wood bench plank"), x, 0.35, z + d * 0.12, { cast: false });
  }

  // ------------------------------------------------------------------ New Orleans
  //
  // Everything below is a real local building type rather than a variation on
  // the tower. That is the point: a city is recognisable by its stock, and the
  // stock here is galleries and shotgun houses and cast-iron, not setbacks.

  const castIron = () => std(0x22262a, "cast iron", { metalness: 0.55, roughness: 0.55 });
  const brick = () => std(0x7a4a38, "brick", { roughness: 0.92 });
  const cypress = () => std(0xb9a179, "painted cypress", { roughness: 0.75 });

  /** A colonnade of slender columns carrying a deep gallery — the Creole signature. */
  function gallery(grp, w, d, y, cols, mat) {
    const step = w / cols;
    for (let i = 0; i < cols; i++) {
      const x = -w / 2 + step * (i + 0.5);
      put(grp, new THREE.CylinderGeometry(0.09, 0.09, y, 8), mat, x, y / 2, d / 2 - 0.35, { cast: false });
    }
    // the floor of the gallery, the beam, and the railing above it
    put(grp, new THREE.BoxGeometry(w, 0.16, d * 0.55), mat, 0, y + 0.08, d / 2 - d * 0.275, { cast: false });
    put(grp, new THREE.BoxGeometry(w, 0.12, 0.12), mat, 0, y + 1.02, d / 2 - 0.35, { cast: false });
    for (let i = 0; i <= cols * 3; i++) {
      put(grp, new THREE.BoxGeometry(0.04, 0.9, 0.04), mat, -w / 2 + (w / (cols * 3)) * i, y + 0.55, d / 2 - 0.35, { cast: false });
    }
  }

  /**
   * A Creole townhouse: two storeys of stucco behind a veranda that runs the full
   * width, with the upper floor projecting over the street on brackets. The
   * projection is what makes it Creole rather than colonial — these were built
   * to shade the gallery from a sun that comes straight down on a 9 m street.
   */
  function creole(g, x, z, w, side = 1, seed = 0, d = 8) {
    const h1 = 3.8, h2 = 3.2;
    const grp = new THREE.Group();
    grp.position.set(x, 0, z);
    grp.rotation.y = side < 0 ? Math.PI : 0;
    g.add(grp);
    const wall = std(PASTELS[Math.floor(hashf(x, z, seed) * PASTELS.length)], "creole stucco");
    put(grp, new THREE.BoxGeometry(w, h1, d), wall, 0, h1 / 2, 0);
    // the upper floor, overhanging by a metre on iron brackets
    put(grp, new THREE.BoxGeometry(w, h2, d + 1.0), wall, 0, h1 + h2 / 2, 0.5);
    const iron = castIron();
    for (const bx of [-w / 2 + 0.4, 0, w / 2 - 0.4]) {
      put(grp, new THREE.BoxGeometry(0.12, 0.7, 1.1), iron, bx, h1 - 0.35, d / 2 + 0.55, { cast: false });
    }
    gallery(grp, w, d + 1.0, h1 + h2, Math.max(3, Math.round(w / 1.5)), iron);
    // a hipped roof over the whole thing
    hipRoof(grp, w, d + 1.0, 1.5, std(0x4e3f38, "slate roof"), h1 + h2);
    for (let f = 0; f < 2; f++) {
      const y = 1.7 + f * 3.5;
      for (const wx of [-w * 0.26, w * 0.26]) {
        put(grp, new THREE.BoxGeometry(1.1, 1.9, 0.1), hashf(x + wx, f, seed) < 0.6 ? litWin() : darkWin(), wx, y, d / 2 + 0.02, { cast: false });
        put(grp, new THREE.BoxGeometry(0.4, 2.0, 0.08), shutterM(Math.floor(hashf(x, f, seed))), wx - 0.78, y, d / 2 + 0.05, { cast: false });
        put(grp, new THREE.BoxGeometry(0.4, 2.0, 0.08), shutterM(Math.floor(hashf(x, f, seed + 1))), wx + 0.78, y, d / 2 + 0.05, { cast: false });
      }
    }
    // the famous doorway: a recessed double door with a transom above it
    put(grp, new THREE.BoxGeometry(1.5, 2.4, 0.12), cypress(), 0, 1.2, d / 2 + 0.04, { cast: false });
    put(grp, new THREE.BoxGeometry(1.1, 0.5, 0.1), litWin(), 0, 2.65, d / 2 + 0.04, { cast: false });
    occluders.push({ minX: x - w / 2, maxX: x + w / 2, minY: 0, maxY: h1 + h2 + 2.5, minZ: z - d / 2 - 0.6, maxZ: z + d / 2 + 2.2 });
    if (addBlocker) { addBlocker(x - w / 4, z, Math.min(w / 2, d / 2)); addBlocker(x + w / 4, z, Math.min(w / 2, d / 2)); }
    return grp;
  }

  /**
   * A Garden District Italianate: wide, two storeys, bracketed cornice, low
   * hipped roof. Built for theouzays on the nicer side of town, so it is the
   * opposite of the shotgun in every dimension — twice the width, a fifth of the
   * depth. That contrast along one street is what the Garden District is.
   */
  function gothic(g, x, z, w, side = 1, seed = 0) {
    const d = 11, h1 = 4.4, h2 = 3.6;
    const grp = new THREE.Group();
    grp.position.set(x, 0, z);
    grp.rotation.y = side < 0 ? Math.PI : 0;
    g.add(grp);
    const wall = std(GARDEN[Math.floor(hashf(x, z, seed) * GARDEN.length)], "garden stucco");
    const trim = std(0xf4f0e6, "cast stone trim", { roughness: 0.7 });
    put(grp, new THREE.BoxGeometry(w, h1, d), wall, 0, h1 / 2, 0);
    put(grp, new THREE.BoxGeometry(w, h2, d), wall, 0, h1 + h2 / 2, 0);
    // bracketed cornice: the Italianate signature, and the thing that reads at
    // any distance because it draws a hard line under the roof
    put(grp, new THREE.BoxGeometry(w + 0.7, 0.55, d + 0.7), trim, 0, h1 + h2 + 0.27, 0, { cast: false });
    for (let i = 0; i < Math.round(w / 0.9); i++) {
      put(grp, new THREE.BoxGeometry(0.28, 0.5, 0.5), trim, -w / 2 + 0.45 + i * 0.9, h1 + h2 - 0.1, d / 2 + 0.3, { cast: false });
    }
    hipRoof(grp, w + 0.7, d + 0.7, 1.7, std(0x3f3a36, "low hip roof"), h1 + h2 + 0.55);
    // tall narrow arched windows, the other half of the look
    for (let f = 0; f < 2; f++) {
      const y = 2.2 + f * 3.9;
      const n = Math.max(2, Math.floor(w / 2.4));
      for (let i = 0; i < n; i++) {
        const wx = -w / 2 + (w / n) * (i + 0.5);
        const on = hashf(x + wx, f, seed) < 0.6;
        put(grp, new THREE.BoxGeometry(1.0, 2.3, 0.1), on ? litWin() : darkWin(), wx, y, d / 2 + 0.02, { cast: false });
        put(grp, new THREE.BoxGeometry(0.5, 2.4, 0.12), trim, wx - 0.75, y, d / 2 + 0.05, { cast: false });
        put(grp, new THREE.BoxGeometry(0.5, 2.4, 0.12), trim, wx + 0.75, y, d / 2 + 0.05, { cast: false });
        // segmental arch over the head
        put(grp, new THREE.CylinderGeometry(0.5, 0.5, 0.16, 10, 1, false, 0, Math.PI), trim, wx, y + 1.15, d / 2 + 0.05, { cast: false, ry: Math.PI / 2 });
      }
    }
    put(grp, new THREE.BoxGeometry(1.7, 2.9, 0.14), cypress(), 0, 1.45, d / 2 + 0.05, { cast: false });
    occluders.push({ minX: x - w / 2, maxX: x + w / 2, minY: 0, maxY: h1 + h2 + 1.5, minZ: z - d / 2 - 0.5, maxZ: z + d / 2 + 0.5 });
    if (addBlocker) { addBlocker(x, z, Math.min(w, d) / 2 - 1);
      for (let bx = -w / 3; bx <= w / 3; bx += w / 3) addBlocker(x + bx, z, Math.min(w / 6, d / 2 - 1)); }
    return grp;
  }

  /**
   * The shotgun house: about 3 m wide and 20 m deep, one room wide, gallery
   * above. Named for standing in one room and shooting out the back door, and
   * the whole reason it exists is the lot: on a 16 ft wide plot you could not
   * build anything with a corridor. Narrow and deep is not a stylistic choice
   * here, it is what the property does.
   */
  function shotgun(g, x, z, side = 1, seed = 0) {
    const w = 3.4, d = 18, h = 3.2;
    const grp = new THREE.Group();
    grp.position.set(x, 0, z);
    grp.rotation.y = side < 0 ? Math.PI : 0;
    g.add(grp);
    const wall = std(PASTELS[Math.floor(hashf(x, z, seed) * PASTELS.length)], "shotgun stucco");
    put(grp, new THREE.BoxGeometry(w, h, d), wall, 0, h / 2, 0);
    // the flat-roofed extension over the back half, which is what gives a
    // shotgun its stepped profile from the side
    put(grp, new THREE.BoxGeometry(w, h * 0.82, d * 0.45), wall, 0, h * 0.41, d * 0.275, { cast: false });
    put(grp, new THREE.BoxGeometry(w + 0.25, 0.2, d + 0.25), std(0x4a423c, "tar roof"), 0, h + 0.1, 0, { cast: false });
    gallery(grp, w + 0.6, 1.6, h, 2, castIron());
    for (let i = 0; i < 3; i++) {
      const zz = -d / 2 + 3 + i * 5.2;
      for (const sx of [-0.9, 0.9]) {
        put(grp, new THREE.BoxGeometry(0.9, 1.7, 0.1), hashf(x + sx, i, seed) < 0.55 ? litWin() : darkWin(), sx, 1.7, zz, { cast: false });
      }
    }
    put(grp, new THREE.BoxGeometry(1.2, 2.3, 0.12), cypress(), 0, 1.15, d / 2 + 0.04, { cast: false });
    occluders.push({ minX: x - w / 2, maxX: x + w / 2, minY: 0, maxY: h + 1.2, minZ: z - d / 2, maxZ: z + d / 2 + 1.0 });
    if (addBlocker) { addBlocker(x, z - d / 3, 1.5); addBlocker(x, z + d / 3, 1.5); addBlocker(x, z, 1.5); }
    return grp;
  }

  /**
   * A brick walk-up: the ordinary fabric between the landmarks. Eight to twenty
   * metres, a shop front at the pavement, a fire escape on the side, and a
   * parapet. This is the building that makes a downtown read as a downtown
   * rather than a few towers on a car park.
   */
  function midrise(g, x, z, w, d, h, seed = 0) {
    const grp = new THREE.Group();
    grp.position.set(x, 0, z);
    g.add(grp);
    const tone = [0x8a4a38, 0x9c5a42, 0x7a4436, 0xa06a4a, 0x6f4a3e][Math.floor(hashf(x, z, seed) * 5)];
    const wall = std(tone, "brick");
    const floors = Math.max(2, Math.round(h / 3.2));
    const fh = h / floors;
    put(grp, new THREE.BoxGeometry(w, h, d), wall, 0, h / 2, 0);
    // a stone base course, and a projecting cornice
    put(grp, new THREE.BoxGeometry(w + 0.3, 1.1, d + 0.3), std(0x8d8578, "stone base"), 0, 0.55, 0, { cast: false });
    put(grp, new THREE.BoxGeometry(w + 0.6, 0.6, d + 0.6), std(0xb3a894, "cornice"), 0, h + 0.3, 0, { cast: false });
    put(grp, new THREE.BoxGeometry(w + 0.2, 1.0, d + 0.2), wall, 0, h + 1.1, 0, { cast: false });   // parapet
    for (let f = 1; f < floors; f++) {
      const y = fh * f + fh * 0.55;
      const cols = Math.max(2, Math.floor(w / 2.6));
      for (let i = 0; i < cols; i++) {
        const wx = -w / 2 + (w / cols) * (i + 0.5);
        for (const zz of [d / 2 + 0.02, -d / 2 - 0.02]) {
          put(grp, new THREE.BoxGeometry(1.3, 1.9, 0.1), hashf(x + wx + zz, f, seed) < 0.55 ? litWin() : darkWin(), wx, y, zz, { cast: false });
          put(grp, new THREE.BoxGeometry(1.6, 0.16, 0.16), std(0xd8d2c4, "sill"), wx, y - 1.0, zz + (zz > 0 ? 0.02 : -0.02), { cast: false });
        }
      }
    }
    // the shop front: a lit window band and an awning at street level
    put(grp, new THREE.BoxGeometry(w * 0.8, 2.6, 0.12), litWin(), 0, 1.9, d / 2 + 0.08, { cast: false });
    put(grp, new THREE.BoxGeometry(w * 0.86, 0.14, 1.1), std(0x2f5a44, "awning"), 0, 3.4, d / 2 + 0.55, { cast: false });
    // a fire escape zigzagging the flank
    const iron = castIron();
    if (floors > 2) {
      for (let f = 1; f < floors; f++) {
        put(grp, new THREE.BoxGeometry(1.4, 0.1, 2.6), iron, w / 2 + 0.7, fh * f, 0, { cast: false });
        put(grp, new THREE.BoxGeometry(0.08, 1.0, 2.6), iron, w / 2 + 1.35, fh * f + 0.5, 0, { cast: false });
      }
      put(grp, new THREE.BoxGeometry(0.08, h * 0.9, 0.08), iron, w / 2 + 1.35, h * 0.5, 1.2, { cast: false });
      put(grp, new THREE.BoxGeometry(0.08, h * 0.9, 0.08), iron, w / 2 + 1.35, h * 0.5, -1.2, { cast: false });
    }
    solid(x, z, w, d);
    occlude(x, z, w, d, h);
    return grp;
  }

  /**
   * An open parking deck. Every American downtown has one and they are always
   * conspicuous; the horizontal banding and the open sides are what make it
   * read at distance as "not a building".
   */
  function garage(g, x, z, w, d, floors = 4, seed = 0) {
    const grp = new THREE.Group();
    grp.position.set(x, 0, z);
    g.add(grp);
    const fh = 2.9, h = floors * fh;
    const conc = std(0x9a968e, "parking concrete", { roughness: 0.95 });
    const dark = std(0x2a2a2c, "deck shadow");
    // a solid core, so it is not a see-through box
    put(grp, new THREE.BoxGeometry(w * 0.22, h + 3.4, d * 0.22), conc, 0, (h + 3.4) / 2, 0);
    for (let f = 0; f < floors; f++) {
      const y = f * fh;
      put(grp, new THREE.BoxGeometry(w, 0.45, d), conc, 0, y + fh, 0, { cast: false });
      put(grp, new THREE.BoxGeometry(w, 0.12, d), dark, 0, y + fh - 0.3, 0, { cast: false });
      // spandrel band at each level: the horizontal stripe that reads as a deck
      put(grp, new THREE.BoxGeometry(w, 0.75, 0.25), conc, 0, y + 0.5, d / 2, { cast: false });
      put(grp, new THREE.BoxGeometry(w, 0.75, 0.25), conc, 0, y + 0.5, -d / 2, { cast: false });
      put(grp, new THREE.BoxGeometry(0.25, 0.75, d), conc, w / 2, y + 0.5, 0, { cast: false });
      put(grp, new THREE.BoxGeometry(0.25, 0.75, d), conc, -w / 2, y + 0.5, 0, { cast: false });
    }
    // a ramp hint and a stair tower
    put(grp, new THREE.BoxGeometry(2.4, h, 2.4), conc, -w / 2 + 1.6, h / 2, d / 2 - 1.6, { cast: false });
    // cars parked on the decks. Not every bay has one — a full deck reads as a
    // car park, an empty one as a car park nobody uses, and the mix is the
    // difference between a structure in use and a diagram of one.
    const CAR_COLOURS = [0x8a2f2f, 0x2f4a8a, 0xb0b0b4, 0x3a5a3a, 0x2a2a2e, 0xd8d4c8];
    for (let f = 0; f < floors; f++) {
      for (let c = 0; c < Math.floor(w / 6); c++) {
        if (hashf(x, z, seed + f * 31 + c) < 0.35) continue;
        const cx = -w / 2 + 3 + c * 6;
        const colour = CAR_COLOURS[Math.floor(hashf(cx, f, seed) * CAR_COLOURS.length)];
        put(grp, new THREE.BoxGeometry(1.9, 1.3, 4.2), std(colour, "parked car"), cx, f * fh + 0.95, (hashf(cx, f, seed + 3) - 0.5) * d * 0.5, { cast: false });
      }
    }
    solid(x, z, w, d);
    occlude(x, z, w, d, h);
    return grp;
  }

  /**
   * The Superdome. A 210 m steel drum under a 210 m lid, on nine hundred acres
   * of parking — which is why it reads as an object alone on a flat plain rather
   * than as a building in a street. It is the single most recognisable silhouette
   * in the state and it is deliberately not a tower.
   */
  function stadium(g, x, z, r = 96) {
    const grp = new THREE.Group();
    grp.position.set(x, 0, z);
    g.add(grp);
    const wall = std(0xcfcabb, "stadium precast", { roughness: 0.85 });
    const bowlH = 32;
    put(grp, new THREE.CylinderGeometry(r, r * 1.04, bowlH, 40, 1, true), wall, 0, bowlH / 2, 0, { cast: true });
    // the raked seating bowl, visible above the outer wall as a dark band
    put(grp, new THREE.CylinderGeometry(r * 0.92, r * 0.55, 22, 40, 1, true), std(0x1c2026, "seating bowl"), 0, bowlH + 6, 0, { cast: false });
    // The roof: a shallow lid, and the whole silhouette. It has to be SHALLOW —
    // a sphere segment taken from the pole rises by its own radius, which put
    // 100 m of dome on a 32 m drum and turned the most recognisable building in
    // the state into the tallest one. The cap is flattened to a third of its own
    // rise, which is the proportion that reads as a lid rather than a ball.
    const lid = new THREE.Mesh(new THREE.SphereGeometry(r * 1.04, 40, 10, 0, Math.PI * 2, 0, 0.44), std(0xe8e6df, "stadium roof", { roughness: 0.8 }));
    lid.scale.set(1, 0.3, 1);
    lid.position.set(0, bowlH + 1, 0);
    lid.receiveShadow = true;
    grp.add(lid);
    const rise = r * 1.04 * 0.3;                 // how far the lid actually stands proud
    const roofY = bowlH + 1 + rise;
    // the ribs that read as structure from a long way off, sitting ON the lid
    // rather than through it
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const rib = put(grp, new THREE.BoxGeometry(1.6, 0.7, r * 0.86), std(0xd0cec6, "roof rib"), Math.cos(a) * r * 0.5, roofY - 3, Math.sin(a) * r * 0.5, { cast: false, ry: -a });
      rib.rotation.z = 0.2;
    }
    // the ring of pylons around the base, and the floodlight masts
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      put(grp, new THREE.BoxGeometry(2.2, bowlH + 8, 2.2), std(0xbfbcb2, "pylon"), Math.cos(a) * (r + 2.5), (bowlH + 8) / 2, Math.sin(a) * (r + 2.5), { cast: false });
    }
    // Floodlight masts. They are the tallest thing here and the reason the
    // silhouette has to be measured to the LID, not to the masts — a stadium
    // whose floodlights are its height is a lamp post with a roof on it.
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.4;
      const mx = Math.cos(a) * (r + 6), mz = Math.sin(a) * (r + 6);
      put(grp, new THREE.CylinderGeometry(0.7, 1.1, 38, 8), std(0x8a8f94, "light mast"), mx, 19, mz, { cast: false });
      put(grp, new THREE.BoxGeometry(5.0, 2.4, 0.8), std(0x2a2e33, "floodlight bank"), mx, 39, mz, { cast: false, ry: -a });
    }
    // the facade lettering, and the plaza it all stands on
    put(grp, new THREE.CylinderGeometry(r * 1.02, r * 1.02, 6, 40, 1, true), basic(new THREE.Color(0xd8b23a).multiplyScalar(1.3)), 0, 12, 0, { cast: false });
    put(grp, new THREE.CylinderGeometry(r + 26, r + 26, 0.12, 40), std(0xb4b0a6, "plaza paving", { roughness: 0.95 }), 0, 0.06, 0, { cast: false });
    if (addBlocker) for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      addBlocker(x + Math.cos(a) * r * 0.7, z + Math.sin(a) * r * 0.7, r * 0.2);
    }
    occluders.push({ minX: x - r, maxX: x + r, minY: 0, maxY: bowlH + 34, minZ: z - r, maxZ: z + r });
    return grp;
  }

  // ------------------------------------------------------------------ the civic furniture
  const bronze = () => std(0x4a5a3a, "bronze", { metalness: 0.7, roughness: 0.45 });
  const plinth = () => std(0xb0aa9c, "granite plinth", { roughness: 0.8 });

  /**
   * A monument. `kind` picks the silhouette, because a statue you can name and a
   * statue you cannot are worth the same triangles but not the same place.
   *   "soldier"  a column with a figure on top — the Confederate/De Lee kind
   *   "bronze"   a standing figure on a low plinth
   *   "pelican"  the city's emblem, on a tall granite shaft
   */
  function statue(g, x, z, kind = "bronze", seed = 0) {
    const grp = new THREE.Group();
    grp.position.set(x, 0, z);
    g.add(grp);
    const p = plinth(), b = bronze();
    const facing = hashf(x, z, seed) * Math.PI * 2;
    if (kind === "soldier") {
      put(grp, new THREE.BoxGeometry(5.4, 1.6, 5.4), p, 0, 0.8, 0);
      put(grp, new THREE.BoxGeometry(4.2, 9.0, 4.2), p, 0, 6.1, 0);
      put(grp, new THREE.CylinderGeometry(2.1, 1.9, 0.5, 12), p, 0, 10.8, 0, { cast: false });
      // the figure: a body, a head, and a raised arm. Rough, but the silhouette
      // against the sky is the whole point of a monument.
      put(grp, new THREE.CylinderGeometry(0.42, 0.55, 3.0, 8), b, 0, 12.6, 0, { cast: false });
      put(grp, new THREE.SphereGeometry(0.34, 8, 6), b, 0, 14.4, 0, { cast: false });
      put(grp, new THREE.CylinderGeometry(0.16, 0.16, 2.2, 6), b, 0.5, 13.9, 0.1, { cast: false }).rotation.z = -0.7;
      put(grp, new THREE.CylinderGeometry(0.16, 0.16, 1.9, 6), b, -0.45, 13.2, 0, { cast: false }).rotation.z = 0.25;
    } else if (kind === "pelican") {
      put(grp, new THREE.BoxGeometry(3.4, 1.2, 3.4), p, 0, 0.6, 0);
      put(grp, new THREE.BoxGeometry(2.4, 7.5, 2.4), p, 0, 4.9, 0);
      put(grp, new THREE.CylinderGeometry(1.5, 1.3, 0.4, 8), p, 0, 8.9, 0, { cast: false });
      // the pelican, wings out
      put(grp, new THREE.SphereGeometry(0.8, 8, 6), b, 0, 9.8, 0, { cast: false }).scale.set(1.4, 0.8, 0.8);
      for (const s of [-1, 1]) put(grp, new THREE.BoxGeometry(2.6, 0.12, 0.9), b, s * 1.5, 10.1, 0, { cast: false, ry: s * 0.3 });
    } else {
      put(grp, new THREE.BoxGeometry(3.0, 0.9, 3.0), p, 0, 0.45, 0, { ry: facing });
      put(grp, new THREE.BoxGeometry(2.0, 2.4, 2.0), p, 0, 2.1, 0);
      put(grp, new THREE.CylinderGeometry(0.4, 0.55, 2.6, 8), b, 0, 4.6, 0, { cast: false, ry: facing });
      put(grp, new THREE.SphereGeometry(0.32, 8, 6), b, 0, 6.1, 0, { cast: false });
      put(grp, new THREE.CylinderGeometry(0.14, 0.14, 2.0, 6), b, 0.42, 5.5, 0, { cast: false, ry: facing }).rotation.z = -0.5;
    }
    if (addBlocker) addBlocker(x, z, 2.2);
    return grp;
  }

  /** A basin and a jet. Parks are built around these; they read as a centre. */
  function fountain(g, x, z, r = 5) {
    const grp = new THREE.Group();
    grp.position.set(x, 0, z);
    g.add(grp);
    const stone = std(0xbfb8a8, "fountain stone", { roughness: 0.9 });
    put(grp, new THREE.CylinderGeometry(r, r + 0.3, 0.7, 20), stone, 0, 0.35, 0);
    const water = new THREE.Mesh(new THREE.CircleGeometry(r - 0.4, 20).rotateX(-Math.PI / 2),
      new THREE.MeshPhysicalMaterial({ color: 0x2a4a52, roughness: 0.08, clearcoat: 1, transparent: true, opacity: 0.85, name: "fountain water" }));
    water.userData.gtbRealized = true;
    water.position.y = 0.55;
    grp.add(water);
    put(grp, new THREE.CylinderGeometry(0.5, 0.9, 1.6, 10), stone, 0, 1.1, 0, { cast: false });
    put(grp, new THREE.SphereGeometry(0.7, 10, 8), stone, 0, 2.3, 0, { cast: false });
    // the jet itself, as a pale cone — a real particle system for a park feature
    // is not worth it, and this reads correctly from across the lawn
    put(grp, new THREE.ConeGeometry(0.5, 3.2, 8, 1, true), basic(new THREE.Color(0xd8f0f4).multiplyScalar(1.2)), 0, 4.2, 0, { cast: false });
    if (addBlocker) addBlocker(x, z, r * 0.7);
    return grp;
  }

  /**
   * City Park's bandstand: an octagonal cast-iron pavilion on a low deck. The
   * reason it matters is that it is where the park's music happens, so it is the
   * one piece of park furniture that has people standing around it.
   */
  function bandstand(g, x, z) {
    const grp = new THREE.Group();
    grp.position.set(x, 0, z);
    g.add(grp);
    const iron = castIron(), deck = std(0xa89a84, "bandstand deck", { roughness: 0.9 });
    put(grp, new THREE.CylinderGeometry(5.2, 5.6, 0.6, 8), deck, 0, 0.3, 0, { cast: false });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      put(grp, new THREE.CylinderGeometry(0.12, 0.12, 3.2, 8), iron, Math.cos(a) * 4.6, 2.1, Math.sin(a) * 4.6, { cast: false });
    }
    put(grp, new THREE.CylinderGeometry(5.4, 5.0, 0.3, 8), iron, 0, 3.8, 0, { cast: false });
    put(grp, new THREE.ConeGeometry(5.8, 2.6, 8), std(0x2f4a44, "bandstand roof"), 0, 5.2, 0);
    put(grp, new THREE.SphereGeometry(0.3, 8, 6), bronze(), 0, 6.7, 0, { cast: false });
    // the railing round the deck
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      put(grp, new THREE.BoxGeometry(0.05, 0.9, 0.05), iron, Math.cos(a) * 5.4, 1.0, Math.sin(a) * 5.4, { cast: false });
    }
    if (addBlocker) addBlocker(x, z, 5.4);
    return grp;
  }

  /**
   * A park: lawn, live oaks with Spanish moss, a path, benches. City Park is
   * 155 acres of exactly this — flat, green, and full of live oaks, which is why
   * New Orleans has no street grid that feels like anywhere else.
   */
  function park(g, x, z, w, d, seed = 0) {
    const grp = new THREE.Group();
    grp.position.set(x, 0, z);
    g.add(grp);
    put(grp, new THREE.BoxGeometry(w, 0.1, d), std(0x4e6b34, "park lawn", { roughness: 1 }), 0, 0.05, 0, { cast: false });
    // the paths, crossing — every park in the south is laid out on diagonals
    const path = std(0x9c9482, "park path", { roughness: 0.98 });
    put(grp, new THREE.BoxGeometry(w * 1.02, 0.03, 2.6), path, 0, 0.11, 0, { cast: false });
    put(grp, new THREE.BoxGeometry(2.6, 0.03, d * 1.02), path, 0, 0.11, 0, { cast: false });
    const leaf = std(0x335c2f, "live oak foliage"), bark = std(0x4e4033, "live oak bark");
    const n = Math.max(2, Math.floor((w * d) / 340));
    for (let i = 0; i < n; i++) {
      const tx = (hashf(x, z, seed + i * 3) - 0.5) * w * 0.86;
      const tz = (hashf(x, z, seed + i * 3 + 1) - 0.5) * d * 0.86;
      if (Math.abs(tx) < 3.5 && Math.abs(tz) < 3.5) continue;      // keep the paths clear
      const th = 0.85 + hashf(x, z, seed + i * 7) * 0.5;
      put(grp, new THREE.CylinderGeometry(0.32 * th, 0.5 * th, 3.4, 8), bark, tx, 1.7 * th, tz);
      // the broad, low, spreading crown of a live oak
      put(grp, new THREE.SphereGeometry(3.4 * th, 10, 7), leaf, tx, 5.0 * th, tz).scale.set(1.15, 0.72, 1.15);
      // Spanish moss: the detail that says Louisiana and nothing else
      if (hashf(x, z, seed + i * 11) < 0.7) {
        for (let k = 0; k < 3; k++) {
          const a = (k / 3) * Math.PI * 2 + hashf(tx, tz, k);
          put(grp, new THREE.CylinderGeometry(0.06, 0.02, 2.2 * th, 4), std(0x8a9a76, "spanish moss"), tx + Math.cos(a) * 2.2 * th, 4.1 * th, tz + Math.sin(a) * 2.2 * th, { cast: false });
        }
      }
      if (addBlocker) addBlocker(tx + x, tz + z, 0.9 * th);
    }
    const bench = std(0x5a4632, "park bench");
    for (const [bx, bz] of [[-w * 0.22, -3.4], [w * 0.22, -3.4], [-w * 0.22, 3.4], [w * 0.22, 3.4]]) {
      put(grp, new THREE.BoxGeometry(2.0, 0.12, 0.6), bench, bx, 0.55, bz, { cast: false });
      put(grp, new THREE.BoxGeometry(2.0, 0.6, 0.1), bench, bx, 0.85, bz - 0.28, { cast: false });
    }
    return grp;
  }

  return { tower, rowhouses, rowhouse, plaza, hash: hashf, creole, gothic, shotgun, midrise, garage, stadium, statue, fountain, bandstand, park };
}
