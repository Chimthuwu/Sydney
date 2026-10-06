// orlearouge_spawn_density.mjs — what is actually filling the frustum at spawn?
//
//   node serve.mjs 8899   then
//   node --experimental-detect-module tools/qa/orlearouge_spawn_density.mjs
//
// Human report 2026-10-02: "Orlearouge IS very laggy esp during spawn".
//
// The frame profiler already established the SHAPE: frame cost tracks the number
// of meshes in the frustum almost linearly (4,260 in view -> 1398 ms at spawn,
// vs 1,170 -> 638 ms at Oyster Bay), and batching is already at ~1 draw per
// in-frustum mesh, so there is nothing to merge. The remaining lever is WHAT those
// 4,260 meshes are.
//
// This probe attributes the frustum contents by owner and by kind, so the answer
// is a ranked list rather than a guess. It reports the top contributors at spawn
// and, as a control, at a location known to be cheaper.
//
// It does NOT trust district `visible` flags as a proxy for cost: it counts what
// the frustum actually intersects, then attributes each hit to the nearest
// ancestor carrying an owner tag, falling back to the scene root.

import puppeteer from "puppeteer";
import { autoAcknowledge } from "./lib/agegate.mjs";

const SITES = [
  ["SPAWN (OrleaRouge)", -6, 130],
  ["spawn+40m", -6, 170],
  ["Oyster Bay (control)", 640, 590],
];

