// ---------------------------------------------------------------------------
// dialogue.js — talk to anyone who is not trying to kill you.
//
// The Crown Strip's private dance and back rooms were the only two things in
// the game you could walk up to a person and *do*, and both were bolted onto
// one venue. This is the general version: approach anybody, press T, and get
// a numbered list of things you could say (Fallout's dialogue wheel, minus the
// wheel). What the list CONTAINS is per-person and per-role, because a
// bartender, a beat cop, a club dancer and a street walker have nothing in
// common, and a menu that offers all of it to all of them is a menu nobody
// reads.
//
// Design, in the order the code asks about it:
//
//   1. DISCOVERY IS NOT THE MODULE'S JOB. Nothing here knows what a crowd
//      actor is. main.js hands us a flat list of nearby people
//      (`nearbyPeople`), each already reduced to {name, role, x, z, ...}. The
//      crowd lives in four different modules (crowd.js records, streetlife.js
//      records, franchiseClubs performers, npc.js pedestrians) and they have
//      four different shapes; flattening them at the edge is the only way this
//      stays a dialogue system rather than a second place that knows about all
//      four.
//
//   2. THE LIST IS DRAWN, NOT SIMULATED. `optionsFor(person)` is pure: given a
//      person and the player's character it returns the topics, and every
//      topic's `available` flag is a plain boolean computed from stats. Fallout
//      hides what you cannot do and shows the rest greyed with a reason; this
//      does the same, and the reason is the interesting part — "Speech 34" tells
//      the player what to go and train.
//
//   3. THE WORLD STAYS LIVE. The overlay does not pause the simulation; the
//      brief was explicit about that. What it takes is the keyboard (so W does
//      not walk you into a wall while you are choosing) and the camera. The
//      nightclub behind you keeps dancing, because a frozen room behind a
//      dialogue box is the single most lifeless thing a dialogue system can do.
//
//   4. CONSENT IS IN THE MODEL, NOT THE MENU. Every adult option routes
//      through adultContent.js and its launch gate, and performers are cast
//      through the same fail-closed `assertAdult` the stage uses. This module
//      can therefore not start anything the venues could not already start —
//      it is a better way in, not a new door.
// ---------------------------------------------------------------------------

/** The number of skill points below which a "charm" attempt is a coin flip. */
const FLIRT_FLOOR = 30;
const PICK_SNEAK_FLOOR = 25;
const JOB_SPEECH_FLOOR = 20;

/**
 * Roll a social attempt against a skill.
 *
 * Deliberately NOT `Math.random()`: a player who is refused three times in a
 * row should be able to suspect the odds, and the odds are visible. The window
 * is `floor / 100` on the chance of success, plus a flat Charisma nudge, so a
 * Charisma 1 hustler with no Speech at all is still worth talking to — which is
 * the point of a Charisma stat.
 *
 * @returns {{ok:boolean, roll:number, chance:number}} `roll` and `chance` are
 *   both 0..1 so the UI can show the player what they actually threw.
 */
export function socialRoll({ skill = 0, cha = 5, skillCap = 100, bonus = 0, rng = Math.random } = {}) {
  const chance = Math.max(0.02, Math.min(0.97, (skill / skillCap) * 0.7 + (cha - 5) * 0.04 + bonus));
  const roll = rng();
  return { ok: roll < chance, roll, chance };
}

/** One-line reason a topic is locked, or null when it is open. */
function locked(skill, need, name) {
  if (skill >= need) return null;
  return `${name} ${skill} (needs ${need})`;
}

// ---------------------------------------------------------------------------
// The rumour pool. Information is the cheapest thing an NPC can give and the
// thing that makes a city feel inhabited, so it is data rather than code, and
// it is drawn WITHOUT replacement per person — a cop who tells you about the
// Superdome twice in a row reads as a script, not a person.
// ---------------------------------------------------------------------------

export const RUMOURS = Object.freeze([
  { text: "City Park's still open. There's a bandstand out by the lagoon — somebody's always playing it.", where: "City Park", x: 372, z: 268 },
  { text: "The French Market runs from dawn. Go early, before the good produce is gone and the prices aren't silly.", where: "French Market", x: 296, z: 236 },
  { text: "Superdome's got a car park bigger than most of this parish. Don't leave anything in it you can't replace.", where: "The Superdome", x: 470, z: 430 },
  { text: "St. Louis Cathedral's worth the walk up the steps. Especially the balconies at sunset.", where: "St. Louis Cathedral", x: 258, z: 250 },
  { text: "Loyola's up past the park. The cloister's quiet if you want it to be.", where: "Loyola University", x: 590, z: 300 },
  { text: "They dug the whole thing out of a swamp. Half the streets still don't go where you'd expect them to.", where: null },
  { text: "If you're heading north, fill up first. The parishes up there are long and thin and expensive.", where: null },
  { text: "Parish Sheriff's office is on the Causeway if you ever need making a noise about somebody.", where: null },
  { text: "The Mardi Gras Indians mark their own ground, and the year before. Don't walk through a marking you're not invited into.", where: null },
  { text: "Secondline's on every corner somebody's got a brass band and a permit. Best thing on a Sunday.", where: null },
  { text: "Tchoupitoulas is the one everybody photographs and nobody walks. Walk it and you'll see the actual city.", where: null },
  { text: "Nine foot five is the Superdome. That's not a stadium, that's a mountain that somebody put a roof on.", where: "The Superdome", x: 470, z: 430 },
  { text: "Atchafalaya's a real river. People put a fence up and act like it isn't.", where: null },
  { text: "Everybody says the cemeteries here are the best in the country. Half of it's the above-ground vaults.", where: null },
  { text: "Don't ask a stranger what they do for a living down here. Half of them are between jobs and all of them are polite about it.", where: null },
]);

