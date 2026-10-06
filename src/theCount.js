// ---------------------------------------------------------------------------
// theCount.js — ACT TWO, the first mission: "THE COUNT".
//
// Keseme says the plan herself, in the elevator up from Nolantis (nolantis.js
// returnScene): "Find out who threatened my mother." · "Find out who owns
// Pelican Crown." · "Then we find out how many people they're hurting." The
// first is the night ride (klan.js), which ends on the ACT TWO card and Mercer's
// "Ask who's buying up this whole parish". Nothing came after it. This does.
//
// It is the montage's question answered on the ground. welcomeback.js has her
// say it over Dixie Beaux — "Oil. Gas. Shipping containers. Casinos. Chemical
// plants. Tourism… Who keeps taking it?" — and every one of those is now a place
// on the map. So she goes to them, and at each she counts the people. Counting
// is hers: it is how she gets through a raid in bluelight.js, and the one thing
// Bellefontaine's plan in the Sheriff's Office cannot survive, because "nobody
// believes her" is a plan against a girl and not against a number. It ends with
// the number taken to Solange — a journalist, which is who Bellefontaine admits
// people believe — and the filings pointing at one address: step two.
//
// The new towns enter the story here and only here. The original script files
// (prologue, actone, bluelight, nolantis, welcomeback, alternateCampaign) are
// not touched: this starts from klan.js's onDone, through main.js.
//
// Tone, and the line this holds: the places do the talking. Each stop is a card,
// what she sees, a few lines with somebody who lives with it, and the tally —
// no speeches. The prison stops are real Louisiana: a penitentiary on a former
// plantation's land, still called "the Farm", picking crews at cents an hour,
// a population two-thirds Black in a state one-third Black, and a private
// operator paid to keep the beds full.
// ---------------------------------------------------------------------------

import * as THREE from "three";

/**
 * The stops. Free order: the radar always points at the nearest one not yet
 * counted. `look` is what the camera frames (x, y, z); `beats` are the scene,
 * ["", text] for an action line, [WHO, text] for dialogue. `n` is the count
 * this place adds, `company` the Pelican Crown name it is filed under.
 */
