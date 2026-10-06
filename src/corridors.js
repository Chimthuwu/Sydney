// ---------------------------------------------------------------------------
// corridors.js — the profiles for roadside.js (TASK-084): US-167 north and
// south of the core, and the four connector highways from it to the districts.
//
// A composer road's side +1 is the RIGHT of the way it is drawn: heading north
// that is east, heading south west, heading east south, heading west north.
// (Billboard `side`, by contrast, is in the world: +1 east / south.)
// ---------------------------------------------------------------------------

import { buildRoadside } from "./roadside.js";
import { SPURS } from "./wonders.js";

const PINES = (kit, ctx, spacing = 11) => ({
  spacing,
  trunk: ctx.surface("dirt", 512).material(2, { color: 0xc9b49a, envMapIntensity: 0.7 }),
  foliage: ctx.surface("grass", 512).material(3, { color: 0xb9d69a, envMapIntensity: 0.8 }),
});

export function buildCorridors(R) {
  const { ctx, kit } = R;
  const pines = (s) => PINES(kit, ctx, s);
  const cypress = (s) => ({ spacing: s, shape: kit.props.cypressShape(), trunk: kit.mat(0x4a3d30, "cypress trunk bark", 0.95), foliage: kit.mat(0x2a4a30, "cypress leaves foliage", 0.9) });
  const scrub = (s) => ({ spacing: s, shape: kit.props.scrubShape(), trunk: kit.mat(0x5a4a3a, "scrub trunk bark", 0.95), foliage: kit.mat(0x6a6a3a, "scrub dry leaves foliage", 0.95) });

  // ---- the four connectors: from the junction on US-167 to where each district's own frontage takes over
  buildRoadside(R, {
    name: "Oyster approach", seed: 61001, bounds: { x0: 60, x1: 392, z0: 530, z1: 670 },
    road: { name: "Oyster Highway", points: [[70, 600], [392, 600]], width: 10 },
    profile: {
      mix: [[3, "farm"], [2, "bungalow"], [2, "trailer"], [2, "stand"], [1, "gas"], [1, "church"], [1, "cottage"], [1, "daiquiri"], [1, "crawfish"]], density: 0.5, spacing: 38,
      forced: [{ at: 120, side: 1, kind: "gas" }],
      billboards: [{ at: 150, side: -1, ry: -Math.PI / 2, headline: "OYSTER BAY", sub: "Fresh seafood · 12 miles", graffiti: "OVERRATED" }],
      forest: pines(12),
    },
  });
  buildRoadside(R, {
    name: "Port approach", seed: 61002, bounds: { x0: 60, x1: 392, z0: -670, z1: -530 },
    road: { name: "Port Highway", points: [[70, -600], [392, -600]], width: 12 },
    profile: {
      mix: [[3, "shed"], [2, "tire"], [2, "trailer"], [1, "gas"], [1, "diner"], [1, "farm"]], density: 0.55, spacing: 38,
      forced: [{ at: 150, side: -1, kind: "gas" }],
      billboards: [{ at: 210, side: 1, ry: -Math.PI / 2, headline: "PORT CALYPSO", sub: "Now hiring · Union preferred" }],
      forest: pines(13),
    },
  });
  buildRoadside(R, {
    name: "Red Dust approach", seed: 61003, bounds: { x0: -392, x1: -70, z0: -670, z1: -530 },
    road: { name: "Red Dust Pass", points: [[-70, -600], [-392, -600]], width: 9 },
    profile: {
      mix: [[3, "trailer"], [2, "shotgun"], [2, "cabin"], [1, "stand"], [1, "gas"], [1, "farm"]], density: 0.4, spacing: 42,
      billboards: [{ at: -200, side: -1, ry: Math.PI / 2, headline: "RED DUST", sub: "Population: ask around", graffiti: "DON'T" }],
      forest: scrub(16),
    },
  });
  buildRoadside(R, {
    name: "Lakeshore approach", seed: 61004, bounds: { x0: -392, x1: -70, z0: 680, z1: 820 },
    road: { name: "Lakeshore Causeway", points: [[-70, 750], [-392, 750]], width: 12 },
    profile: {
      mix: [[3, "cabin"], [3, "stilt"], [2, "stand"], [1, "trailer"], [1, "gas"], [1, "church"]], density: 0.5, spacing: 36,
      billboards: [{ at: -220, side: 1, ry: Math.PI / 2, headline: "AIRBOAT TOURS", sub: "See a real gator · 6 miles", graffiti: "OR BE ONE" }],
      forest: cypress(11),
    },
  });

  // ---- US-167 beyond the core. Junction stubs are registered so nothing is built across a side road.
  buildRoadside(R, {
    name: "US-167 north", seed: 62001, bounds: { x0: -70, x1: 60, z0: -1200, z1: -424 },
    road: { name: "US-167 north", points: [[-6, -430], [-6, -1190]], width: 10 },
    junctions: [{ name: "Port Highway stub", points: [[-6, -600], [60, -600]], width: 12 }, { name: "Red Dust stub", points: [[-6, -600], [-70, -600]], width: 9 },
      { name: "Pecan Grove stub", points: [[-6, -458], [60, -458]], width: 8 }, { name: "Sawmill stub", points: [[-6, -458], [-70, -458]], width: 8 }],
    avoid: [{ at: -600, r: 34 }, { at: -458, r: 30 }],
    profile: {
      mix: [[4, "farm"], [2, "bungalow"], [2, "trailer"], [2, "stand"], [1, "gas"], [1, "church"], [1, "cabin"], [1, "danceHall"], [1, "daiquiri"], [1, "crawfish"]], density: 0.5, spacing: 44, footprint: { w: 30, d: 28 },
      forced: [{ at: -760, side: 1, kind: "gas" }, { at: -760, side: -1, kind: "diner" }, { at: -940, side: 1, kind: "motel" }, { at: -1040, side: -1, kind: "popeyes" }],
      // -520 and -700 were inside Chatboro (z -720..-500), where roadside.js now
      // refuses to place anything. Moved onto the approaches either side of the
      // village, which is where a highway sign belongs anyway: you read them on
      // the way in and on the way out.
      billboards: [
        { at: -470, side: 1, ry: 0, headline: "PORT CALYPSO", sub: "Next right at Chatboro · Now hiring" },
        { at: -810, side: -1, ry: Math.PI, headline: "TUSOUXROE", sub: "Home of the potholes", graffiti: "FIX THEM" },
        { at: -880, side: 1, ry: 0, headline: "BIG SAM'S", sub: "Truck stop · Showers · Pie" },
        { at: -1100, side: -1, ry: 0, headline: "LEAVING DIXIE", sub: "Y'all come back now", graffiti: "PLEASE" },
      ],
      forest: pines(10),
    },
  });
  buildRoadside(R, {
    name: "US-167 south", seed: 62002, bounds: { x0: -70, x1: 60, z0: 424, z1: 1200 },
    road: { name: "US-167 south", points: [[-6, 430], [-6, 1190]], width: 10 },
    junctions: [{ name: "Oyster Highway stub", points: [[-6, 600], [60, 600]], width: 10 }, { name: "Causeway stub", points: [[-6, 750], [-70, 750]], width: 12 }],
    avoid: [{ at: 600, r: 34 }, { at: 750, r: 34 }],
    profile: {
      mix: [[3, "cabin"], [3, "stilt"], [2, "trailer"], [2, "stand"], [1, "gas"], [1, "church"], [1, "cottage"], [2, "danceHall"], [1, "daiquiri"], [2, "crawfish"]], density: 0.5, spacing: 44, footprint: { w: 30, d: 28 },
      forced: [{ at: 900, side: -1, kind: "gas" }, { at: 900, side: 1, kind: "diner" }, { at: 1040, side: 1, kind: "popeyes" }],
      billboards: [
        { at: 500, side: 1, ry: Math.PI, headline: "OYSTER BAY", sub: "Right at the light · Shrimp Fest", graffiti: "NO" },
        { at: 690, side: -1, ry: 0, headline: "LAKESHORE", sub: "Bait · Beer · Bad ideas" },
        { at: 1000, side: 1, ry: Math.PI, headline: "MARSH TOURS", sub: "Every hour on the hour" },
        { at: 1120, side: -1, ry: Math.PI, headline: "BAYOU BAPTIST", sub: "All are welcome (not gators)", graffiti: "AMEN" },
      ],
      forest: cypress(10),
    },
  });

  // ---- a country track through the forest from Port Calypso to Oyster Bay (dirt, no traffic lanes, no poles)
  buildRoadside(R, {
    name: "Delta Road", seed: 63001, bounds: { x0: 690, x1: 870, z0: -430, z1: 436 },
    road: { name: "Delta Road", points: [[750, -420], [750, -40], [805, -40], [805, 436]], width: 6, dirt: true },
    poles: false,
    junctions: SPURS.map((s) => ({ name: s.name + " (Delta junction)", points: s.points, width: s.width })),      // wonders.js: the spurs stay road in Delta's grid
    profile: {
      mix: [[3, "farm"], [3, "cabin"], [2, "trailer"], [2, "bungalow"], [1, "stand"], [1, "shed"]], density: 0.4, spacing: 46, setback: 16, footprint: { w: 24, d: 26 },
      startAt: 30, endAt: 30, forest: pines(11),
    },
  });

  // ---- the west band (x -1050..-450, z -350..350), which no road reached: a gravel road west off Parish Highway 9's bend, and a fork north through
  // the pines to the Red Dust country. Dirt, frontage of cabins and stilt shacks, a lane each way so traffic uses them.
  const WEST_Z = 300;         // south of Nirbayou Nolantis's dome (nolantis.js: centre -720, 110, radius 155)
  buildRoadside(R, {
    name: "Bayou Pines Road", seed: 63002, bounds: { x0: -1050, x1: -378, z0: 250, z1: 345 },
    road: { name: "Bayou Pines Road", points: [[-378, WEST_Z], [-1040, WEST_Z]], width: 7, dirt: true },
    poles: false,
    junctions: [{ name: "Cypress Fork (junction)", points: [[-500, WEST_Z], [-500, 250]], width: 7 }],
    avoid: [{ at: -500, r: 16 }],
    profile: {
      mix: [[3, "cabin"], [3, "trailer"], [2, "stilt"], [2, "shed"], [1, "stand"], [1, "church"], [1, "farm"]], density: 0.45, spacing: 44, setback: 15, footprint: { w: 24, d: 24 },
      forced: [{ at: -640, side: 1, kind: "gas" }],
      billboards: [{ at: -420, side: -1, ry: Math.PI / 2, headline: "BAYOU PINES", sub: "Population: mostly", graffiti: "TURN BACK" }],
      startAt: 24, endAt: 30, forest: pines(11),
    },
  });
  buildRoadside(R, {
    name: "Cypress Fork", seed: 63003, bounds: { x0: -560, x1: -440, z0: -330, z1: 297.5 }   /* stops at the main road's edge: its region must not claim the road's own cells */,
    road: { name: "Cypress Fork", points: [[-500, 297], [-500, -320]], width: 7, dirt: true },
    poles: false,
    profile: {
      mix: [[3, "cabin"], [2, "shed"], [2, "stilt"], [2, "trailer"], [1, "stand"]], density: 0.4, spacing: 46, setback: 15, footprint: { w: 24, d: 24 },
      startAt: 40, endAt: 30, forest: cypress(11),
    },
  });
  const westLane = (name, pts) => R.lanes.push({ name, points: pts, cruise: [9, 14] });
  westLane("pines-west", [[-378, WEST_Z - 2.2], [-1040, WEST_Z - 2.2]]);
  westLane("pines-east", [[-1040, WEST_Z + 2.2], [-378, WEST_Z + 2.2]]);
  westLane("fork-north", [[-497.8, WEST_Z - 8], [-497.8, -320]]);
  westLane("fork-south", [[-502.2, -320], [-502.2, WEST_Z - 8]]);
  R.minimap.roads.push({ points: [[-378, WEST_Z], [-1040, WEST_Z]], width: 7, color: "#8a7a5a" }, { points: [[-500, WEST_Z], [-500, -320]], width: 7, color: "#8a7a5a" });

  // ---- the gap between Chatboro (z -724..-496) and the Crown Strip's tower (z -400): a crossroads on US-167 at z -458, east and west, paved,
  // with farms and roadside frontage. (Density map 2026-09-27: these cells held 0-8 blockers against 10-20 elsewhere.)
  const XZ = -458;
  buildRoadside(R, {
    name: "Pecan Grove Road", seed: 63004, bounds: { x0: 6, x1: 392, z0: -494, z1: -418 },
    road: { name: "Pecan Grove Road", points: [[6, XZ], [385, XZ]], width: 8, asphalt: true, centreLine: true },
    poles: true,
    profile: {
      mix: [[3, "farm"], [3, "bungalow"], [2, "cottage"], [2, "trailer"], [1, "stand"], [1, "church"], [1, "danceHall"], [1, "crawfish"]], density: 0.5, spacing: 40, setback: 20, footprint: { w: 26, d: 24 },
      forced: [{ at: 120, side: 1, kind: "gas" }],
      billboards: [{ at: 60, side: -1, ry: -Math.PI / 2, headline: "PECAN GROVE", sub: "Pick-your-own · Sundays", graffiti: "NO PICKING" }],
      startAt: 24, endAt: 30, forest: pines(12),
    },
  });
  buildRoadside(R, {
    name: "Sawmill Road", seed: 63005, bounds: { x0: -392, x1: -18, z0: -494, z1: -418 },
    road: { name: "Sawmill Road", points: [[-385, XZ], [-18, XZ]], width: 8, asphalt: true, centreLine: true },
    poles: true,
    profile: {
      mix: [[3, "shed"], [3, "cabin"], [2, "trailer"], [2, "tire"], [2, "bungalow"], [1, "stand"], [1, "diner"]], density: 0.5, spacing: 40, setback: 20, footprint: { w: 26, d: 24 },
      forced: [{ at: -160, side: -1, kind: "diner" }],
      billboards: [{ at: -80, side: 1, ry: Math.PI / 2, headline: "SAWMILL RD", sub: "Lumber · Lye · Lawyers", graffiti: "" }],
      startAt: 24, endAt: 30, forest: pines(12),
    },
  });
  R.lanes.push(
    { name: "pecan-east", points: [[6, XZ + 2.2], [385, XZ + 2.2]], cruise: [12, 18] },
    { name: "pecan-west", points: [[385, XZ - 2.2], [6, XZ - 2.2]], cruise: [12, 18] },
    { name: "sawmill-west", points: [[-18, XZ - 2.2], [-385, XZ - 2.2]], cruise: [12, 18] },
    { name: "sawmill-east", points: [[-385, XZ + 2.2], [-18, XZ + 2.2]], cruise: [12, 18] });
  R.minimap.roads.push({ points: [[6, XZ], [385, XZ]], width: 8 }, { points: [[-385, XZ], [-18, XZ]], width: 8 });
}
