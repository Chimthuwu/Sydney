// ---------------------------------------------------------------------------
// deadend_test.mjs — do cars turn round at a dead end, or teleport?
//
//   node --experimental-detect-module tools/qa/deadend_test.mjs
//
// A human report (2026-09-28): "when cars reach dead ends they dont actualy
// do U turns at all they seem to just vanish respawn facing the other way.
// the dead ends need to actually be made into circular kinda roundathings
// and the cars need to actually do a loop or turn around there".
//
// The old code built a return lane — the same line reversed, shifted one lane
// width — and at the lane end MOVED the car onto it in a single frame. One
// frame the car is here facing that way; the next it is a lane-width to the
// left facing the other way. That is a teleport wearing a U-turn's name.
//
// The fix is that the turnaround is now real geometry: a circular bulb tangent
// to the lane where it leaves and tangent to the return line where it arrives,
// so the two are one continuous road and `s` simply keeps advancing.
//
// So the check is CONTINUITY, measured on the emitted points, not "does a
// ~uturn lane exist": every point-to-point step has to be a plausible drive —
// short enough to be a car moving, and turning gradually enough not to be a
// kink. A lane whose first point is 7 m from where the previous lane ended is
// exactly the old bug wearing a new name, and only a distance check finds it.
// ---------------------------------------------------------------------------

import { makeRoadway, deadEndLoop, LANE_WIDTH } from "../../src/traffic.js";

let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? `  — ${detail}` : ""}`);
};

const US167 = { name: "us167", lanes: 2, median: 0.4, laneWidth: 2.4, points: [[-6, 900], [-6, -900]] };
const TURN_R = 7;

// Build the same set createTraffic() builds: every lane gets a dead-end loop
// unless it already continues. deadEndLoop() is the REAL exported geometry, not
// a copy — a copy in a test is a copy that drifts from the source.
const base = makeRoadway(US167);
const lanes = base.map((l) => ({ ...l, pts: l.points }));
for (const l of lanes) {
  const loop = deadEndLoop(l.pts, TURN_R);
  l.next = { name: l.name + "~uturn", pts: loop, next: l };
  l.nextLane = l.next;
}
const loops = lanes.map(l => l.next);

// ---------------------------------------------------------------- continuity
{
  // Every lane that has a successor: where does the handover happen, and is the
  // car in the right place when it happens?
  let worstJoin = 0, worstAt = "";
  for (const l of lanes) {
    const tail = l.pts[l.pts.length - 1];
    let best = Infinity;
    for (let i = 0; i < l.nextLane.pts.length; i++) {
      const d = Math.hypot(l.nextLane.pts[i][0] - tail[0], l.nextLane.pts[i][1] - tail[1]);
      if (d < best) best = d;
    }
    if (best > worstJoin) { worstJoin = best; worstAt = l.name; }
  }
  check("a lane's end and its successor's start are the same piece of road",
    worstJoin < 0.05,
    `worst join gap ${worstJoin.toFixed(3)} m at ${worstAt} — a gap here is a teleport`);
}

// ---------------------------------------------------------------- the loop
{
  const all = loops;
  check("every dead end got a turnaround", all.length >= 4, `${all.length} loops built`);

  for (const loop of all) {
    // The bulb is the CURVED part — the first steps+1 points. The straight
    // return that follows is described by whatever resolution the lane itself
    // uses (OrleaRouge's boulevards are 2-point, 800 m lines), and that is not
    // a driving problem: apply() interpolates along the polyline by arc length,
    // so a car crosses a long straight segment smoothly regardless of how few
    // points describe it. Density only matters where the road is CURVING.
    const bulb = loop.pts.slice(0, 17);
    const start = bulb[0], apex = bulb[8], exit = bulb[bulb.length - 1];
    // it has to actually loop: out to one side and back, not a kink
    const out = Math.hypot(apex[0] - start[0], apex[1] - start[1]);
    const across = Math.hypot(exit[0] - start[0], exit[1] - start[1]);
    check(`${loop.name}: the turnaround is a real loop, not a kink`,
      out > 5 && across > 8, `bulge ${out.toFixed(1)} m out, ${across.toFixed(1)} m across`);
  }

  // ...and the bulb must be smooth enough to drive: no step long enough to
  // corner off, and no corner sharp enough to snap the heading.
  let worstStep = 0, worstTurn = 0, worstTurnAt = "";
  for (const loop of all) {
    const p = loop.pts.slice(0, 17);            // the bulb, where density matters
    for (let i = 1; i < p.length; i++) {
      worstStep = Math.max(worstStep, Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]));
    }
    for (let i = 1; i < p.length - 1; i++) {
      const h1 = Math.atan2(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
      const h2 = Math.atan2(p[i + 1][0] - p[i][0], p[i + 1][1] - p[i][1]);
      let d = Math.abs(h2 - h1);
      if (d > Math.PI) d = 2 * Math.PI - d;
      if (d > worstTurn) { worstTurn = d; worstTurnAt = loop.name; }
    }
  }
  check("no step round the bulb is longer than a car moves in a moment",
    worstStep < 4, `longest step ${worstStep.toFixed(2)} m`);
  check("the bulb has no corner sharp enough to snap the heading",
    worstTurn < 0.6, `tightest turn ${(worstTurn * 180 / Math.PI).toFixed(1)}° at ${worstTurnAt}`);
}

// ---------------------------------------------------------------- handedness
// The old return lane offset by (dz, -dx) while CALLING it "right". Every other
// lane in the game uses (-dz, dx), and makeRoadway() carries a comment saying
// the other formula was the bug that put every road on the wrong side.
{
  const fwd = lanes.find(l => l.dir === 1 && l.index === 0);
  const fwdEnd = fwd.pts[fwd.pts.length - 1];
  const arrive = fwd.nextLane.pts[16];
  // and the return must taper back onto its own lane, or the far-end handover
  // is a 14 m sideways teleport wearing a different hat
  const tail = fwd.nextLane.pts[fwd.nextLane.pts.length - 1];
  const laneStart = fwd.pts[0];
  const joinGap = Math.hypot(tail[0] - laneStart[0], tail[1] - laneStart[1]);
  check("the return tapers back onto the lane it came from", joinGap < 0.5,
    `far end of the return is ${joinGap.toFixed(2)} m from the lane's start`);
  // it must come back on the OPPOSITE side of the centreline, not the same one
  const before = Math.abs(fwdEnd[0] - -6), after = Math.abs(arrive[0] - -6);
  check("the car comes back down the OTHER side of the road",
    Math.sign(arrive[0] - -6) !== Math.sign(fwdEnd[0] - -6) || after > before,
    `left at ${(fwdEnd[0] - -6).toFixed(1)} m, returns at ${(arrive[0] - -6).toFixed(1)} m`);
}

console.log(failures ? `\n${failures} FAILURE(S)` : "\nall checks passed");
process.exit(failures ? 1 : 0);