export const STOPS = Object.freeze([
  {
    id: "downtown", place: "DOWNTOWN BAYOU", x: 112, z: 6, look: [70, 18, -30],
    sub: "Crown Tower Partners · 61% of the windows dark", company: "Crown Tower Partners", n: 1900,
    beats: [
      ["", "Glass towers either side of the highway. Barely nine at night, and most of the windows are dark."],
      ["DOORMAN", "Residents? Ma'am, nobody lives here. People own here."],
      ["KESEME", "How many units?"],
      ["DOORMAN", "Six hundred and forty. Lights on in maybe two hundred."],
      ["", "Across the avenue, the shelter's line goes round the block."],
      ["KESEME", "And how many on the shelter list?"],
      ["DOORMAN", "City says nineteen hundred. City undercounts."],
    ],
  },
  {
    id: "harborlight", place: "HARBORLIGHT HOSPITAL", x: -65, z: -254, look: [-65, 8, -236],   // out front on Crown Boulevard: the POI is inside the building
    sub: "The Crown Strip · bought by Crown Health", company: "Crown Health", n: 3412,
    beats: [
      ["", "The billing office has its own door round the side, and its own guard."],
      ["NURSE", "Since Crown bought us, we sue our own patients. Every Thursday, a stack."],
      ["KESEME", "How big a stack?"],
      ["NURSE", "Three thousand four hundred and twelve, last count. Half of them work here."],
      ["KESEME", "Down there, nobody goes bankrupt because they're sick."],
      ["NURSE", "Down where?"],
      ["KESEME", "Nowhere."],
    ],
  },
  {
    id: "riveredge", place: "THE RIVER EDGE", x: -242, z: 155, look: [-242, 4, 164],
    sub: "Pelican Crown Logistics · warehouses one to six", company: "Pelican Crown Logistics", n: 218,
    beats: [
      ["", "Six warehouses on the canal. One name stencilled on every dock door."],
      ["DOCKHAND", "Contractors, all of us. No overtime. No comp if a pallet comes down on you."],
      ["KESEME", "How many of you?"],
      ["DOCKHAND", "Two-eighteen on the roster. Roster says independent. We clock in on their app."],
      ["", "The injury log is chained to the wall by the time clock. It starts on page two."],
    ],
  },
  {
    id: "westbank", place: "THE WEST BANK", x: -280, z: 330, look: [-312, 3, 330],
    sub: "Crown Mutual Insurance · non-renewal notices", company: "Crown Mutual", n: 2860,
    beats: [
      ["", "Every second porch has the same envelope taped inside the screen door."],
      ["NEIGHBOUR", "Crown Mutual dropped the whole West Bank. Says we're outside the protection zone."],
      ["KESEME", "You're inside the floodwall. I can see it from here."],
      ["NEIGHBOUR", "Their map stops at that avenue. The bank's map stopped there too, in 1938. They drew it in red."],
      ["KESEME", "How many on this side of the line?"],
      ["NEIGHBOUR", "Twenty-eight hundred and sixty. My grandmother was one of them the first time."],
    ],
  },
  {
    id: "bayounoir", place: "BAYOU NOIR", x: -246, z: -30, look: [-292, 14, -52],
    sub: "Pop. 212 · \"PELICAN CROWN WANTS YOUR LAND\"", company: "Belle Holdings", n: 212,
    beats: [
      ["", "Somebody painted it on the water tower. Nobody has painted over it."],
      ["DEACON", "Freedmen built this town in 1867, on land off the Belle place. Nobody wrote wills. Who'd honour them?"],
      ["DEACON", "Now a lawyer finds one cousin in Houston, buys her share for four thousand dollars, and forces a sale of the lot."],
      ["KESEME", "How many families?"],
      ["DEACON", "All of them, eventually. That's the idea, isn't it?"],
      ["KESEME", "Two hundred and twelve."],
    ],
  },
  {
    id: "petrochemical", place: "PELICAN PETROCHEMICAL", x: 856, z: -44, look: [930, 20, -130],
    sub: "River Road · \"0 DAYS SINCE LAST INCIDENT\"", company: "Pelican Petrochemical", n: 1460,
    beats: [
      ["", "The flare has not gone out since 1971. The houses on the fenceline were here first."],
      ["", "A church van parks across the road: free cancer screening, every second Saturday."],
      ["RESIDENT", "Company pays for the van. Company won't fix the stack. Make that make sense."],
      ["KESEME", "How many people inside a mile of the fence?"],
      ["RESIDENT", "Fourteen hundred and sixty. We know because we counted ourselves. Nobody else would."],
    ],
  },
  {
    id: "reddust", place: "RED DUST", x: -560, z: -706, look: [-560, 4, -716],
    sub: "Crown Energy · thirty-one wells, one schoolhouse", company: "Crown Energy", n: 340,
    beats: [
      ["", "Derricks nodding on the ridge. The schoolhouse is boarded up with the company's own plywood."],
      ["", "Blue water jugs on every porch."],
      ["RANCHER", "Tap water catches if you put a match to it. Company trucks jugs in on Tuesdays. For the cameras."],
      ["KESEME", "And the school?"],
      ["RANCHER", "Closed when the families went. Three hundred forty of us left. The wells don't care."],
    ],
  },
  {
    id: "oysterbay", place: "OYSTER BAY", x: 720, z: 912, look: [720, 2, 945],
    sub: "Front Street docks · the beds are dead", company: "Crown Marine Terminals", n: 400,
    beats: [
      ["", "Boats tied up three deep. Half of them have FOR SALE written on the wheelhouse in marker."],
      ["OYSTERMAN", "Port Calypso dredged the channel deeper for the container ships. The salt came up the bay behind them."],
      ["OYSTERMAN", "Oysters want it brackish. Now it's the Gulf. My daddy's beds, my granddaddy's. Shells."],
      ["KESEME", "How many boats?"],
      ["OYSTERMAN", "Ninety-six licences. Call it four hundred people eating off them. Used to."],
    ],
  },
  {
    id: "portcalypso", place: "PORT CALYPSO", x: 846, z: -700, look: [846, 25, -800],
    sub: "Crown Marine Terminals · the manifests", company: "Crown Marine Terminals", n: 640,
    beats: [
      ["", "Cranes working all night over a container ship three hundred metres long."],
      ["CLERK", "Six hundred forty longshoremen, every one casual. Called at five in the morning, or not at all."],
      ["KESEME", "What are they loading?"],
      ["CLERK", "Hot sauce. Mattresses. Licence plates. Uniforms. Same shipper on half the manifests."],
      ["", "She photographs one. SHIPPER: BAYOU STATE INDUSTRIES · \"THE FARM\"."],
      ["KESEME", "That's the prison."],
    ],
  },
  {
    id: "pepperworks", place: "HOT BAYOU PEPPER WORKS", x: 880, z: 150, look: [860, 1, 122],
    sub: "Pepper Lane · \"Est. 1868 · The Original Recipe\"", company: "Hot Bayou", n: 180,
    beats: [
      ["", "Floodlights over the rows, and a white bus with barred windows at the end of them. Every picker wears the same orange."],
      ["", "A guard on horseback watches them work, a shotgun across the saddle."],
      ["KESEME", "What do they pay you?"],
      ["PICKER", "Two cents an hour. Goes up to twenty if you keep your head down a few years."],
      ["PICKER", "Tasting room sells a bottle for nine dollars."],
      ["KESEME", "How many on the bus?"],
      ["PICKER", "Hundred and eighty. Every day."],
    ],
  },
  {
    id: "belle", place: "BELLE PLANTATION", x: 568, z: -260, look: [548, 8, -260],
    sub: "Belle Holdings · tours on the hour", company: "Belle Holdings", n: 214,
    beats: [
      ["", "The ghost tour, by lantern, under the oaks. The guide does the voices of the family's ghosts: the bride, the colonel, the little boy on the stairs."],
      ["", "The sign by the sugar kettles says SUGAR MADE THIS FAMILY'S FORTUNE. There is no ghost story about who stirred them."],
      ["KESEME", "The people who worked those kettles. Do you have their names?"],
      ["GUIDE", "We have the plantation book. In the archive. It's… an inventory."],
      ["", "Two hundred and fourteen names, between the mules and the tools. A price beside each one."],
      ["GUIDE", "The north tract was leased to the state in 1880. For the convict farm. Same fields."],
      ["KESEME", "Same fields. Different book."],
      ["KESEME", "They're past hurting these ones. I'm counting them anyway."],
    ],
  },
  {
    id: "penitentiary", place: "BAYOU STATE PENITENTIARY", x: 1092, z: 300, look: [1078, 7, 300],
    sub: "\"The Farm\" · operated by Crown Correctional", company: "Crown Correctional", n: 4920,
    beats: [
      ["", "The cane in the far fields grows where Belle's did. The tower lights sweep over it all night."],
      ["", "Families asleep in their cars in the lot, to be first in the visitors' line at seven. Almost nobody in them is white."],
      ["VISITOR", "State's one in three Black. In there it's two in three. You do that math."],
      ["VISITOR", "Crown runs it on contract. State promised them ninety-six percent full, or the state pays for the empty beds."],
      ["KESEME", "They get paid to keep it full."],
      ["VISITOR", "Baby, everybody in this line knows that."],
      ["KESEME", "Five thousand one hundred. Less the hundred and eighty I counted in the peppers."],
    ],
  },
  {
    id: "casinorow", place: "CASINO ROW", x: -238, z: -904, look: [-262, 15, -904],
    sub: "Shruston · Crown Gaming", company: "Crown Gaming", n: 2700,
    beats: [
      ["", "Two resorts on the lake, lit all night. Between them, pawn shops and title loans under the same crown."],
      ["CASHIER", "They lose it inside, we lend it back outside. Four hundred percent. Same company, different door."],
      ["KESEME", "How many people owe you?"],
      ["CASHIER", "This store, nine hundred. The chain, twenty-seven hundred across the parish."],
    ],
  },
]);

