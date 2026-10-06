// ---------------------------------------------------------------------------
// rain.js — rain streaks around the camera (the look of weather.precip).
//
// One LineSegments of N streaks living in a box that follows the camera; every
// frame each streak falls, slants with the wind and wraps round the box, so the
// rain is always where you are looking and costs one draw call. `precip` sets how
// many are drawn and how opaque they are; `wind` how far they lean and how fast
// they fall. Nothing here touches gameplay.
// ---------------------------------------------------------------------------

import * as THREE from "three";

const N = 2600;                 // streaks at full downpour
const BOX = 46;                 // metres square, around the camera
const HEIGHT = 34;              // metres tall

export function createRain(scene) {
  const base = new Float32Array(N * 3);            // each streak's own (x, y, z) offset inside the box
  const speed = new Float32Array(N);               // fall speed multiplier
  for (let i = 0; i < N; i++) {
    base[i * 3] = Math.random() * BOX;
    base[i * 3 + 1] = Math.random() * HEIGHT;
    base[i * 3 + 2] = Math.random() * BOX;
    speed[i] = 0.85 + Math.random() * 0.3;
  }
  const pos = new Float32Array(N * 6);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  const mat = new THREE.LineBasicMaterial({ color: 0xc4d2e0, transparent: true, opacity: 0, depthWrite: false, fog: false });
  mat.userData.gtbRealized = true;
  const lines = new THREE.LineSegments(geo, mat);
  lines.frustumCulled = false;
  lines.renderOrder = 20;
  lines.visible = false;
  scene.add(lines);

  let driftX = 0, fallY = 0;          // integrated, so a change of wind bends the rain instead of scrambling every streak
  return {
    object: lines,
    /**
     * @param {number} dt
     * @param {THREE.Vector3} at   the camera
     * @param {number} precip      0 … 1
     * @param {number} wind        0 … 1
     */
    update(dt, at, precip, wind) {
      if (precip < 0.02) { lines.visible = false; return; }
      lines.visible = true;
      const fall0 = 26 + 14 * wind, lean0 = 3 + 22 * wind;
      driftX += lean0 * dt; fallY += fall0 * dt;
      const count = Math.max(1, Math.floor(N * Math.min(1, precip)));
      geo.setDrawRange(0, count * 2);
      mat.opacity = 0.16 + 0.34 * Math.min(1, precip);
      const fall = 26 + 14 * wind, lean = 3 + 22 * wind;          // m/s down, m/s sideways (the wind blows +x, a little +z)
      const len = 0.55 + 0.5 * wind;
      const dx = lean / fall * len, dz = lean * 0.35 / fall * len, dy = len;
      const ox = at.x - BOX / 2, oy = at.y - HEIGHT * 0.35, oz = at.z - BOX / 2;
      for (let i = 0; i < count; i++) {
        const k = i * 3, s = speed[i];
        // wrap into the box (positive modulo)
        let x = (base[k] + driftX * s) % BOX; if (x < 0) x += BOX;
        let y = (base[k + 1] - fallY * s) % HEIGHT; if (y < 0) y += HEIGHT;
        let z = (base[k + 2] + driftX * 0.35 * s) % BOX; if (z < 0) z += BOX;
        // the box is anchored to the world grid (not glued to the camera), so streaks do not swim as you turn or drive
        const wx = ox + ((x - (ox % BOX) + BOX) % BOX), wz = oz + ((z - (oz % BOX) + BOX) % BOX);
        const j = i * 6;
        pos[j] = wx; pos[j + 1] = oy + y; pos[j + 2] = wz;
        pos[j + 3] = wx - dx; pos[j + 4] = oy + y + dy; pos[j + 5] = wz - dz;
      }
      geo.attributes.position.needsUpdate = true;
    },
  };
}
