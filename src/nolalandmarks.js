// ---------------------------------------------------------------------------
// nolalandmarks.js — the places you can name.
//
//   const L = createNewOrleansLandmarks(ctx, { P, mesh, std, basic, plane, pick, claims })
//   L.build()
//
// "Make sure we have covered all the landmarks that would be present in New
// Orleans. Famous locations, historical locations, all need to be recognizable."
//
// Recognisable is the whole requirement, and it is a harder one than it looks.
// A generic tall building on a plaza is a building on a plaza. What makes
// Jackson Square Jackson Square is that the Cathedral has THREE steeples and
// the middle one is nearly twice the height of the other two, that the Cabildo
// and the Presbytère are the two low wings either side of it, and that the
// square itself is walled iron facing the river. Every landmark here is built
// around the specific thing that makes it that landmark rather than a type of
// building, and the ones that are famous mostly for being famous are the ones
// that needed the most care — the Superdome is a drum, not a tower, and St.
// Louis Cathedral is three spires, not one.
//
// Each landmark claims a whole block or a superblock BEFORE the district's own
// builders run, so none of them lands on top of something already built.
// ---------------------------------------------------------------------------

import * as THREE from "three";

/** A deterministic 0..1 hash, so a landmark is the same on every load. */
const hashf = (a, b, c = 0) => { let h = (a * 374761393 + b * 668265263 + c * 1442695041) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967295; };

/**
 * Where the landmarks go. Each one is a superblock in orlearouge.js's RESERVES
 * — a rect where the grid is taken out so the set piece has room. These are
 * chosen by geography, not scattered: Jackson Square is on the river in the
 * Quarter, because that is where it is; the Superdome is out past downtown on
 * the far side of the city where the parking is; City Park is inland and green.
 */
export const SITES = Object.freeze([
  { id: "jackson", label: "Jackson Square" },
  { id: "superdome", label: "The Superdome" },
  { id: "citypark", label: "City Park" },
  { id: "university", label: "Loyola University" },
  { id: "market", label: "French Market" },
]);