/** Everyone counted, when every stop is done. Read by the finale, so it is never written out by hand. */
export const TOTAL = STOPS.reduce((s, p) => s + p.n, 0);

// Solange's corner from Blue Light Special (bluelight.js MEET): the French
// District sidewalk on street 250, where she told Keseme "it's worse, it's business".
const SOLANGE = { x: -26, z: 254.5, r: 9, look: [-26, 2, 250] };
// Cloudline Tower, the Crown Strip's tallest (crownstrip.js POI -40, -400), from
// the clear ground beside its west face: the POI itself is inside the tower.
const ADDRESS = { x: -55, z: -400, r: 12, look: [-40, 60, -400] };
const REACH = 12;                                   // metres: close enough, on foot or at the kerb in a car

const fmt = (n) => n.toLocaleString("en-US");
const WORDS = (n) => n === TOTAL ? "Nineteen thousand four hundred and fifty-six." : fmt(n) + ".";

/**
 * @param {object} ctx from main.js:
 *   scene, cine, state, playerPos, flashObjective(text), setObjective(text|null),
 *   exitVehicle(), setCameraYaw?(yaw)
 */
export function createTheCount(ctx) {
  const { cine, state, playerPos } = ctx;
  let phase = "idle";          // idle | opening | count | report | address | done
  const counted = new Set();
  let total = 0;
  let busy = false;

  // a column of light over whichever place the radar points at, so it can be
  // found from the road and not only on the minimap
  let marker = null;
  if (ctx.scene) {
    const m = new THREE.MeshBasicMaterial({ color: 0xff4a3c, transparent: true, opacity: 0.32, depthWrite: false });
    m.userData.gtbRealized = true;
    marker = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 60, 16, 1, true), m);
    marker.position.y = 30;
    marker.visible = false;
    ctx.scene.add(marker);
  }

  const remaining = () => STOPS.filter((s) => !counted.has(s.id));
  function nearest() {
    let best = null, bd = Infinity;
    for (const s of remaining()) {
      const d = Math.hypot(playerPos.x - s.x, playerPos.z - s.z);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }
  function target() {
    if (phase === "count") return nearest();
    if (phase === "report") return SOLANGE;
    if (phase === "address") return ADDRESS;
    return null;
  }

  /** The camera, from behind and above Keseme toward what she is looking at. */
  function frame(c, look, dur = 6) {
    const dx = playerPos.x - look[0], dz = playerPos.z - look[2];
    const d = Math.hypot(dx, dz) || 1;
    const ux = dx / d, uz = dz / d;
    return c.shot({
      from: [playerPos.x + ux * 6 - uz * 2.5, 2.6, playerPos.z + uz * 6 + ux * 2.5],
      to: [playerPos.x + ux * 4.5 - uz * 1.5, 2.2, playerPos.z + uz * 4.5 + ux * 1.5],
      look, dur,
    });
  }

  async function play(c, beats) {
    for (const [who, text] of beats) {
      if (who) await c.say(who, text);
      else await c.caption(text);
    }
  }

  /** Run a scene with the world held still, and always hand control back. */
  function scene(fn, then) {
    busy = true;
    state.cinematic = true;
    if (ctx.exitVehicle) ctx.exitVehicle();
    const done = () => { state.cinematic = false; busy = false; if (then) then(); };
    return cine.scene(async (c) => { c.letterbox(true); await fn(c); }).then(done, done);
  }

  function opening() {
    phase = "opening";
    return scene(async (c) => {
      await c.caption("Before dawn. The house is still smoking. Emiko is asleep in the back of the car.");
      await c.say("KESEME", "Mercer said ask who's buying the parish.");
      await c.say("EMIKO", "Baby, they don't buy a parish. They buy it a house at a time.");
      await c.say("EMIKO", "Mine was the one they couldn't buy.");
      await c.caption("Keseme opens the ledger. Company names down the margin, a place beside each one.");
      await c.say("KESEME", "Then I want the number.");
      await c.card("MISSION", "THE COUNT", "Every place they're hurting people. Count them.", { center: true, hold: 3 });
    }, () => {
      phase = "count";
      ctx.flashObjective(`THE COUNT — ${STOPS.length} places. The radar has the nearest.`);
    });
  }

  function visit(stop) {
    return scene(async (c) => {
      await c.card("EXT.", stop.place, stop.sub);
      frame(c, stop.look, 8);
      await play(c, stop.beats);
      counted.add(stop.id);
      total += stop.n;
      await c.card("THE COUNT", `${fmt(total)} people`, `${stop.place} +${fmt(stop.n)} · ${counted.size} / ${STOPS.length} places`, { hold: 2.4 });
    }, () => {
      if (counted.size < STOPS.length) return;
      phase = "report";
      ctx.flashObjective("That's all of them. Take the number to Solange — the French District, where you met.");
    });
  }

  function finale() {
    return scene(async (c) => {
      await c.card("EXT.", "THE FRENCH DISTRICT", "Solange Duval's corner");
      frame(c, SOLANGE.look, 10);
      await c.say("SOLANGE", "You said you had numbers.");
      await c.say("KESEME", WORDS(total));
      await c.say("SOLANGE", "People?");
      await c.say("KESEME", "People. Thirteen places. The hospital, the insurance, the wells, the docks, the casino, the prison.");
      await c.say("SOLANGE", "A girl from Tusouxroe, they can call a liar. Nineteen thousand people is harder.");
      await c.caption("Solange spreads the filings across a café table, one per company. She stops.");
      await c.say("SOLANGE", "Look at the registered agent.");
      await c.say("SOLANGE", "Every one of them. Same address. Cloudline Tower, forty-fourth floor.");
      await c.say("KESEME", "So that's who owns Pelican Crown.");
      await c.say("SOLANGE", "That's where they keep the door. Who's behind it is the next question.");
      await c.card("ACT TWO", "THE COUNT", `${fmt(total)} people. One address.`, { center: true, hold: 3.2 });
    }, () => {
      phase = "address";
      ctx.flashObjective("Find out who owns Pelican Crown — Cloudline Tower, on the Crown Strip.");
    });
  }

  function lobby() {
    return scene(async (c) => {
      frame(c, ADDRESS.look, 7);
      await c.caption("The lobby directory runs from 1 to 43. The elevator panel stops at 43 as well.");
      await c.caption("A forty-fourth floor is lit at the top of the tower. There is no button for it.");
      await c.say("KESEME", "Course there isn't.");
    }, () => {
      phase = "done";
      ctx.flashObjective("Who owns Pelican Crown? The forty-fourth floor. To be continued.");
    });
  }

  return {
    /** Act Two opens (klan.js night ride, through main.js): start the mission. */
    start() {
      if (phase !== "idle") return false;
      opening();
      return true;
    },
    update() {
      const t = target();
      if (marker) {
        marker.visible = !!t && !state.cinematic;
        if (t) marker.position.set(t.x, 30, t.z);
      }
      if (phase === "count") {
        const n = t;
        ctx.setObjective(`THE COUNT · ${counted.size} / ${STOPS.length} places · ${fmt(total)} people — nearest: ${n ? n.place : "—"}`);
      } else if (phase === "report") ctx.setObjective("THE COUNT · take the number to Solange in the French District");
      else if (phase === "address") ctx.setObjective("Find out who owns Pelican Crown — Cloudline Tower, 44th floor");
      if (busy || state.cinematic || !t) return;
      const reach = t.r || REACH;
      if (Math.hypot(playerPos.x - t.x, playerPos.z - t.z) > reach) return;
      if (phase === "count") visit(t);
      else if (phase === "report") finale();
      else if (phase === "address") lobby();
    },
    /** Where the player should go next ({x, z}), or null: the minimap's waypoint blip. */
    get waypoint() { const t = target(); return t ? { x: t.x, z: t.z } : null; },
    get phase() { return phase; },
    get total() { return total; },
    get counted() { return [...counted]; },
    get busy() { return busy; },
  };
}