const browser = await puppeteer.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--mute-audio"], protocolTimeout: 300000 });
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("  pageerror:", e.message));
// Capture the renderer's own batching report. main.js logs
//   [gfx] static batching: N meshes -> M (B batches)
// and again per late pass. These counts have never been captured by any QA
// script, which is why the unbatched-mesh count could be investigated for this
// long without seeing what the batcher thought it did.
const gfxLines = [];
page.on("console", (m) => {
  const txt = m.text();
  if (/\[gfx\]|batching/i.test(txt)) { gfxLines.push(txt); console.log("  [captured]", txt); }
});
await autoAcknowledge(page);
await page.setViewport({ width: 1280, height: 720 });
await page.goto("http://localhost:8899/", { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForSelector("#freeBtn:not([disabled])", { timeout: 240000 });
await page.evaluate(() => document.getElementById("freeBtn").click());

{
  const deadline = Date.now() + 420000;
  let ready = false;
  while (Date.now() < deadline && !ready) {
    ready = await page.evaluate(() => !!(window.__game && window.__game.renderer && window.__game.camera)).catch(() => false);
    if (!ready) await new Promise((r) => setTimeout(r, 2000));
  }
  if (!ready) { console.log("  ERROR: __game never appeared; aborting rather than reporting fiction."); await browser.close(); process.exit(1); }
}

const attribute = (x, z) =>
  page.evaluate(async (x, z) => {
    const g = window.__game, r = g.renderer;
    g.teleport(x, z);
    for (let k = 0; k < 2; k++) {
      for (const d of [g.westParish, g.eastBank, g.tusouxroe, g.chatboro, g.shruston, g.charsoufre, g.crownStrip, g.stateWorld]) if (d && d.update) d.update(1, g.playerPos);
    }
    await new Promise((res) => setTimeout(res, 1200));

    // Drive traffic by hand for this teleport. Without this the probe measures a
    // FROZEN traffic state: the lamp gate lives in traffic.apply(), which only runs
    // from traffic.update(), and headless the game's own loop is running at ~1 fps.
    // Measuring without calling it made the lamp gate look like it saved nothing
    // (transparent meshes 439 -> 434) when the distance distribution says 65% of
    // vehicles are out of range. Step it ~2 s of frames at 60 Hz with the focus at
    // the player, which is what apply() compares against.
    if (g.traffic && g.traffic.update) {
      for (let k = 0; k < 120; k++) g.traffic.update(1 / 60, { x: g.playerPos.x, z: g.playerPos.z }, [], null);
    }
    // same explicit placement the frame profiler uses — the rig does not converge headless
    g.camera.position.set(x, 28, z + 40);
    g.camera.lookAt(x, 0, z);
    g.camera.updateMatrixWorld(true);

    const T = g.THREE;
    const fr = new T.Frustum(), mtx = new T.Matrix4(), bb = new T.Sphere(), v = new T.Vector3();
    mtx.multiplyMatrices(g.camera.projectionMatrix, g.camera.matrixWorldInverse);
    fr.setFromProjectionMatrix(mtx);

    // owner = nearest ancestor (self included) with userData.owner or .district
    const ownerOf = (o) => {
      for (let n = o; n; n = n.parent) {
        if (n.userData && n.userData.owner) return n.userData.owner;
        if (n.userData && n.userData.district) return n.userData.district;
        if (n.name && n.userData && n.userData.batch !== false && n.parent === g.scene && n.name) return n.name;
      }
      return "(unattributed)";
    };

    const byOwner = new Map(), byKind = new Map(), byDepth = new Map();
    let inFrustum = 0, totalTris = 0;
    const top = [];

    g.scene.traverseVisible((o) => {
      if (!o.isMesh && !o.isSprite && !o.isPoints && !o.isLine) return;
      if (!o.geometry) return;
      if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
      bb.copy(o.geometry.boundingSphere).applyMatrix4(o.matrixWorld);
      if (!fr.intersectsSphere(bb)) return;

      inFrustum++;
      const pos = o.geometry.attributes.position;
      const tris = o.isMesh && pos ? (o.geometry.index ? o.geometry.index.count : pos.count) / 3 : 1;
      totalTris += tris;

      const owner = ownerOf(o);
      byOwner.set(owner, (byOwner.get(owner) || 0) + 1);

      const kind = o.isSprite ? "sprite" : o.isPoints ? "points" : o.isLine ? "line"
        : (o.material && o.material.transparent) ? "transparent-mesh" : "opaque-mesh";
      byKind.set(kind, (byKind.get(kind) || 0) + 1);

      // how far down the tree: shallow = loose in a district root, deep = nested prop
      let depth = 0; for (let n = o.parent; n && n !== g.scene; n = n.parent) depth++;
      const dk = depth <= 1 ? "shallow(<=1)" : depth <= 3 ? "mid(2-3)" : depth <= 6 ? "deep(4-6)" : "verydeep(7+)";
      byDepth.set(dk, (byDepth.get(dk) || 0) + 1);

      if (tris >= 1) top.push({ owner, tris: Math.round(tris), name: o.name || o.type, isInstanced: !!o.isInstancedMesh, instCount: o.count || 0 });
    });

    // distance distribution of VEHICLE meshes from the camera: this is what
    // decides whether a lamp-distance gate can pay for itself.
    const vDists = [];
    const vOrigins = new Map();
    g.scene.traverseVisible((o) => {
      if (!o.isMesh || !o.geometry) return;
      for (let n = o; n; n = n.parent) if (n.name && n.name.startsWith("vehicle:")) {
        o.getWorldPosition(v);
        vDists.push(Math.hypot(v.x - g.camera.position.x, v.z - g.camera.position.z));
        vOrigins.set(n.name, (vOrigins.get(n.name) || 0) + 1);
        return;
      }
    });
    vDists.sort((a, b) => a - b);
    const pct = (q) => (vDists.length ? Math.round(vDists[Math.min(vDists.length - 1, Math.floor(vDists.length * q))]) : -1);

    // Characterise the unattributed bucket by what is actually SHARED.
    //
    // "Unattributed" only means no userData.owner was found up the parent chain;
    // it does not say what the mesh IS. The actionable question is whether these
    // are repeats of a small set of geometries (merge or instance them) or
    // one-offs (nothing to batch). Group by geometry uuid and by material uuid.
    const un = [];
    g.scene.traverseVisible((o) => {
      if (!o.isMesh && !o.isSprite && !o.isPoints && !o.isLine) return;
      if (!o.geometry) return;
      if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
      bb.copy(o.geometry.boundingSphere).applyMatrix4(o.matrixWorld);
      if (!fr.intersectsSphere(bb)) return;
      if (ownerOf(o) !== "(unattributed)") return;
      let depth = 0; for (let n = o.parent; n && n !== g.scene; n = n.parent) depth++;
      const pos = o.geometry.attributes.position;
      const tris = o.isMesh && pos ? Math.round((o.geometry.index ? o.geometry.index.count : pos.count) / 3) : 0;
      un.push({
        id: o.id,
        geo: o.geometry.uuid, mat: o.material ? o.material.uuid : "(none)",
        matType: o.material ? o.material.type : "(none)",
        name: o.name || o.type, depth, tris, matObj: o.material,
        rootChild: (() => { let n = o; while (n.parent && n.parent !== g.scene) n = n.parent; return n.name || n.type; })(),
        // Would main.js's LATE batch pass consider this? It runs
        //   runBatch(true) with include: (root) => cullGroups.has(root) || root.userData.staticLandmark === true
        // so a scene-root child with neither tag is invisible to it. These meshes
        // can therefore never be merged by the late pass, however mergeable they are.
        lateEligible: (() => {
          let n = o; while (n.parent && n.parent !== g.scene) n = n.parent;
          return !!(n.userData && n.userData.staticLandmark === true) || !!(n.userData && (n.userData.owner || n.userData.district));
        })(),
        inCullGroup: (() => { let n = o; while (n && n !== g.scene) { if (n.userData && n.userData.cullGroup) return true; n = n.parent; } return false; })(),
      });
    });
    const byGeo = new Map(), byMat = new Map(), byRoot = new Map();
    for (const m of un) {
      byGeo.set(m.geo, (byGeo.get(m.geo) || 0) + 1);
      byMat.set(m.mat + "|" + m.matType, (byMat.get(m.mat + "|" + m.matType) || 0) + 1);
      byRoot.set(m.rootChild, (byRoot.get(m.rootChild) || 0) + 1);
    }
    const topGeo = [...byGeo.entries()].map(([k, n]) => ({ n, name: un.find((m) => m.geo === k).name, tris: un.find((m) => m.geo === k).tris }))
      .sort((a, b) => b.n - a.n).slice(0, 12);

    // For the single most-repeated geometry, dump the material fields that
    // merge.js's matSignature compares, and report how many DISTINCT values each
    // takes across its copies. A field with N distinct values across N copies is
    // what is defeating the merge; a field constant across all of them is not.
    const sigDetail = (() => {
      let bestGeo = null, bestN = 0;
      for (const [k, n] of byGeo) if (n > bestN) { bestN = n; bestGeo = k; }
      if (!bestGeo) return null;
      const copies = un.filter((m) => m.geo === bestGeo);
      // Read the material off the record directly. Walking the scene again by id
      // was the bug: it silently returned undefined and every field counted 0.
      const mats = copies.map((m) => m.matObj).filter(Boolean);
      const fields = ["color", "emissive", "emissiveIntensity", "roughness", "metalness", "opacity", "alphaTest", "transparent", "depthWrite", "blending", "side", "shadowSide"];
      const tally = {};
      for (const f of fields) {
        const s = new Set();
        for (const mm of mats) {
          if (f === "color" || f === "emissive") { const c = mm[f]; if (c) s.add(c.getHexString()); }
          else if (typeof mm[f] === "number" || typeof mm[f] === "boolean" || typeof mm[f] === "string") s.add(String(mm[f]));
        }
        tally[f] = s.size;
      }
      const colors = mats.filter((mm) => mm.color).map((mm) => mm.color.getHexString());
      // how many distinct SIGNATURES merge.js would actually compute
      const sigOf = (mm) => [mm.type, mm.color && mm.color.getHexString(), mm.emissive && mm.emissive.getHexString(),
        mm.emissiveIntensity, mm.roughness, mm.metalness, mm.opacity, mm.alphaTest, mm.transparent,
        mm.depthTest, mm.depthWrite, mm.blending, mm.side, mm.shadowSide].join("|");
      const distinctSigs = new Set(mats.map(sigOf)).size;
      return { geo: bestGeo, n: copies.length, withMat: mats.length, tally, distinctSigs, sample: colors.slice(0, 10) };
    })();
    const topMat = [...byMat.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);

    const topOwners = [...byOwner.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
    const topTris = [...top].sort((a, b) => b.tris - a.tris).slice(0, 10);
    return {
      inFrustum, totalTris: Math.round(totalTris),
      unCount: un.length,
      unGeoCount: byGeo.size, unMatCount: byMat.size,
      unTopGeo: topGeo, unTopMat: topMat, sigDetail,
      unLateEligible: un.filter((m) => m.lateEligible).length,
      unInCullGroup: un.filter((m) => m.inCullGroup).length,
      unRootDetail: (() => {
        const byRoot = new Map();
        for (const m of un) {
          const o = g.scene.getObjectById(m.id);
          if (!o) continue;
          let n = o; while (n.parent && n.parent !== g.scene) n = n.parent;
          const keys = n.userData ? Object.keys(n.userData).join(",") || "(empty)" : "(none)";
          const k = `${n.type}|${n.name || "(unnamed)"}|ud:${keys}`;
          byRoot.set(k, (byRoot.get(k) || 0) + 1);
        }
        return [...byRoot.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
      })(), unTopRoot: [...byRoot.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8),
      vehInFrustum: vDists.length,
      vehP50: pct(0.5), vehP90: pct(0.9), vehMax: pct(0.999),
      within110: vDists.filter((d) => d < 110).length,
      within60: vDists.filter((d) => d < 60).length,
      vehOrigins: [...vOrigins.entries()].sort((a, b) => b[1] - a[1]),
      topOwners,
      byKind: [...byKind.entries()].sort((a, b) => b[1] - a[1]),
      byDepth: [...byDepth.entries()],
      topTris,
    };
  }, x, z);

for (const [name, x, z] of SITES) {
  console.log(`\n======== ${name}  (${x}, ${z}) ========`);
  const a = await attribute(x, z);
  console.log(`meshes in frustum: ${a.inFrustum}   triangles: ${a.totalTris.toLocaleString()}`);

  console.log(`\n  by owner (top 10 of ${a.topOwners.length}+):`);
  for (const [o, n] of a.topOwners) console.log(`    ${String(n).padStart(6)}  ${o}`);

  if (a.vehInFrustum) {
    console.log(`\n  vehicles in frustum: ${a.vehInFrustum}  (of which ${a.within60} within 60 m, ${a.within110} within 110 m)`);
    console.log(`  distance from camera: p50 ${a.vehP50} m, p90 ${a.vehP90} m, max ${a.vehMax} m`);
    console.log(`  lamp gate at 110 m would hide ${a.vehInFrustum - a.within110} of ${a.vehInFrustum} (${Math.round(((a.vehInFrustum - a.within110) / a.vehInFrustum) * 100)}%)`);
    console.log(`  origins: ${a.vehOrigins.map(([k, n]) => `${k.replace("vehicle:", "")}x${n}`).join(" ")}`);
  }
  if (a.unCount) {
    console.log(`\n  UNATTRIBUTED: ${a.unCount} meshes share only ${a.unGeoCount} geometries and ${a.unMatCount} materials`);
    console.log(`  most-reused geometries (count x tris):`);
    for (const g of a.unTopGeo) console.log(`    ${String(g.n).padStart(5)} x ${String(g.tris).padStart(6)} tris  ${g.name}`);
    console.log(`  materials: ${a.unTopMat.map(([k, n]) => `${k.split("|")[1]}x${n}`).join(" ")}`);
    if (a.sigDetail) {
      const d = a.sigDetail;
      console.log(`  most-repeated geometry x${d.n}: distinct values per merge-signature field`);
      console.log(`    ${Object.entries(d.tally).map(([f, n]) => `${f}=${n}`).join("  ")}`);
      console.log(`    distinct merge-signatures across ${d.withMat} materials: ${d.distinctSigs}`);
      console.log(`    sample colours: ${d.sample.join(" ")}`);
      console.log(`    late-pass eligible: ${a.unLateEligible} of ${a.unCount}   in a cullGroup: ${a.unInCullGroup} of ${a.unCount}`);
    console.log(`  scene-root children holding them (type|name|userData keys):`);
    for (const [k, n] of a.unRootDetail) console.log(`    ${String(n).padStart(5)}  ${k}`);
    }
    console.log(`  nearest scene-root child: ${a.unTopRoot.map(([k, n]) => `${k || "(unnamed)"}x${n}`).join(" ")}`);
  }
  console.log(`\n  by kind:`);
  for (const [k, n] of a.byKind) console.log(`    ${String(n).padStart(6)}  ${k}`);
  console.log(`  by nesting depth:`);
  for (const [k, n] of a.byDepth) console.log(`    ${String(n).padStart(6)}  ${k}`);

  console.log(`\n  heaviest single geometries:`);
  for (const t of a.topTris) console.log(`    ${String(t.tris).padStart(7)} tris  ${t.isInstanced ? `INSTANCED x${t.instCount}` : "single"}  ${t.owner}/${t.name}`);
}

await browser.close();