export function createNewOrleansLandmarks(ctx, kit) {
  const { P, mesh, std, basic, pois, occluders, sign } = kit;
  const { addBlocker } = ctx;

  /** Lit at night: every window in the city is a warm rectangle, and it is most
   * of what makes a skyline read as inhabited rather than modelled. */
  const litWindow = () => basic(new THREE.Color(0xffc98a).multiplyScalar(1.5));
  const darkWindow = () => basic(0x141c24);

  // =========================================================================
  // St. Louis Cathedral, and the square in front of it
  // =========================================================================
  //
  // The most recognisable building in Louisiana, and the reason is its
  // SILHOUETTE: a rectangular body with a tall central tower and a shorter
  // tower at each end, the middle one about 1.6x the others. That ratio is the
  // whole thing. A single central spire would be a church; three unequal
  // steeples on a wide low body is the Cathedral, and it is on almost
  // everything the city has ever printed.
  function cathedral(b) {
    const g = new THREE.Group(); ctx.scene.add(g);
    // the Cathedral sits in the northern half of the superblock, on the axis of
    // the square, with the river to the south
    const cx = b.cx, cz = b.z0 + 44;
    const w = 30, d = 62;                              // the body, running north–south
    const stucco = std(0xf0ece0, "cathedral stucco", { roughness: 0.9 });
    const stone = std(0xd8d2c2, "cast stone", { roughness: 0.85 });
    const roofMat = std(0x4a4a4c, "slate roof", { roughness: 0.7, metalness: 0.2 });
    const gold = basic(new THREE.Color(0xd9b23a).multiplyScalar(1.4));

    // the body: a plain rectangular box, which is the actual plan
    mesh(new THREE.BoxGeometry(w, 26, d), stucco, cx, 13, cz, { parent: g });
    mesh(new THREE.BoxGeometry(w + 1.2, 1.0, d + 1.2), stone, cx, 26.5, cz, { parent: g, cast: false });
    // a low pitched roof over it
    mesh(new THREE.BoxGeometry(w - 2, 3.4, d - 2), roofMat, cx, 28.7, cz, { parent: g });

    // THE THREE STEEPLES. Centre first, and the middle one is much taller.
    const steeple = (x, z, height, shaft) => {
      // `shaft` is the tower's WIDTH; the box is `height` TALL. This was
      // BoxGeometry(shaft, shaft, shaft) — a cube — which put an 11 m cube at
      // y 55.5..66.5 under a spire starting at y 92, so 25.5 m of the central
      // steeple was simply missing and the spire and cross hung in the sky.
      // (reported from a photograph, 2026-09-28: "the towers are floating".)
      // Centred at 30 + height/2, so the box spans exactly 30 .. 30+height —
      // which is the y the spire below is already placed to sit on.
      mesh(new THREE.BoxGeometry(shaft, height, shaft), stucco, cx + x, 30 + height / 2, cz + z, { parent: g });
      // the belfry openings, so it is not a blank cube
      for (const [ox, oz] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        mesh(new THREE.BoxGeometry(shaft * 0.5, shaft * 0.62, 0.2), darkWindow(),
          cx + x + ox * shaft * 0.26, 30 + height * 0.68, cz + z + oz * shaft * 0.26, { parent: g, cast: false, ry: oz ? 0 : Math.PI / 2 });
      }
      mesh(new THREE.BoxGeometry(shaft + 1.0, 0.7, shaft + 1.0), stone, cx + x, 30 + height * 0.42, cz + z, { parent: g, cast: false });
      // the spire: a tall pyramid, which is what makes it a steeple and not a tower
      mesh(new THREE.ConeGeometry(shaft * 0.78, height * 0.42, 4), roofMat, cx + x, 30 + height + height * 0.21, cz + z, { parent: g, ry: Math.PI / 4 });
      // the gold cross on top
      mesh(new THREE.BoxGeometry(0.22, 3.0, 0.22), gold, cx + x, 30 + height * 1.46, cz + z, { parent: g, cast: false });
      mesh(new THREE.BoxGeometry(1.5, 0.22, 0.22), gold, cx + x, 30 + height * 1.44, cz + z, { parent: g, cast: false });
      addBlocker(cx + x, cz + z, shaft * 0.75);
    };
    steeple(0, 0, 62, 11);                  // the central tower: the tall one
    steeple(0, -d / 2 + 6, 38, 9);          // …and one at each end, at 0.61 of it
    steeple(0, d / 2 - 6, 38, 9);

    // the clock on the river face, and the round window over the front door
    mesh(new THREE.CircleGeometry(3.2, 16), stone, cx, 30, cz - d / 2 - 0.15, { parent: g, cast: false, ry: Math.PI });
    mesh(new THREE.CircleGeometry(2.4, 16), darkWindow(), cx, 30, cz - d / 2 - 0.2, { parent: g, cast: false, ry: Math.PI });
    mesh(new THREE.CircleGeometry(2.6, 16), darkWindow(), cx, 15, cz - d / 2 - 0.15, { parent: g, cast: false, ry: Math.PI });
    // the long arched windows down each side
    for (let i = -3; i <= 3; i++) {
      for (const sx of [-1, 1]) {
        mesh(new THREE.BoxGeometry(0.16, 9, 2.4), i % 2 ? litWindow() : darkWindow(),
          cx + sx * (w / 2 + 0.02), 17, cz + i * 7, { parent: g, cast: false });
      }
    }
    // the pedimented front, and the steps down to the square
    mesh(new THREE.BoxGeometry(w * 0.5, 1.0, 2.0), stone, cx, 20, cz - d / 2 - 1.0, { parent: g, cast: false });
    for (let i = 0; i < 4; i++) mesh(new THREE.BoxGeometry(w * 0.6, 0.4, 1.2), stone, cx, 0.6 + i * 0.4, cz - d / 2 - 2.4 - i * 1.2, { parent: g, cast: false });
    // iron railings down both flanks, which is how the Cathedral actually sits
    const iron = std(0x22262a, "wrought iron railing", { metalness: 0.55, roughness: 0.55 });
    for (const sx of [-1, 1]) {
      mesh(new THREE.BoxGeometry(0.1, 1.6, d + 4), iron, cx + sx * (w / 2 + 2.2), 0.8, cz, { parent: g, cast: false });
      for (let i = 0; i <= Math.round(d / 2); i++) {
        mesh(new THREE.BoxGeometry(0.08, 1.6, 0.08), iron, cx + sx * (w / 2 + 2.2), 0.8, cz - d / 2 + i * 2, { parent: g, cast: false });
      }
    }
    addBlocker(cx, cz, 16);
    occluders.push({ minX: cx - w / 2, maxX: cx + w / 2, minY: 0, maxY: 70, minZ: cz - d / 2, maxZ: cz + d / 2 });
    if (sign) sign("SAINT LOUIS CATHEDRAL", 12, 1.2, cx, 8, cz - d / 2 - 3.4, Math.PI, "#f4eedd", "#2a2a30");
    pois.push({ x: cx, z: cz - d / 2 - 8, r: 10, label: "St. Louis Cathedral" });
  }

  /**
   * Jackson Square, in front of the Cathedral: the paving, the low iron fence
   * that closes it to the river, the lamp posts, the equestrian statue in the
   * middle, and the two Spanish colonial wings — the Cabildo on one side and
   * the Presbytère on the other.
   *
   * The two wings matter more than they look. St. Louis Cathedral was flanked by
   * matching buildings for its whole history and they are half of what a photo
   * of this square looks like; a cathedral standing alone on a lawn is a church.
   */
  function jacksonSquare(b) {
    const g = new THREE.Group(); ctx.scene.add(g);
    const pave = std(0xa8a294, "square paving", { roughness: 0.95 });
    const iron = std(0x22262a, "wrought iron railing", { metalness: 0.55, roughness: 0.55 });
    const W = b.x1 - b.x0, D = b.z1 - b.z0;
    mesh(new THREE.BoxGeometry(W, 0.12, D), pave, b.cx, 0.06, b.cz, { parent: g, cast: false });

    // The Cathedral goes in the NORTH half of the superblock, facing south down
    // the square to the river. The square is drawn over the whole block and the
    // Cathedral on top of it, so its footprint comes out of the paving rather
    // than the paving being laid around a hole for it.
    const railZ = b.z1 - 1.2;
    mesh(new THREE.BoxGeometry(W, 0.1, 0.1), iron, b.cx, 1.1, railZ, { parent: g, cast: false });
    for (let x = b.x0; x <= b.x1; x += 2.2) mesh(new THREE.BoxGeometry(0.07, 1.1, 0.07), iron, x, 0.55, railZ, { parent: g, cast: false });
    for (let x = b.x0 + 6; x < b.x1; x += 13) {
      mesh(new THREE.CylinderGeometry(0.11, 0.15, 4.2, 8), iron, x, 2.1, railZ, { parent: g, cast: false });
      mesh(new THREE.SphereGeometry(0.42, 8, 6), basic(new THREE.Color(0xffe0a8).multiplyScalar(2.2)), x, 4.5, railZ, { parent: g, cast: false });
      ctx.addLitSpot && ctx.addLitSpot({ x, y: 4.6, z: railZ, warm: 0xffe0b0, power: 70, range: 18 });
    }

    // THE statue: Andrew Jackson on a rearing horse, facing the river, in the
    // middle of the open square between the Cathedral and the water.
    const bx = b.cx, bz = b.cz + 10;
    mesh(new THREE.BoxGeometry(7.5, 1.1, 7.5), std(0x8a8578, "statue plinth granite", { roughness: 0.85 }), bx, 0.55, bz, { parent: g });
    mesh(new THREE.BoxGeometry(5.4, 4.2, 5.4), std(0x9a9488, "statue plinth granite", { roughness: 0.85 }), bx, 3.2, bz, { parent: g });
    const bronze = std(0x4a5a3a, "bronze", { metalness: 0.7, roughness: 0.45 });
    // the horse, rearing: body, neck, head, four legs at two angles
    mesh(new THREE.BoxGeometry(1.1, 1.3, 2.8), bronze, bx, 7.4, bz, { parent: g });
    mesh(new THREE.BoxGeometry(0.8, 1.5, 0.8), bronze, bx, 8.6, bz - 1.4, { parent: g }).rotation.x = -0.5;
    mesh(new THREE.BoxGeometry(0.55, 0.7, 1.0), bronze, bx, 9.3, bz - 1.9, { parent: g });
    for (const [lx, lz, tilt] of [[-0.4, -0.9, 0.5], [0.4, -0.9, 0.5], [-0.4, 0.9, -0.35], [0.4, 0.9, -0.35]]) {
      mesh(new THREE.BoxGeometry(0.22, 2.2, 0.22), bronze, bx + lx, 6.0, bz + lz, { parent: g }).rotation.x = tilt;
    }
    // the general, up in the stirrups, and his sword arm out
    mesh(new THREE.BoxGeometry(0.8, 1.9, 0.6), bronze, bx, 9.4, bz - 0.1, { parent: g });
    mesh(new THREE.SphereGeometry(0.34, 8, 6), bronze, bx, 10.6, bz - 0.1, { parent: g });
    mesh(new THREE.BoxGeometry(0.22, 2.2, 0.22), bronze, bx + 0.7, 10.2, bz - 0.3, { parent: g }).rotation.z = -0.9;
    addBlocker(bx, bz, 3.8);

    // the two wings: the Cabildo and the Presbytère. Spanish colonial — arcades
    // at the ground floor, a plain upper storey, a deep overhang on brackets.
    // They stand either side of the Cathedral and are half of what the square
    // looks like; a cathedral alone on a lawn is a church.
    const wing = (x, zc, name) => {
      const w = 26, d = 20, h = 11;
      const stucco = std(0xe8e0cc, "spanish colonial stucco", { roughness: 0.9 });
      mesh(new THREE.BoxGeometry(w, h, d), stucco, x, h / 2, zc, { parent: g });
      mesh(new THREE.BoxGeometry(w + 2.2, 0.9, d + 2.2), std(0xcfc6b0, "colonial cornice", { roughness: 0.85 }), x, h + 0.45, zc, { parent: g, cast: false });
      mesh(new THREE.BoxGeometry(w * 0.7, 2.6, d * 0.7), std(0x6a5a4a, "colonial tile roof", { roughness: 0.9 }), x, h + 2.2, zc, { parent: g });
      // the ground-floor arcade, which is what makes it Spanish colonial rather
      // than a shed: a run of round arches on piers
      for (let i = 0; i < 6; i++) {
        const ax = x - w / 2 + 2.4 + i * ((w - 4.8) / 5);
        mesh(new THREE.BoxGeometry(0.7, 5.0, 0.7), stucco, ax, 2.5, zc + d / 2 - 0.6, { parent: g, cast: false });
        mesh(new THREE.CylinderGeometry(1.7, 1.7, 0.8, 12, 1, false, 0, Math.PI), stucco, ax + 1.0, 5.0, zc + d / 2 - 0.6, { parent: g, cast: false, ry: Math.PI / 2 });
        mesh(new THREE.BoxGeometry(2.2, 3.0, 0.3), darkWindow(), ax + 1.0, 2.0, zc + d / 2 - 0.35, { parent: g, cast: false });
      }
      for (let i = 0; i < 4; i++) {
        mesh(new THREE.BoxGeometry(0.12, 2.4, 1.4), hashf(x, i, 2) < 0.6 ? litWindow() : darkWindow(),
          x - w / 2 + 3.5 + i * ((w - 7) / 3), 8.2, zc + d / 2 + 0.02, { parent: g, cast: false });
      }
      addBlocker(x, zc, 10);
      occluders.push({ minX: x - w / 2, maxX: x + w / 2, minY: 0, maxY: h + 3, minZ: zc - d / 2, maxZ: zc + d / 2 });
      if (sign) sign(name, 8, 1.0, x, 12.4, zc + d / 2 + 0.2, 0, "#f4eedd", "#3a2a20");
      pois.push({ x, z: zc + d / 2 + 3, r: 7, label: name });
    };
    // the wings flank the Cathedral, which sits in the northern half
    const catZ = b.z0 + 44;
    wing(b.x0 + 15, catZ, "THE CABILDO");
    wing(b.x1 - 15, catZ, "THE PRESBYTÈRE");

    // a few trees, because a square with nothing on it is a car park
    for (let i = 0; i < 4; i++) {
      const tx = b.x0 + 10 + i * ((W - 20) / 3), tz = b.z1 - 10;
      mesh(new THREE.CylinderGeometry(0.3, 0.46, 3.4, 8), std(0x4e4033, "live oak bark"), tx, 1.7, tz, { parent: g });
      mesh(new THREE.SphereGeometry(3.2, 10, 7), std(0x335c2f, "live oak foliage"), tx, 4.9, tz, { parent: g }).scale.set(1.1, 0.75, 1.1);
      addBlocker(tx, tz, 0.9);
    }
    pois.push({ x: b.cx, z: b.cz, r: 14, label: "Jackson Square" });
  }

  // =========================================================================
  // The French Market
  // =========================================================================
  //
  // The old market, the iron market, and the long low sheds over the middle.
  // It is a MARKET, so it is a run of open-sided sheds with produce under them —
  // which is also the only part of it anyone can actually recognise without a
  // photograph of a cathedral.
  function frenchMarket(b) {
    const g = new THREE.Group(); ctx.scene.add(g);
    const iron = std(0x2a3036, "market ironwork", { metalness: 0.5, roughness: 0.6 });
    const brick = std(0x8a6a58, "market brick", { roughness: 0.95 });
    const W = b.x1 - b.x0, D = b.z1 - b.z0;
    // three long sheds down the block, ridge roofs, open sides
    for (let s = 0; s < 3; s++) {
      const cz = b.z0 + D * (0.22 + s * 0.28);
      const w = W - 8;
      for (let i = 0; i <= 8; i++) {
        const px = b.x0 + 4 + (w / 8) * i;
        mesh(new THREE.BoxGeometry(0.16, 3.4, 0.16), iron, px, 1.7, cz - 5, { parent: g, cast: false });
        mesh(new THREE.BoxGeometry(0.16, 3.4, 0.16), iron, px, 1.7, cz + 5, { parent: g, cast: false });
      }
      mesh(new THREE.BoxGeometry(w, 0.2, 10.6), iron, b.cx, 3.5, cz, { parent: g, cast: false });
      mesh(new THREE.ConeGeometry(5.6, 1.5, 4), std(0x5a5a58, "market roof sheet", { metalness: 0.3, roughness: 0.7 }),
        b.cx, 4.2, cz, { parent: g, ry: Math.PI / 4 }).scale.set(w / (5.6 * Math.SQRT2), 1, 10.6 / (5.6 * Math.SQRT2));
      // the trestles under the sheds, with produce on them
      for (let i = 0; i < 14; i++) {
        const tx = b.x0 + 6 + (i % 7) * ((w - 12) / 6), tz = cz + (i < 7 ? -2.4 : 2.4);
        mesh(new THREE.BoxGeometry(2.4, 0.12, 1.1), std(0x6a5a44, "trestle board"), tx, 0.9, tz, { parent: g, cast: false });
        const c = [0xc84a2a, 0xd8a828, 0x6a9a3a, 0xb84a6a, 0xd8c84a][Math.floor(hashf(tx, tz, s) * 5)];
        mesh(new THREE.BoxGeometry(2.2, 0.5, 0.95), std(c, "market produce", { roughness: 0.85 }), tx, 1.2, tz, { parent: g, cast: false });
        mesh(new THREE.BoxGeometry(0.12, 0.9, 0.12), iron, tx - 1.0, 0.45, tz, { parent: g, cast: false });
        mesh(new THREE.BoxGeometry(0.12, 0.9, 0.12), iron, tx + 1.0, 0.45, tz, { parent: g, cast: false });
      }
      addBlocker(b.cx, cz, Math.min(w, 11) / 2);
    }
    // the brick market building at the north end, three storeys of shuttered windows
    const bw = W - 10, bh = 15;
    mesh(new THREE.BoxGeometry(bw, bh, 12), brick, b.cx, bh / 2, b.z1 - 7, { parent: g });
    mesh(new THREE.BoxGeometry(bw + 1, 0.7, 13), std(0xcfc6b0, "market cornice", { roughness: 0.85 }), b.cx, bh + 0.35, b.z1 - 7, { parent: g, cast: false });
    for (let f = 0; f < 3; f++) for (let i = 0; i < 9; i++) {
      const wx = b.cx - bw / 2 + 2.4 + i * ((bw - 4.8) / 8);
      mesh(new THREE.BoxGeometry(1.3, 2.2, 0.12), hashf(wx, f, 3) < 0.6 ? litWindow() : darkWindow(), wx, 3.4 + f * 4.2, b.z1 - 13.1, { parent: g, cast: false });
    }
    addBlocker(b.cx, b.z1 - 7, 7);
    occluders.push({ minX: b.cx - bw / 2, maxX: b.cx + bw / 2, minY: 0, maxY: bh + 1, minZ: b.z1 - 13, maxZ: b.z1 - 1 });
    if (sign) sign("FRENCH MARKET", 11, 1.3, b.cx, 16.6, b.z1 - 13.2, Math.PI, "#f4eedd", "#2a3a2a");
    pois.push({ x: b.cx, z: b.cz, r: 12, label: "French Market" });
  }

  // =========================================================================
  // Loyola — a university, because a city of this size has one
  // =========================================================================
  function university(b) {
    const g = new THREE.Group(); ctx.scene.add(g);
    const brick = std(0x9a6a52, "campus brick", { roughness: 0.92 });
    const stone = std(0xe4ded0, "campus limestone", { roughness: 0.8 });
    const W = b.x1 - b.x0, D = b.z1 - b.z0;
    // a cloister of connected ranges round three sides of a quad, which is the
    // plan every American campus of this age actually has
    const range = (x, z, w, d, h) => {
      mesh(new THREE.BoxGeometry(w, h, d), brick, x, h / 2, z, { parent: g });
      mesh(new THREE.BoxGeometry(w + 0.8, 0.6, d + 0.8), stone, x, h + 0.3, z, { parent: g, cast: false });
      const cols = Math.max(3, Math.floor(w / 4));
      for (let i = 0; i < cols; i++) {
        const wx = x - w / 2 + 2.2 + i * ((w - 4.4) / (cols - 1));
        for (let f = 1; f < Math.floor(h / 3.6); f++) {
          mesh(new THREE.BoxGeometry(1.2, 2.0, 0.12), hashf(wx, f, z) < 0.6 ? litWindow() : darkWindow(), wx, 1.8 + f * 3.6, z - d / 2 - 0.06, { parent: g, cast: false });
        }
      }
      addBlocker(x, z, Math.min(w, d) / 2);
      occluders.push({ minX: x - w / 2, maxX: x + w / 2, minY: 0, maxY: h, minZ: z - d / 2, maxZ: z + d / 2 });
    };
    const h = 15;
    range(b.cx, b.z0 + 8, W - 8, 13, h);
    range(b.x0 + 8, b.cz, 13, D - 26, h);
    range(b.x1 - 8, b.cz, 13, D - 26, h);
    // the chapel closing the fourth side, with a spire
    mesh(new THREE.BoxGeometry(18, 20, 11), stone, b.cx, 10, b.z1 - 9, { parent: g });
    mesh(new THREE.ConeGeometry(8.2, 9, 4), std(0x4a4a4c, "chapel slate roof", { roughness: 0.7 }), b.cx, 24.5, b.z1 - 9, { parent: g, ry: Math.PI / 4 });
    mesh(new THREE.CylinderGeometry(0.12, 0.12, 4, 6), std(0xd9b23a, "chapel cross", { metalness: 0.7, roughness: 0.4 }), b.cx, 30, b.z1 - 9, { parent: g, cast: false });
    // the quad itself
    P.park(g, b.cx, b.cz + 2, W - 30, D - 34, Math.floor(b.cx));
    P.statue(g, b.cx, b.cz + 2, "bronze", 5);
    // a bell tower on the corner
    mesh(new THREE.BoxGeometry(6, 26, 6), stone, b.x0 + 8, 13, b.z0 + 8, { parent: g });
    mesh(new THREE.ConeGeometry(4.6, 7, 4), std(0x4a4a4c, "bell tower roof", { roughness: 0.7 }), b.x0 + 8, 29.5, b.z0 + 8, { parent: g, ry: Math.PI / 4 });
    addBlocker(b.x0 + 8, b.z0 + 8, 3.4);
    if (sign) sign("LOYOLA UNIVERSITY", 12, 1.2, b.cx, 17.5, b.z0 + 1.2, Math.PI, "#f4eedd", "#1f3a5a");
    pois.push({ x: b.cx, z: b.cz, r: 12, label: "Loyola University" });
  }

  // =========================================================================
  // Build them all, claiming their blocks
  // =========================================================================
  const BUILDERS = {
    // The Cathedral and its square are ONE site. They are not two landmarks that
    // happen to be near each other — they are the same piece of ground, and
    // splitting them meant the square could be built on a different block from
    // the building it exists to be the forecourt of.
    jackson: (b) => { jacksonSquare(b); cathedral(b); },
    market: frenchMarket, university,
    superdome: (b) => {
      // 244 m across needs a superblock, so it is given one outright: the whole
      // block plus the two to its north, which is what a stadium's footprint
      // actually is — the building, the plaza, and nine hundred acres of parking.
      const g = new THREE.Group(); ctx.scene.add(g);
      P.stadium(g, b.cx, b.cz, 96);
      // the parking it stands in, so it is not a drum on bare tarmac
      const lot = std(0x4a4a4e, "surface parking", { roughness: 0.98 });
      mesh(new THREE.BoxGeometry(300, 0.1, 300), lot, b.cx, 0.05, b.cz, { parent: g, cast: false });
      for (let i = 0; i < 120; i++) {
        const a = hashf(i, b.cx, 1), r2 = hashf(i, b.cz, 2);
        const px = b.cx + (a - 0.5) * 280, pz = b.cz + (r2 - 0.5) * 280;
        if (Math.hypot(px - b.cx, pz - b.cz) < 108) continue;             // not on the plaza
        mesh(new THREE.BoxGeometry(1.9, 1.35, 4.2), std([0x8a2f2f, 0x2f4a8a, 0xb0b0b4, 0x3a5a3a, 0xd8d4c8][Math.floor(hashf(i, 3, 4) * 5)], "parked car"),
          px, 0.78, pz, { parent: g, cast: false, ry: hashf(i, 5, 6) * 3 });
      }
      if (sign) sign("SUPERDOME", 30, 4.5, b.cx, 22, b.cz - 100, Math.PI, "#1a1a20", "#d8b23a");
      ctx.addLitSpot && ctx.addLitSpot({ x: b.cx, y: 46, z: b.cz - 100, warm: 0xfff0d0, power: 900, range: 180 });
      pois.push({ x: b.cx, z: b.cz + 108, r: 20, label: "The Superdome" });
    },
    citypark: (b) => {
      const g = new THREE.Group(); ctx.scene.add(g);
      const W = b.x1 - b.x0, D = b.z1 - b.z0;
      P.park(g, b.cx, b.cz, W - 4, D - 4, Math.floor(b.cx + b.cz));
      // the two things City Park is actually known for: a big lagoon and a
      // cast-iron bandstand you can hear a brass band from three blocks away
      const lagoon = new THREE.Mesh(new THREE.CircleGeometry(1, 28).rotateX(-Math.PI / 2).scale(46, 1, 22),
        new THREE.MeshPhysicalMaterial({ color: 0x24484a, roughness: 0.12, clearcoat: 1, name: "lagoon water" }));
      lagoon.userData.gtbRealized = true;
      lagoon.position.set(b.cx, 0.14, b.cz - D * 0.18);
      g.add(lagoon);
      P.bandstand(g, b.cx, b.cz + D * 0.2);
      P.statue(g, b.x0 + 9, b.z1 - 9, "soldier", 8);
      P.fountain(g, b.x1 - 10, b.z0 + 10, 5);
      // the Peristyle, the row of live oaks that frames the whole thing
      for (let i = 0; i < 14; i++) {
        const t = i / 13, side = i % 2 ? 1 : -1;
        const px = b.x0 + 6 + t * (W - 12);
        const pz = b.cz + side * (D / 2 - 6);
        mesh(new THREE.CylinderGeometry(0.36, 0.55, 4.0, 8), std(0x4e4033, "live oak bark"), px, 2.0, pz, { parent: g });
        mesh(new THREE.SphereGeometry(3.8, 10, 7), std(0x335c2f, "live oak foliage"), px, 6.0, pz, { parent: g }).scale.set(1.15, 0.7, 1.15);
        for (let k = 0; k < 3; k++) {
          mesh(new THREE.CylinderGeometry(0.07, 0.02, 2.6, 4), std(0x8a9a76, "spanish moss"),
            px + Math.cos(k * 2.1) * 2.4, 4.8, pz + Math.sin(k * 2.1) * 2.4, { parent: g, cast: false });
        }
        addBlocker(px, pz, 1.0);
      }
      pois.push({ x: b.cx, z: b.cz, r: 16, label: "City Park" });
    },
  };

  /**
   * Build every landmark onto its superblock. `blocks` is the list
   * orlearouge.js's blocks() produced; the superblocks are matched by their
   * `label`, which is the reserve's own name, so a landmark cannot be misplaced
   * by a coordinate drifting off the edge of a plot.
   */
  function build(blocks, claims) {
    const byLabel = new Map(blocks.filter((b) => b.reserve).map((b) => [b.label, b]));
    const built = [];
    for (const site of SITES) {
      const fn = BUILDERS[site.id];
      const b = byLabel.get(site.label);
      if (!fn || !b) { missing.push(site.label); continue; }
      claims.add(b);
      fn(b);
      built.push(site.label);
    }
    return built;
  }
  const missing = [];

  return { build, SITES, BUILDERS, get missing() { return missing; } };
}
