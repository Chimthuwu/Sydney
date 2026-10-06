// real_frame_profile.mjs — where the frame time actually goes, per location.
//
//   node serve.mjs 8899   then   node --experimental-detect-module tools/qa/real_frame_profile.mjs
//
// WHY THIS EXISTS: tools/qa/perf_audit.mjs reports byte-identical numbers for
// all 9 of its locations. It calls g.teleport(x, z), which moves the PLAYER, but
// then measures against g.camera — and headless the camera rig never converges
// on the new position, so every location profiles the same frustum. Its
// perf.simMs / aiMs / renderMs are also all 0. It is not evidence about any
// location, and it is the harness anyone would reach for first.
//
// This harness instead:
//   - places the CAMERA explicitly (position.set + lookAt) and PRINTS where it
//     ended up, so a camera that failed to move is visible rather than silent;
//   - reads back one pixel after the timed batch, in the same task, so the
//     driver cannot drop the work (the gtb-perf-audit skill records a case
//     where a stale compositor surface produced identical PNGs);
//   - reports a MINIMUM over several small batches — on SwiftShader a single
//     sample is routinely dominated by a GC pause or a shader compile;
//   - says so in the header, because a minimum is a floor on the cost and not a
//     typical frame. Do not read it as "the game runs at X fps";
//   - runs one page.evaluate PER SITE, because a single evaluate covering all
//     sites blocked long enough to blow the CDP timeout, surfacing as an opaque
//     CallbackRegistry stack with no useful message.
//
// This model may have no vision endpoint, so everything here is numeric. Do not
// claim to have SEEN a frame from this output.

import puppeteer from "puppeteer";
import { autoAcknowledge } from "./lib/agegate.mjs";

const SITES = [
  ["OrleaRouge spawn", -6, 100],
  ["Crown Strip", 0, -330],
  ["Oyster Bay", 640, 590],
];
const FRAMES = 6;      // SwiftShader is a software rasteriser; renders are expensive
const BATCHES = 3;     // the minimum is taken over this many batches

const browser = await puppeteer.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--mute-audio"] });
const page = await browser.newPage();