/**
 * Pick `n` rumours for one person, without replacement, and stable per person
 * so the same NPC keeps the same things to say between visits.
 */
export function pickRumours(seed = 1, n = 3) {
  const out = [];
  let s = (seed | 0) || 1;
  const rand = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const pool = RUMOURS.slice();
  for (let i = 0; i < n && pool.length; i++) out.push(pool.splice((rand() * pool.length) | 0, 1)[0]);
  return out;
}

// ---------------------------------------------------------------------------
// Roles.
//
// A role answers three questions: what is this person called, what do they
// carry, and what will they do for you. `stock` is deliberately a small list of
// fiction-flavoured goods with `kind` in {drink, food, med, chem, part, ammo} —
// the same vocabulary the existing services module heals and feeds from, so a
// drink you buy from a barkeep is the same heal as a Popeyes 3-piece and not a
// second, parallel economy.
// ---------------------------------------------------------------------------

const GOODS = {
  beer:     { label: "Abita",        kind: "drink", price: 8,   hp: 6 },
  cocktail: { label: "Hurricane",    kind: "drink", price: 14,  hp: 14 },
  coffee:   { label: "Coffee",       kind: "drink", price: 4,   hp: 4 },
  "po'boy": { label: "Po'boy",       kind: "food",  price: 11,  hp: 38 },
  gumbo:    { label: "Gumbo",        kind: "food",  price: 13,  hp: 44 },
  bandage:  { label: "Bandages",     kind: "med",   price: 18,  hp: 22 },
  medkit:   { label: "Medkit",       kind: "med",   price: 46,  hp: 70 },
  ammo:     { label: "A box of 9mm", kind: "ammo",  price: 30,  rounds: 24 },
  shells:   { label: "Shells",       kind: "ammo",  price: 26,  rounds: 8 },
  weed:     { label: "A joint",      kind: "chem",  price: 20,  hp: 8, chill: 1 },
  speed:    { label: "A white",      kind: "chem",  price: 55,  hp: 0, speed: 1 },
  bayou:    { label: "Bayou water",  kind: "drink", price: 5,   hp: 2 },
};

/** How a person is greeted, by role. Cheap, and it is most of the personality. */
const GREETINGS = {
  barkeep:  ["You're not on my list of problems yet. What do you want?", "Pouring. Talk to me between pours if you want.", "Last call's called. What's it going to be?"],
  dealer:   ["Keep it low. I don't need a customer I have to look for.", "I got what you need and I got what you don't. Choose.", "You look like a man with a question and no plan."],
  croupier: ["Table's open. House rules: don't touch the felt, don't touch me.", "Place your bets. Or don't. I'm not your mother.", "Winning or losing, you're still buying a drink first."],
  clerk:    ["Help you?", "Everything behind this counter is priced. Everything.", "Papers, supplies, or you're just browsing."],
  host:     ["You've got a table, you haven't got a friend. Sit.", "Party of one. I'll find you somewhere better.", "Mind the coat check. And mind yourself."],
  dj:       ["Deck's mine till the next set. Then it's anybody's.", "You want the good stuff, stay till two.", "Boots on, and stay off the low end."],
  performer: ["You watching, or you talking? Both cost.", "Buy the house a drink and I'll remember your face.", "I'm between numbers. Make it quick."],
  gogo:     ["Hi! Hi. You're nice, I like nice.", "Don't touch the pole, everyone touches the pole.", "I'll dance for a drink. That's the deal, sugar."],
  hogdancer:["Oink. Oink. I mean — hi!", "Porkchop says hi. That was me. That was absolutely me.", "I'll hoof it for a shrimp po'boy."],
  hogkeep:  ["Pouring for the house. You're not house.", "Sit at the bar and I'll pour you something honest.", "Even a hog knows you want a drink."],
  star:     ["I do three numbers a night. You're watching one of them.", "Applause is free. Anything else, we negotiate.", "You want the good song? Somebody's got to pay for it."],
  bouncer:  ["ID. And keep it down inside.", "You can go in. You can't go in like that.", "No trouble. That's the whole job."],
  valet:    ["Keys? I'll watch it. Tip's the game.", "Park where I point, not where you want.", "Don't ask me where I'm going."],
  smoker:   ["You don't smoke, you're just hiding.", "Light's out in ten. Make it nine.", "Standing out here saves me the effort of saying no."],
  barty:    ["First round's on the house. It won't be the last.", "You look like you've had a day. Sit down.", "I pour, you talk. Works for both of us."],
  beat:     ["Evening. Everything's fine so far, I'd like to keep it that way.", "Move along if you don't mind. Nothing personal.", "Night's quiet. Long way to stay quiet, though."],
  commuter: ["Excuse me. Sorry. Mind if I— thanks.", "Long one today. You waiting for something too?", "You look like you're waiting. Everyone here's waiting."],
  walker:   ["Hm?", "Evening.", "Watch it, the kerb's uneven."],
  ped:      ["Evening.", "Beautiful day for it.", "You from around here?"],
};

/**
 * Who will take a flirt. Deliberately NOT the beat cops and not the dealers:
 * a uniform is a professional distance, and making it a stat check would turn
 * every deputy on the street into a romance option.
 */
const FLIRT_ROLES = new Set(["performer", "star", "host", "barkeep", "commuter", "ped"]);

/** Fall back by broad category when a role is unknown. */
function roleFamily(role) {
  if (!role) return "ped";
  if (["barkeep", "hogkeep", "bartender"].includes(role)) return "barkeep";
  if (["dealer", "clerk"].includes(role)) return "dealer";
  if (role === "croupier") return "croupier";
  if (role === "host" || role === "valet" || role === "bouncer") return "host";
  if (role === "dj" || role === "star") return "star";
  if (["performer", "gogo", "hogdancer", "dancer"].includes(role)) return "performer";
  // The room, as opposed to the staff in it: a fan, a guest on the queue, the
  // party somebody's birthday is for. Front of house for the purposes of what
  // they will sell you, which is the only thing this branch distinguishes.
  if (["guest", "fan", "queue", "wait", "party"].includes(role)) return "host";
  if (role === "beat" || role === "police" || role === "deputy") return "beat";
  if (role === "commuter") return "commuter";
  return "ped";
}

/**
 * The goods a role sells. Dealers carry the chemistry, everybody in a venue
 * carries a drink, the street carries food. This is the whole "buy what they
 * sell" branch of the system and it is one table.
 */
export function stockFor(role) {
  switch (roleFamily(role)) {
    case "barkeep": return ["beer", "cocktail", "coffee"];
    case "dealer": return ["weed", "speed", "bandage"];
    case "croupier": return ["cocktail", "beer"];
    case "host": return ["cocktail", "po'boy"];
    case "star": return ["cocktail", "coffee"];
    case "performer": return ["beer", "cocktail"];
    case "beat": return ["coffee"];
    case "commuter": return ["coffee", "po'boy"];
    case "ped": return ["gumbo", "po'boy", "bayou"];
    default: return ["coffee"];
  }
}

/** A plausible name when the rig did not give us one (streetLife casts none). */
const FIRST = ["Bo", "Candy", "Dupree", "Etta", "Frankie", "Gus", "Halle", "Ivy", "Junior", "Kiki", "Leroy", "Mabel", "Nadine", "Ollie", "Perry", "Rosie", "Sonny", "Tina", "Walt", "Zora"];
const LAST = ["Batiste", "Boudreaux", "Carousel", "Delacroix", "Fontenot", "Gambino", "Hebert", "Ivory", "Landry", "Morial", "Ours", "Pitre", "Rousseau", "Toups"];
export function inventName(seed = 1) {
  let s = (seed | 0) || 1;
  const rand = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  return `${FIRST[(rand() * FIRST.length) | 0]} ${LAST[(rand() * LAST.length) | 0]}`;
}

/**
 * The topic list for one person.
 *
 * @param {object} p       a flattened person: {name, role, kind, seed, adult, carry,
 *   host, talkable} — see main.js's peopleNearby() for who flattens what.
 * @param {object} ctx     { character, state, cash, adultContent, sneaking }
 *   `character` is the stats.js character or null (free roam), `state` the game
 *   state (cash, hp), `adultContent` the gate, `sneaking` whether the player is
 *   crouched/prone.
 * @returns {Array<{id:string,label:string,hint?:string,locked?:string}>}
 */
export function optionsFor(p, ctx = {}) {
  const c = ctx.character || null;
  const skill = (id) => (c ? c.skill(id) : 0);
  const cha = c ? c.special.cha : 5;
  const fam = roleFamily(p.role);
  const out = [];

  // ---- Greet. Always there, never locked: saying hello is free. -----------
  out.push({ id: "chat", label: `Say hello to ${p.name}` });

  // ---- Information. The cheapest gift, and the reason to talk to a stranger.
  out.push({
    id: "rumours",
    label: "Ask what they've heard",
    hint: "They'll tell you about the city",
  });

  // ---- Trade. A role that has nothing to sell simply does not offer it.
  const stock = stockFor(p.role);
  if (stock.length) {
    out.push({ id: "trade", label: "Buy something", hint: stock.map((g) => GOODS[g].label).join(", ") });
  }

  // ---- Jobs. Speeches are work: this is the "do business with them" branch,
  // gated on Speech so a player who cannot talk their way out of anything is
  // not offered a job that needs talking.
  const speech = skill("speech");
  out.push({
    id: "job",
    label: "Ask if they need anything doing",
    locked: locked(speech, JOB_SPEECH_FLOOR, "Speech"),
  });

  // ---- Flirt. Charisma and Speech, and a per-person disposition so the same
  // line does not work on everybody: the barkeep has heard it, the dancer is
  // paid to be charming, the beat cop is not.
  //
  // Derived from the ROLE rather than asked for on the person, because every
  // caller would otherwise have to remember to set `flirtable` and the branch
  // would quietly be dead in exactly the venues it was written for. An explicit
  // `flirtable: false` still wins, so a performer who is supposed to be cold
  // can be.
  const byRole = FLIRT_ROLES.has(fam);
  if (p.flirtable !== false && (p.flirtable === true || byRole)) {
    out.push({
      id: "flirt",
      label: `Flirt with ${p.name}`,
      hint: "Speech and Charisma",
      locked: speech < FLIRT_FLOOR && cha < 6 ? `Speech ${speech} / CHA ${cha}` : null,
    });
  }

  // ---- The venues' own business, for the people who have some. The cast here
  // is the SAME `host` handle the back rooms and the private dance already use,
  // so choosing this hands off to code that has its own age gate, its own
  // charge, and its own Esc. This module never stages anything itself.
  if (p.host && p.adult) {
    out.push({ id: "adult", label: "Ask if they can make some time for you", hint: "Not here" });
  }

  // ---- Pickpocket. Only while actually crouched, and only on somebody who is
  // not a cop: a deputy who finds a hand in his pocket is a different game from
  // a drunk in a bar, and "witnesses" is what separates the two.
  //
  // `carryable: false` is an outright refusal and wins over a carried list —
  // without that precedence a caller that had stashed a list on the person (or
  // one that rolled a carry table and then decided otherwise) would still be
  // robbable, which is the one thing this line must never get wrong.
  const pockets = p.carryable === false ? [] : (p.carry || []);
  if (pockets.length) {
    out.push({
      id: "pickpocket",
      label: `Pickpocket ${p.name}`,
      hint: pockets.map((c2) => c2.label).join(", "),
      locked: !ctx.sneaking ? "You have to be crouched" : p.witnesses ? "Too many people watching" : null,
    });
  }

  out.push({ id: "leave", label: "Say goodbye" });
  return out;
}