// CAPTURE THE RENDERER'S OWN BATCHING LOG (gtb-perf-audit skill: "main.js has always
// logged, and NO QA script captured"). Two lines settle the batching question in two
// numbers:
//
//   [gfx] static batching: 51204 meshes -> 11024 (5717 batches)
//   [gfx] late static batching: 6766 meshes -> 2841 (430 batches)
//
// Without them the only way to reason about draw calls is a per-frustum mesh walk,
// which counts SURVIVORS and cannot tell "the batcher missed this" from "the batcher
// correctly left this alone". That gap produced three consecutive wrong commits
// (merge.js "broken", "batching never ran over the districts", "1,061 untagged bare
// meshes"). The log is the reconciliation.
const gfxLog = [];
page.on("console", (m) => {
  const t = m.text();
  if (/\[gfx\]|batching/i.test(t)) gfxLog.push(t);
});
page.on("pageerror", (e) => console.log("  pageerror:", e.message));
await autoAcknowledge(page);
await page.setViewport({ width: 1280, height: 720 });
await page.goto("http://localhost:8899/", { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForSelector("#freeBtn:not([disabled])", { timeout: 240000 });
await page.evaluate(() => document.getElementById("freeBtn").click());
// Wait for the ACTUAL condition, not a fixed sleep. A 20 s sleep was not enough
// and the failure surfaced as "Cannot read properties of undefined (reading
// 'renderer')" from inside the first evaluate — i.e. window.__game did not exist
// yet, which looks nothing like a timing problem.
// Poll by hand. `page.waitForFunction(fn, null, opts)` is not a valid call in
// this puppeteer version — it threw "Cannot read properties of null (reading
// 'polling')". A plain loop needs no API-version knowledge.
{
  const deadline = Date.now() + 420000;
  let ready = false;
  while (Date.now() < deadline) {
    ready = await page.evaluate(() => !!(window.__game && window.__game.renderer && window.__game.camera)).catch(() => false);
    if (ready) break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  if (!ready) { console.log("  ERROR: window.__game.renderer never appeared; aborting rather than reporting fiction."); await browser.close(); process.exit(1); }
}
await new Promise((r) => setTimeout(r, 3000));

const measureSite = (x, z) =>
  page.evaluate(async (x, z) => {
    const g = window.__game, r = g.renderer;

    g.teleport(x, z);
    // headless runs ~1 fps, so district distance culling may not have caught up
    // with the teleport: drive it by hand, twice
    for (let k = 0; k < 2; k++) {
      for (const d of [g.westParish, g.eastBank, g.tusouxroe, g.chatboro, g.shruston, g.charsoufre, g.crownStrip, g.stateWorld]) {
        if (d && d.update) d.update(1, g.playerPos);
      }
    }
    await new Promise((res) => setTimeout(res, 900));

    // EXPLICIT camera placement. Not "camera follows player": headless the rig
    // does not converge, which is exactly the bug in perf_audit.mjs.
    g.camera.position.set(x, 28, z + 70);
    g.camera.lookAt(x, 0, z);
    g.camera.updateMatrixWorld(true);
    const camAt = [g.camera.position.x, g.camera.position.y, g.camera.position.z].map(Math.round).join(",");

    const FRAMES = 6, BATCHES = 3;
    const cv = document.createElement("canvas");
    cv.width = 320; cv.height = 180;
    const cx = cv.getContext("2d");

    const timeFrames = (n) => {
      r.info.reset();
      const t0 = performance.now();
      for (let i = 0; i < n; i++) r.render(g.scene, g.camera);
      const gl = r.getContext();
      const px = new Uint8Array(4);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      // renderer.info ACCUMULATES across render() calls until reset, and the reset
      // above happens once per BATCH -- so divide by n or the count is the sum over
      // the batch, not one frame. That mistake made 4,153 real draws per frame look
      // like 24,918 and implied a batching failure that does not exist.
      return { ms: (performance.now() - t0) / n, calls: Math.round(r.info.render.calls / n), tris: Math.round(r.info.render.triangles / n) };
    };
    const best = () => {
      let m = null;
      for (let b = 0; b < BATCHES; b++) { const s = timeFrames(FRAMES); if (!m || s.ms < m.ms) m = s; }
      return m;
    };

    const med = best();

    const shadowWas = r.shadowMap.enabled;
    r.shadowMap.enabled = false;
    const noShadow = best();
    r.shadowMap.enabled = shadowWas;

    const peds = g.streetlife && g.streetlife.actors ? g.streetlife.actors.slice() : [];
    const npcs = g.enemies ? g.enemies.slice() : [];
    for (const a of peds) if (a.mesh) a.mesh.visible = false;
    for (const e of npcs) if (e.spr) e.spr.visible = false;
    const noCrowd = best();
    for (const a of peds) if (a.mesh) a.mesh.visible = true;
    for (const e of npcs) if (e.spr) e.spr.visible = true;

    // Why are draw calls so much higher at spawn? Count meshes actually inside
    // the frustum and compare with the draw calls issued. inFrustum >> calls
    // means batching is merging well and the calls are irreducible per-material;
    // calls >= inFrustum means something is defeating the batcher (a noBatch
    // flag, a per-object material clone, or frustumCulled=false on big meshes).
    let inFrustum = 0, invisible = 0, uncullable = 0, sceneMeshes = 0;
    const fr = new (g.THREE.Frustum)();
    const mtx = new (g.THREE.Matrix4)();
    mtx.multiplyMatrices(g.camera.projectionMatrix, g.camera.matrixWorldInverse);
    fr.setFromProjectionMatrix(mtx);
    const bb = new (g.THREE.Sphere)();
    g.scene.traverseVisible((o) => {
      if (!o.isMesh && !o.isSprite && !o.isPoints) return;
      sceneMeshes++;
      if (o.frustumCulled === false) uncullable++;
      if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
      bb.copy(o.geometry.boundingSphere).applyMatrix4(o.matrixWorld);
      if (fr.intersectsSphere(bb)) inFrustum++;
    });

    // one real readback + luminance histogram: a frozen surface is detectable
    r.render(g.scene, g.camera);
    cx.drawImage(r.domElement, 0, 0, 320, 180);
    const data = cx.getImageData(0, 0, 320, 180).data;
    let sum = 0;
    const hist = new Array(8).fill(0);
    for (let i = 0; i < data.length; i += 4) {
      const l = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) | 0;
      sum += l;
      hist[Math.min(7, l >> 5)]++;
    }
    const n = data.length / 4;

    return {
      camAt, inFrustum, sceneMeshes, uncullable,
      callsPerMesh: +(med.calls / Math.max(1, inFrustum)).toFixed(2),
      full: +med.ms.toFixed(1), calls: med.calls, trisK: Math.round(med.tris / 1000),
      noShadow: +noShadow.ms.toFixed(1), noCrowd: +noCrowd.ms.toFixed(1),
      shadowSaving: +(med.ms - noShadow.ms).toFixed(1),
      crowdSaving: +(med.ms - noCrowd.ms).toFixed(1),
      peds: peds.length, enemies: npcs.filter((e) => !e.dead).length,
      meanLuma: +(sum / n).toFixed(1), hist: hist.map((h) => Math.round((h / n) * 100)),
    };
  }, x, z);

const rows = [];
for (const [name, x, z] of SITES) {
  console.log(`  measuring ${name} ...`);
  rows.push({ name, ...(await measureSite(x, z)) });
}

console.log(`\n=== real per-frame cost, camera placed explicitly (MIN of ${BATCHES} x ${FRAMES} frames) ===`);
console.log("SwiftShader software rasteriser: read the SHAPE across rows, not the absolute ms.\n");
console.log("location              cam(x,y,z)        ms  calls  trisK  inFrm  calls/inFrm  unCull  scene  noShad  noCrowd  peds  npcs");
for (const r of rows) {
  console.log(
    `${r.name.padEnd(20)} ${r.camAt.padEnd(16)} ${String(r.full).padStart(4)} ${String(r.calls).padStart(6)} ${String(r.trisK).padStart(6)} ` +
    `${String(r.inFrustum).padStart(6)} ${String(r.callsPerMesh).padStart(10)} ${String(r.uncullable).padStart(7)} ${String(r.sceneMeshes).padStart(6)} ` +
    `${String(r.noShadow).padStart(7)} ${String(r.noCrowd).padStart(8)} ` +
    `${String(r.peds).padStart(5)} ${String(r.enemies).padStart(5)}`
  );
}
console.log("\nluminance histograms (8 buckets, % of pixels) — differing rows prove the frame really changed:");
for (const r of rows) console.log(`  ${r.name.padEnd(20)} ${r.hist.join(" ")}`);

const worst = [...rows].sort((a, b) => b.full - a.full)[0];
const bestRow = [...rows].sort((a, b) => a.full - b.full)[0];
console.log(`\nworst: ${worst.name} ${worst.full} ms   best: ${bestRow.name} ${bestRow.full} ms   spread: ${(worst.full - bestRow.full).toFixed(1)} ms`);
const identity = rows.every((r) => r.full === rows[0].full);
console.log(identity
  ? "\nWARNING: every location is identical — the camera still is not moving. Do not trust this run."
  : "\ncamera moved and the locations differ: these numbers are real.");
console.log("Note: no vision endpoint here — these are numbers, not an inspection of the image.");

await // The renderer's own batching numbers, for reconciling against any frustum walk.
console.log("\n=== renderer batching log (ground truth) ===");
if (gfxLog.length) for (const l of gfxLog) console.log("  " + l);
else console.log("  NONE CAPTURED -- if this is empty the log never fired; do not infer batching from a frustum walk instead.");

await browser.close();