/**
 * What a person is carrying — the pickpocket and barter loot tables. Weighted,
 * and deliberately mundane: a wallet, some change, a phone, a watch, cigarettes,
 * a ring left on by somebody who did not need it.
 */
const CARRY_TABLE = [
  { id: "change",  label: "Loose change",  weight: 30, cash: [3, 18] },
  { id: "wallet",  label: "A wallet",      weight: 22, cash: [25, 140] },
  { id: "phone",   label: "A phone",       weight: 14, cash: [0, 40] },
  { id: "watch",   label: "A gold watch",  weight: 9,  cash: [60, 260] },
  { id: "cigs",    label: "A pack of cigarettes", weight: 18, cash: [4, 12] },
  { id: "ring",    label: "A diamond ring", weight: 5, cash: [180, 700] },
  { id: "medkit",  label: "A medkit",      weight: 8,  cash: [0, 0], medkit: 1 },
  { id: "pistol",  label: "A pistol",      weight: 4,  cash: [0, 0], weapon: "pistol" },
];

/**
 * Roll what somebody is carrying. `role` skews it: dealers carry product,
 * cops carry a sidearm, dancers carry a bag with their stuff in it.
 */
export function carryFor(role, rng = Math.random) {
  const fam = roleFamily(role);
  const table = CARRY_TABLE.slice();
  if (fam === "dealer") { table.push({ id: "stash", label: "A wrapped stash", weight: 22, cash: [70, 220] }, { id: "pill", label: "Bottle of pills", weight: 12, cash: [40, 130] }); }
  if (fam === "beat") { table.push({ id: "radio", label: "A police radio", weight: 10, cash: [0, 0] }, { id: "ammo", label: "A spare magazine", weight: 12, cash: [0, 0], rounds: 16 }); }
  if (fam === "performer") { table.push({ id: "tips", label: "A roll of tips", weight: 26, cash: [15, 90] }, { id: "shoes", label: "A pair of expensive shoes", weight: 7, cash: [40, 150] }); }
  if (fam === "barkeep" || fam === "dealer") { table.push({ id: "till", label: "A hand's worth of the till", weight: 14, cash: [40, 180] }); }

  const total = table.reduce((s, e) => s + e.weight, 0);
  const n = rng() < 0.72 ? (rng() < 0.82 ? 1 : 2) : 0;   // most people have something; some have a lot
  const out = [];
  for (let i = 0; i < n; i++) {
    let r = rng() * total;
    const pick = table.find((e) => (r -= e.weight) <= 0) || table[0];
    if (out.some((o) => o.id === pick.id)) continue;
    const cash = pick.cash ? Math.round(pick.cash[0] + rng() * (pick.cash[1] - pick.cash[0])) : 0;
    out.push({ ...pick, cash, value: cash + (pick.medkit ? 45 : 0) + (pick.weapon ? 160 : 0) + (pick.rounds ? 30 : 0) });
  }
  return out;
}

export { GOODS, GREETINGS, roleFamily };

// ---------------------------------------------------------------------------
// The overlay. See the header above the data tables for the design; this half
// owns the DOM, the keyboard, and the consequences of picking things.
// ---------------------------------------------------------------------------

/**
 * @param {object} ctx
 *   state          the game state (cash, hp, ammo, reserve, weapon)
 *   playerPos      the live player position, for "how far have I walked off"
 *   character      the stats.js character, or null in free roam
 *   adultContent   the gate + scene openers (may be null)
 *   flashObjective (m) => void
 *   nearbyPeople   () => Array<person>   — supplied by main.js, see the header
 *   rng            injectable, so the tests can force outcomes
 *   onOpenHost     (person) => void      — hands a performer to the venue code
 *   pauseSim       (paused) => void      — optional
 *   document/window injectable for tests
 */
export function createDialogue(ctx = {}) {
  const doc = ctx.document || globalThis.document;
  const win = ctx.window || globalThis.window;
  const state = ctx.state || {};
  const rng = ctx.rng || Math.random;
  let person = null;         // who we are talking to
  let el = null;             // the overlay root
  let selected = 0;
  let mode = "list";         // "list" | "trade" | "said"
  let lastSaid = "";
  let tradeSel = 0;
  const memory = new Map();  // person seed -> { rumours, name, carry, disposition }
  let promptEl = null;

  const character = () => ctx.character || null;
  const skill = (id) => { const c = character(); return c ? c.skill(id) : 0; };
  const cha = () => { const c = character(); return c ? c.special.cha : 5; };
  const sneaking = () => !!ctx.sneaking;
  const say = (m) => { if (m) ctx.flashObjective?.(m); };

  // ------------------------------------------------------------------ styles
  const CSS = `
    /* The palette is the town's, not the main menu's. townkit.js builds the world
       out of weathered siding, brick, cream trim and aged brass, so the box is a
       signboard hung in that same street. It used to be hot pink on near-black,
       which belongs to the title screen and read as a different product the
       moment you were actually in the game. */
    #gtbDialogue{position:fixed;left:50%;bottom:5vh;transform:translateX(-50%);z-index:100050;
      width:min(720px,94vw);pointer-events:auto;font:15px/1.45 system-ui,sans-serif;color:#efe7d8;}
    #gtbDialogue .gd-box{background:rgba(26,21,16,.95);border:2px solid #6b5433;border-radius:10px;
      box-shadow:0 14px 50px rgba(0,0,0,.75),inset 0 0 0 1px rgba(242,239,230,.06);
      padding:14px 18px 12px;}
    #gtbDialogue .gd-name{font:900 17px/1.2 system-ui;color:#e3b463;letter-spacing:.04em;margin-bottom:2px;}
    #gtbDialogue .gd-role{font-size:12px;color:#9c907c;text-transform:uppercase;letter-spacing:.12em;margin-bottom:10px;}
    #gtbDialogue .gd-said{background:#1c1712;border-left:3px solid #b8873a;border-radius:0 8px 8px 0;
      padding:10px 12px;margin-bottom:10px;color:#e8e0cf;min-height:2.6em;}
    /* stage directions read cooler and quieter than the voice, so the eye skips them */
    #gtbDialogue .gd-said i{color:#9fb0b4;font-style:italic;}
    #gtbDialogue ol{margin:0;padding:0;list-style:none;}
    #gtbDialogue li{display:flex;gap:10px;align-items:baseline;padding:6px 8px;border-radius:6px;cursor:pointer;}
    #gtbDialogue li .n{color:#9a917d;width:1.4em;text-align:right;font-variant-numeric:tabular-nums;flex:0 0 auto;}
    #gtbDialogue li .t{flex:1 1 auto;}
    #gtbDialogue li .h{color:#8b8271;font-size:12px;flex:0 0 auto;font-style:italic;}
    /* selection is aged brass, not neon — readable on the dark panel without glowing */
    #gtbDialogue li.sel{background:#c99a45;color:#1a1410;font-weight:700;}
    #gtbDialogue li.sel .n,.gd-box li.sel .h{color:#4a3618;}
    #gtbDialogue li.locked{opacity:.5;cursor:not-allowed;}
    #gtbDialogue li.locked .t{color:#8b8271;}
    #gtbDialogue .gd-foot{margin-top:8px;font-size:11px;color:#968c78;border-top:1px solid #3a2f22;padding-top:6px;}
    #gtbDialoguePrompt{position:fixed;left:50%;bottom:92px;transform:translateX(-50%);z-index:25;
      background:rgba(26,21,16,.9);color:#efe7d8;padding:8px 16px;border-radius:8px;border:1px solid #4d3f2a;
      font:600 14px/1.4 system-ui,sans-serif;pointer-events:none;}
  `;
  let cssInjected = false;
  function injectCss() {
    if (cssInjected || !doc?.head) return;
    const style = doc.createElement("style");
    style.id = "gtbDialogueStyle";
    style.textContent = CSS;
    doc.head.appendChild(style);
    cssInjected = true;
  }
  function mk(tag, cls, text) {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  // ---------------------------------------------------------------- memory
  /**
   * Stable per-person data. Street actors are pooled and RECYCLED, so anything
   * remembered about a walker has to hang off its id (or off its position, when
   * it has none) or the second commuter you speak to inherits the first
   * commuter's name and wallet. `seed` is the id when there is one.
   */
  function remember(p, count = true) {
    const key = keyOf(p);
    if (!memory.has(key)) {
      memory.set(key, {
        seed: key,
        name: p.name || inventName(hashKey(key)),
        rumours: pickRumours(hashKey(key), 3),
        carry: p.carry || (p.carryable === false ? [] : carryFor(p.role, rng)),
        disposition: 0,          // moved by flirting, remembered either way
        met: 0,
      });
    }
    const m = memory.get(key);
    if (count) m.met++;
    if (p.name && p.name !== m.name) m.name = p.name;   // a real stage name beats an invented one
    return m;
  }
  /**
   * Who "they" is between two conversations. A stable seed where the caller had
   * one — a crowd record's id, a venue and a home spot — and their rounded
   * standing position where it did not, so a walker you move past twice is two
   * people and a barker you walk past twice is the same one.
   */
  function keyOf(p) {
    return p.seed != null ? p.seed : `${p.role || "ped"}:${Math.round(p.x || 0)}:${Math.round(p.z || 0)}`;
  }
  function hashKey(s) {
    let h = 2166136261;
    for (let i = 0; i < String(s).length; i++) { h ^= String(s).charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  // ---------------------------------------------------------------- the list
  let rows = [];

  /**
   * The person as the menu sees them: the raw actor merged with everything we
   * remember about them. This has to happen HERE rather than in optionsFor,
   * because what a person is carrying (and therefore whether the pickpocket
   * line exists at all) is rolled in `remember`, not carried on the actor —
   * and the actor is a pooled mesh that knows nothing about its own wallet.
   */
  function resolved(p) {
    if (!p) return p;
    const m = remember(p);
    return { ...p, name: m.name, carry: m.carry, disposition: m.disposition, seed: m.seed };
  }

  function currentOptions() {
    if (!person) return [];
    return optionsFor(resolved(person), { character: character(), state, adultContent: ctx.adultContent, sneaking: sneaking() });
  }

  function render() {
    if (!el || !person) return;
    const p = resolved(person);
    const box = el.firstChild;
    // the header
    box.replaceChildren();
    box.append(mk("div", "gd-name", p.name));
    const fam = roleFamily(p.role);
    box.append(mk("div", "gd-role", p.role ? p.role : fam));

    if (mode === "said" || lastSaid) {
      const said = mk("div", "gd-said");
      said.append(documentFragment(lastSaid));
      box.append(said);
    }

    if (mode === "trade") {
      box.append(mk("div", "gd-role", `you have $${state.cash || 0}`));
      const list = mk("ol");
      const goods = stockFor(p.role);
      goods.forEach((id, i) => {
        const g = GOODS[id];
        const price = priceOf(g.price);
        const poor = price > (state.cash || 0);
        const li = mk("li", i === tradeSel ? "sel" : (poor ? "locked" : ""));
        li.append(mk("span", "n", String(i + 1)), mk("span", "t", `${g.label} — $${price}${g.hp ? ` · +${g.hp} HP` : ""}${g.rounds ? ` · ${g.rounds} rounds` : ""}`));
        if (poor) li.append(mk("span", "h", "can't afford"));
        li.addEventListener("click", () => { tradeSel = i; chooseTrade(goods[i]); });
        list.append(li);
      });
      const back = mk("li", tradeSel >= goods.length ? "sel" : "");
      back.append(mk("span", "n", "0"), mk("span", "t", "Never mind"));
      back.addEventListener("click", close);
      list.append(back);
      box.append(list);
      box.append(mk("div", "gd-foot", "Enter or click to buy · Q to back out"));
      return;
    }

    rows = currentOptions();
    const list = mk("ol");
    rows.forEach((o, i) => {
      const li = mk("li", `${i === selected ? "sel" : ""}${o.locked ? " locked" : ""}`);
      li.append(mk("span", "n", String(i + 1)), mk("span", "t", o.label));
      if (o.locked) li.append(mk("span", "h", o.locked));
      else if (o.hint) li.append(mk("span", "h", o.hint));
      if (!o.locked) li.addEventListener("click", () => { selected = i; pick(o.id); });
      list.append(li);
    });
    box.append(list);
    box.append(mk("div", "gd-foot", "↑↓ choose · T to talk · Q to leave"));
  }

  // the "said" line is authored with *actions* and <i>names</i> in it, and the
  // performer/role are the only two things that vary, so it is built rather
  // than concatenated
  function documentFragment(html) {
    const frag = doc.createDocumentFragment();
    const parts = String(html).split(/(<i>.*?<\/i>)/g);
    for (const part of parts) {
      if (!part) continue;
      const m = part.match(/^<i>(.*)<\/i>$/);
      if (m) { const em = mk("i", null, m[1]); frag.append(em); }
      else frag.append(doc.createTextNode(part));
    }
    return frag;
  }

  // ---------------------------------------------------------------- effects
  /** Barter and Speech move every price, the same way they move the counters. */
  function priceOf(n) {
    const c = character();
    const mul = c ? c.mods.priceMul() : 1;
    return Math.max(1, Math.round(n * mul));
  }

  function addCash(n) { state.cash = Math.max(0, (state.cash || 0) + n); }
  function heal(n) {
    if (n > 0 && typeof state.hp === "number") state.hp = Math.min(state.maxHp || 100, state.hp + n);
  }
  function addRounds(n) {
    if (n > 0 && state.reserve && typeof state.reserve[state.weapon || "pistol"] === "number") {
      state.reserve[state.weapon || "pistol"] += n;
    }
  }

  function chooseTrade(goodId) {
    const g = GOODS[goodId];
    if (!g || !person) return;
    const p = resolved(person);
    const price = priceOf(g.price);
    if (price > (state.cash || 0)) { say(`${p.name} shakes their head. "Come back with ${price - (state.cash || 0)} more."`); lastSaid = ""; render(); return; }
    addCash(-price);
    heal(g.hp || 0);
    addRounds(g.rounds || 0);
    if (g.chill) say(`${p.name} hands over a ${g.label}. The evening gets a little softer.`);
    else say(`Bought a ${g.label} for $${price}.`);
    lastSaid = `You hand over $${price}. <i>${p.name}</i> hands you a ${g.label} without ceremony.`;
    mode = "said";
    render();
  }

  // ---------------------------------------------------------------- topics
  function pick(id) {
    if (!person) return;
    const p = resolved(person);          // name/carry come from memory
    const m = remember(person);
    switch (id) {
      case "leave": close(); return;

      case "chat": {
        const lines = GREETINGS[roleFamily(p.role)] || GREETINGS.ped;
        // A person you have already flirted with greets you differently. That
        // is the whole payoff of `disposition`: a two-line memory is what
        // separates a person from a hat with legs.
        if (m.disposition >= 2) lastSaid = `<i>${p.name}</i> smiles before you say anything. "There you are. Back again."`;
        else lastSaid = `<i>${p.name}</i>: "${lines[(hashKey(m.seed) + m.met) % lines.length]}"`;
        break;
      }

      case "rumours": {
        const r = m.rumours[(m.met - 1) % m.rumours.length];
        const more = m.rumours.length > 1 ? ` <i>${p.name}</i> adds: "${m.rumours[(m.met) % m.rumours.length].text}"` : "";
        lastSaid = `<i>${p.name}</i>: "${r.text}"${more}`;
        if (r.where && typeof ctx.markWaypoint === "function") {
          ctx.markWaypoint(r.where, r.x, r.z);
          say(`${person.name} told you about ${r.where} — marked on your map.`);
        }
        break;
      }

      case "trade":
        mode = "trade"; tradeSel = 0; lastSaid = ""; render(); return;

      case "job": {
        const sp = skill("speech");
        const r = socialRoll({ skill: sp, cha: cha(), rng });
        if (r.ok) {
          const xp = 12;
          character()?.addXp?.(xp);
          lastSaid = `<i>${p.name}</i> thinks about it, then shrugs. "Alright — if you do this for me, I'll do something for you after." XP +${xp}.`;
          say(`${p.name} has a job for you. Check back with them.`);
          m.jobOffered = true;
        } else {
          lastSaid = `<i>${p.name}</i> looks past you. "Not right now." (Speech check: ${Math.round(r.chance * 100)}%)`;
        }
        break;
      }

      case "flirt": doFlirt(m); break;

      case "adult": doAdult(); return;      // hands off to the venue's own code

      case "pickpocket": doPickpocket(m); break;

      default: lastSaid = ""; break;
    }
    mode = "said";
    render();
  }

  function doFlirt(m) {
    const p = resolved(person);
    const sp = skill("speech");
    // Disposition shifts the odds: somebody you have already got to like you is
    // a much easier second time, which is the point of doing it twice.
    const bonus = m.disposition * 0.12;
    const r = socialRoll({ skill: sp, cha: cha(), bonus, rng });
    if (r.ok) {
      m.disposition++;
      const lvl = [null, "They laugh and look you over properly.", "They're interested now, and don't hide it.", "They'd go somewhere with you right now if you asked."][m.disposition] || "They warm to you.";
      lastSaid = `<i>${p.name}</i> laughs. ${lvl} (Charisma check: ${Math.round(r.chance * 100)}%)`;
      if (m.disposition >= 3) lastSaid += " Try the other thing — asking for time together.";
      say(`${p.name} is interested. (Charisma ${Math.round(r.chance * 100)}%)`);
    } else {
      m.disposition = Math.max(0, m.disposition - 1);
      lastSaid = `<i>${p.name}</i> gives you a look and goes back to what they were doing. (Charisma check: ${Math.round(r.chance * 100)}%)`;
    }
  }

  /**
   * The adult branch does NOT stage anything. It closes this overlay and hands
   * the person to the venue code, which has its own age gate, its own charge
   * and its own Esc. This module can only ever start a scene the clubs could
   * already start, by the same doors.
   */
  function doAdult() {
    const p = resolved(person);
    const host = p?.host;
    if (!host || !p.adult) { lastSaid = `<i>${p.name}</i> is not taking that on tonight.`; mode = "said"; render(); return; }
    if (!ctx.adultContent?.enabled?.()) {
      lastSaid = `<i>${p.name}</i>: "Not unless you answer the question at the front of the game, sugar."`;
      mode = "said"; render(); return;
    }
    const who = p.name;
    close();
    ctx.onOpenHost?.(p, who);
  }

  /**
   * Pickpocketing. The sneak skill is the roll; `witnesses` is what makes a
   * crowd dangerous, and being caught is not an instant loss — it is a shout,
   * a shove, and the street knowing what you are.
   */
  function doPickpocket(m) {
    const p = resolved(person);
    if (!sneaking()) { lastSaid = "You'd need to be crouched for that."; mode = "said"; render(); return; }
    if (p.witnesses) { lastSaid = "Too many people watching. Not here, not now."; mode = "said"; render(); return; }
    if (!m.carry.length) { lastSaid = `<i>${p.name}</i> hasn't got anything worth taking.`; mode = "said"; render(); return; }
    const r = socialRoll({ skill: skill("sneak"), cha: cha(), skillCap: 100, bonus: -0.05, rng });
    if (r.ok) {
      const took = m.carry.splice(0, 1)[0];
      addCash(took.cash || 0);
      if (took.medkit) { state.medkits = (state.medkits || 0) + took.medkit; }
      if (took.rounds) addRounds(took.rounds);
      if (took.weapon && ctx.giveWeapon) ctx.giveWeapon(took.weapon);
      const xp = 14;
      character()?.addXp?.(xp);
      const val = took.value ? ` (worth about $${took.value})` : "";
      lastSaid = `You take ${took.label}${val}. Nobody saw. XP +${xp}.`;
      say(`Pickpocketed ${took.label}.`);
      if (!m.carry.length) lastSaid += " That's all they've got.";
    } else {
      const noticed = p.notices || socialRoll({ skill: skill("sneak"), cha: cha(), rng }).ok;
      lastSaid = noticed
        ? `<i>${p.name}</i> looks down, then up, and knows exactly what happened. "Hey — HEY." (Sneak check: ${Math.round(r.chance * 100)}%)`
        : `Your hand is too slow. <i>${p.name}</i> shifts, and the pocket is gone. (Sneak check: ${Math.round(r.chance * 100)}%)`;
      if (noticed) ctx.onCaught?.(p);
      say(noticed ? "You were caught with your hand in their pocket." : "The pickpocket failed.");
    }
    mode = "said";
    render();
  }

  // ---------------------------------------------------------------- open/close
  function open(p) {
    if (!p || !doc?.body) return false;
    if (p.talkable === false) return false;            // the venue owns F here
    person = p;
    selected = 0; tradeSel = 0; mode = "list"; lastSaid = "";
    injectCss();
    if (!el) {
      el = mk("div", null);
      el.id = "gtbDialogue";
      const box = mk("div", "gd-box");
      el.appendChild(box);
      doc.body.appendChild(el);
      if (win) win.addEventListener("keydown", onKey, true);
    }
    if (!promptEl) { promptEl = mk("div"); promptEl.id = "gtbDialoguePrompt"; promptEl.hidden = true; doc.body.appendChild(promptEl); }
    el.hidden = false;
    render();
    ctx.pauseSim?.(true);
    // The cast mostly has no name of its own (a street walker, a patron, half the
    // Crown Strip) and inventing one is this module's job — reading `p.name`
    // here greeted you with "You talk to null." every time you spoke to somebody
    // the rig had not named. `count: false` because `met` picks the greeting
    // line in pick(), and counting twice would shift everybody's line by one.
    say(`You talk to ${remember(p, false).name}.`);
    return true;
  }

  function close() {
    if (!el) return;
    el.hidden = true;
    person = null; lastSaid = ""; mode = "list";
    ctx.pauseSim?.(false);
    say("You walk on.");
  }

  function onKey(e) {
    if (el?.hidden !== false) return;              // not open
    if (!e.key) return;
    const nav = e.key === "ArrowUp" || e.key === "ArrowDown";
    // Movement is swallowed so you cannot walk off while choosing — but the
    // arrows are the MENU's own, so they are never swallowed, in either mode.
    if (!nav && ["w", "a", "s", "d", " "].includes(e.key)) {
      e.preventDefault(); e.stopImmediatePropagation(); return;
    }
    // Q closes a dialogue. It was Esc as well, and Esc now belongs to the pause
    // menu and nothing else: Esc inside a conversation fought the pause menu for
    // the same keypress, and the game's rule is that Esc opens the pause menu.
    // Q was already accepted here, so this removes the duplicate rather than
    // adding anything.
    if (e.key === "q" || e.key === "Q") {
      e.preventDefault(); e.stopImmediatePropagation();
      // Q backs OUT one step, not out of the whole conversation: trade returns
      // to the list, and a line you have just read returns to the list with it
      // still on screen. Only Q from the list itself leaves — a conversation you
      // cannot back out of without finding the right row is a menu, and a menu
      // is not a conversation.
      if (mode === "trade" || mode === "said") { mode = "list"; lastSaid = ""; render(); }
      else close();
      return;
    }
    if (nav) { e.preventDefault(); e.stopImmediatePropagation(); move(e.key === "ArrowUp" ? -1 : 1); return; }
    // Number keys launch the option they name. The list has always been drawn
    // numbered ("1 Say hello", "2 Ask what they've heard", "3 Buy something") and
    // pressing the number did nothing, which is worse than having no numbers at
    // all: the screen promises an affordance it does not honour.
    //
    // Read the digit from e.code, not e.key: e.key is "1".."9" for the top row AND
    // for the numpad on a standard layout, but some layouts and IMEs deliver only
    // e.code, and ArrowUp/Numpad style codes would otherwise be indistinguishable.
    // Both are accepted so a player with a numpad is not forced onto the top row.
    const digit = /^Digit([1-9])$/.exec(e.code || "") || /^Numpad([1-9])$/.exec(e.code || "")
      ? Number((/^Digit([1-9])$/.exec(e.code || "") || /^Numpad([1-9])$/.exec(e.code || ""))[1])
      : (/^[1-9]$/.test(e.key || "") ? Number(e.key) : 0);
    if (digit) {
      e.preventDefault(); e.stopImmediatePropagation();
      // A digit is an ABSOLUTE address, not a cursor step, so it must not wrap the
      // way move() does: pressing 9 in a 3-option list does nothing at all rather
      // than silently launching option 2.
      const n = digit - 1;
      if (mode === "trade") {
        const goods = stockFor(person.role);
        if (n < goods.length) chooseTrade(goods[n]);
        // n === goods.length is "back out" on the trade list (that is the extra
        // row move() counts); by number, an out-of-range digit just does nothing,
        // because there is no number printed for it.
      } else if (mode === "list") {
        const opt = rows[n];
        if (!opt) return;
        if (opt.locked) say(opt.locked);          // exactly what the T branch does
        else if (!opt.locked) pick(opt.id);
      } else { mode = "list"; lastSaid = ""; render(); }   // a spoken line returns to the list
      return;
    }
    // T confirms, because T is the game's talk key and this list is a
    // conversation. It was Enter or E. E is interact again (input.js:43), so it
    // must not double as dialogue confirm — the footer says T, and only T.
    if (e.key === "Enter" || e.key === "t" || e.key === "T") {
      e.preventDefault(); e.stopImmediatePropagation();
      if (mode === "trade") {
        const goods = stockFor(person.role);
        if (tradeSel < goods.length) chooseTrade(goods[tradeSel]); else close();
      } else if (mode === "list") {
        const opt = rows[selected];
        if (opt && !opt.locked) pick(opt.id);
        else if (opt?.locked) say(opt.locked);
      } else { mode = "list"; lastSaid = ""; render(); }
    }
  }

  function move(d) {
    if (mode === "trade") { const n = stockFor(person.role).length + 1; tradeSel = (tradeSel + d + n) % n; render(); return; }
    if (!rows.length) return;
    selected = (selected + d + rows.length) % rows.length;
    render();
  }

  // ---------------------------------------------------------------- the prompt
  /**
   * Called from update(): if the player is near somebody talkable and the
   * overlay is closed, show the E prompt. Nearest wins, and there is a short
   * "recently talked to" grace so the prompt does not strobe between two
   * people standing next to each other.
   */
  let lastPromptFor = null;
  function update() {
    if (el && el.hidden === false) { if (promptEl) promptEl.hidden = true; return null; }
    const people = ctx.nearbyPeople?.() || [];
    let best = null, bestD = Infinity;
    for (const p of people) {
      if (p.host && !p.adult) continue;               // never offer a minor, whatever the list would have said
      // The caller owns the key at some spots and not others: standing on a
      // club's 0.9 m tip ring, the venue's own prompt and charge is the one the
      // player is standing on, and this system must not swallow the key press
      // that triggers it. Everywhere else in the venue, the same person is an
      // ordinary conversation. The flag is per-person *and* per-moment — it is
      // how the two handlers stop fighting over one key.
      if (p.talkable === false) continue;
      const px = ctx.playerPos?.x ?? 0, pz = ctx.playerPos?.z ?? 0;
      const d = Math.hypot((p.x ?? 0) - px, (p.z ?? 0) - pz);
      if (d < 2.6 && d < bestD) { best = p; bestD = d; }
    }
    lastPromptFor = best;
    if (promptEl) {
      promptEl.hidden = !best;
      promptEl.textContent = best ? `T · Talk to ${best.name || roleFamily(best.role)}` : "";
    }
    return best;
  }

  /** main.js's interact chain calls this. Returns true if it consumed E. */
  function interact() {
    if (el && el.hidden === false) return true;         // already talking; swallow the key
    const p = lastPromptFor || update();
    return p ? open(p) : false;
  }

  return {
    update, interact, open, close, optionsFor, remember, socialRoll,
    get active() { return !!(el && el.hidden === false); },
    get person() { return person; },
    get memory() { return memory; },
    /** The overlay this instance owns. Exposed so a test (or a second system)
     *  can address THIS conversation's list rather than "the first one with the
     *  right id" — every instance mounts an element with the same id. */
    get element() { return el; },
  };
}

export default createDialogue;
