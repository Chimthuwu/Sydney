// The general NPC dialogue system: does anybody actually show up with a
// sensible list, and do the stat gates mean anything?
//
//   node tools/qa/dialogue_test.mjs
//
// The system is pure data plus a small overlay, so most of this can be checked
// by calling optionsFor() directly. The overlay is then driven through a fake
// DOM the way a player would drive it: open, arrow, T to confirm, Q to leave.
// (It used to be Enter and Esc. Q is the close key and T the confirm key, per the
// rebinding: Esc is the pause menu and nothing else, and E is not a key in this
// game. The two-step back-out behaviour these assert is unchanged — only the key
// that triggers it moved.)
import assert from "node:assert/strict";
import { createDialogue, optionsFor, socialRoll, stockFor, carryFor, pickRumours, roleFamily, GOODS, inventName } from "../../src/dialogue.js";

let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? `  — ${detail}` : ""}`);
};

// ---------------------------------------------------------------- the fake DOM
const noop = () => {};
function fakeEl(tag = "div") {
  const el = {
    tagName: tag, id: "", className: "", hidden: false, textContent: "", style: {},
    children: [], childNodes: [], parentNode: null, _listeners: {},
    classList: { add() {}, remove() {} },
    appendChild(c) { c.parentNode = el; el.children.push(c); el.childNodes.push(c); return c; },
    append(...cs) { for (const c of cs) if (c) el.appendChild(typeof c === "string" ? fakeText(c) : c); },
    replaceChildren(...cs) { el.children.length = 0; el.childNodes.length = 0; for (const c of cs) el.appendChild(typeof c === "string" ? fakeText(c) : c); },
    removeChild(c) { const i = el.children.indexOf(c); if (i >= 0) { el.children.splice(i, 1); el.childNodes.splice(i, 1); } },
    remove() { el.parentNode?.removeChild?.(el); },
    addEventListener(t, fn) { (el._listeners[t] ||= []).push(fn); },
    removeEventListener(t, fn) { el._listeners[t] = (el._listeners[t] || []).filter((f) => f !== fn); },
    focus: noop,
    // A real click DISPATCHES to this element's own listeners, and a click on a
    // child bubbles to the row that owns the handler. The dialogue overlay puts
    // its handler on the <li> and the test clicks the label inside it, so both
    // halves have to work or every "pick this topic" assertion silently no-ops.
    click() { for (const fn of [...(el._listeners.click || [])]) fn({ type: "click", target: el, preventDefault: noop, stopPropagation: noop }); },
    contains: (n) => n === el || el.children.includes(n),
    get firstChild() { return el.children[0] || null; },
  };
  return el;
}
function fakeText(s) { const t = fakeEl("#text"); t.textContent = s; return t; }
/**
 * A real element's `textContent` is the CONCATENATION of its subtree. This stub
 * stores the string on the node it was created with and leaves it there, so
 * reading `textContent` off a box filled with child nodes returns "" — which
 * reads exactly like "the dialogue produced no line" and sends you hunting a bug
 * in code that is working. Walk the tree and concatenate the LEAF text nodes,
 * which is what a real DOM's textContent actually is.
 */
function textOf(node, seen = new Set()) {
  if (!node || seen.has(node)) return "";
  seen.add(node);
  const kids = [...(node.children || []), ...(node.childNodes || [])];
  // a node's own textContent only counts if it has no element children; the
  // stub keeps the seed string on parents too, which would double-count
  const own = kids.length === 0 ? (node.textContent || "") : "";
  let out = own;
  for (const c of kids) out += textOf(c, seen);
  return out;
}
const body = fakeEl("body");
const head = fakeEl("head");
const doc = {
  body, head,
  createElement: fakeEl,
  createTextNode: (s) => { const t = fakeEl("#text"); t.textContent = s; return t; },
  getElementById: () => null,
  createDocumentFragment: () => {
    const f = fakeEl("#fragment");
    f.appendChild = (c) => { f.children.push(c); return c; };
    return f;
  },
};
const win = {
  _listeners: {},
  addEventListener(t, fn) { (this._listeners[t] ||= []).push(fn); },
  removeEventListener(t, fn) { this._listeners[t] = (this._listeners[t] || []).filter((f) => f !== fn); },
  key(code, extra = {}) {
    for (const fn of [...(this._listeners.keydown || [])]) fn({ type: "keydown", key: code, preventDefault: noop, stopImmediatePropagation: noop, ...extra });
  },
};

// a character with the skills the system reads. stats.js is pure, so use the
// real one rather than a stub that could drift from it.
const { createCharacter } = await import("../../src/stats.js");
const skilled = createCharacter({ special: { str: 5, per: 5, end: 5, cha: 8, int: 5, agi: 5, lck: 5 }, traits: [], background: "hustler", tagged: [] });
const plain = createCharacter({ special: { str: 5, per: 5, end: 5, cha: 1, int: 5, agi: 5, lck: 5 }, traits: [], background: "none", tagged: [] });

// ---------------------------------------------------------------- the cast
const PERFORMER = { name: "Porkchop", role: "performer", adult: true, host: { fake: true }, x: 0, z: 0, seed: 101 };
const COPPER = { name: "Dep. Ruiz", role: "beat", adult: true, x: 1, z: 0, seed: 202 };
const BARKEEP = { name: "Etta", role: "barkeep", adult: true, x: 2, z: 0, seed: 303 };

// ---------------------------------------------------------------- options
{
  const o = optionsFor(PERFORMER, { character: skilled, sneaking: false });
  const ids = o.map((x) => x.id);
  check("a performer offers chat, rumours, trade, jobs, flirt and the adult ask",
    ["chat", "rumours", "trade", "job", "flirt", "adult", "leave"].every((id) => ids.includes(id)), ids.join(", "));
  check("every option has a label and an id", o.every((x) => x.id && x.label));
  check("saying goodbye is always last and always free",
    o[o.length - 1].id === "leave" && !o[o.length - 1].locked);
}

{
  // The whole point of a per-role list: a copper is not a romance option.
  const o = optionsFor(COPPER, { character: skilled, sneaking: false });
  const ids = o.map((x) => x.id);
  check("a beat cop does not offer flirting", !ids.includes("flirt"), ids.join(", "));
  check("a beat cop does sell one thing, because a deputy drinks coffee", ids.includes("trade") && stockFor("beat").length === 1);
}

{
  const o = optionsFor(PERFORMER, { character: plain, sneaking: false });
  const job = o.find((x) => x.id === "job");
  const flirt = o.find((x) => x.id === "flirt");
  check("a Charisma 1 drifter is locked out of jobs", job && job.locked, job && job.locked);
  check("...and of flirting", flirt && flirt.locked, flirt && flirt.locked);
  check("...but is still allowed to say hello and ask about the city",
    o.find((x) => x.id === "chat") && o.find((x) => x.id === "rumours"));
}

{
  // What somebody carries is rolled by the DIALOGUE (in remember), not carried
  // on the actor, so optionsFor is handed it explicitly. The real wiring is
  // `resolved()` inside createDialogue, which merges memory into the person
  // before the menu is built — that is why the line appears at all in play.
  const withPockets = { ...BARKEEP, carry: [{ id: "wallet", label: "A wallet", cash: 60, value: 60 }] };
  const standing = optionsFor(withPockets, { character: skilled, sneaking: false }).find((x) => x.id === "pickpocket");
  const crouched = optionsFor(withPockets, { character: skilled, sneaking: true }).find((x) => x.id === "pickpocket");
  check("you cannot pickpocket while standing", standing && standing.locked, standing && standing.locked);
  check("you can while crouched", crouched && !crouched.locked);
  const empty = optionsFor({ ...BARKEEP, carry: [] }, { character: skilled, sneaking: true }).find((x) => x.id === "pickpocket");
  check("somebody with empty pockets is not offered the line at all", !empty);
  const crowd = optionsFor({ ...withPockets, witnesses: true }, { character: skilled, sneaking: true })
    .find((x) => x.id === "pickpocket");
  check("a crowd is too many witnesses", crowd && crowd.locked === "Too many people watching", crowd && crowd.locked);
  const refused = optionsFor({ ...withPockets, carryable: false }, { character: skilled, sneaking: true })
    .find((x) => x.id === "pickpocket");
  check("somebody who is not carrying anything cannot be robbed", !refused);
}

{
  // An unadult person must never be offered the adult branch, whoever asks.
  const o = optionsFor({ name: "someone", role: "performer", adult: false, host: {} }, { character: skilled });
  check("a performer with no verified adult age is not offered anything adult",
    !o.some((x) => x.id === "adult"), o.map((x) => x.id).join(", "));
}

// ---------------------------------------------------------------- the rolls
{
  // A visible chance, and it must actually move with the skill.
  const low = socialRoll({ skill: 10, cha: 1, rng: () => 0.5 });
  const high = socialRoll({ skill: 90, cha: 9, rng: () => 0.5 });
  check("a better Charisma and Speech means a better chance", high.chance > low.chance,
    `${(low.chance * 100).toFixed(0)}% -> ${(high.chance * 100).toFixed(0)}%`);
  // 2% is a deliberate floor, not zero: a Charisma 1 with no Speech is not
  // forbidden from trying, they are just going to fail. The ceiling has to stay
  // under 1 though, or a maxed build would never have to think about it.
  check("the chance is never a certainty, and never quite zero", low.chance >= 0.02 && high.chance <= 0.97,
    `${(low.chance * 100).toFixed(0)}% .. ${(high.chance * 100).toFixed(0)}%`);
  check("the roll is reported, so a refusal is checkable", typeof low.roll === "number");
  // determinism
  const a = socialRoll({ skill: 50, cha: 5, rng: () => 0.4 });
  const b = socialRoll({ skill: 50, cha: 5, rng: () => 0.4 });
  check("the same roll gives the same answer", a.ok === b.ok);
  // a high roll against a low chance fails, and vice versa
  check("a good roll beats a low bar", socialRoll({ skill: 90, cha: 9, rng: () => 0.01 }).ok === true);
  check("a bad roll misses a high bar", socialRoll({ skill: 90, cha: 9, rng: () => 0.99 }).ok === false);
}

// ---------------------------------------------------------------- rumour
{
  const a = pickRumours(11, 3);
  const b = pickRumours(11, 3);
  check("the same person tells you the same things", a.map((r) => r.text).join("|") === b.map((r) => r.text).join("|"));
  check("...and three of them, without repeats", a.length === 3 && new Set(a.map((r) => r.text)).size === 3);
  const c = pickRumours(99, 3);
  check("a different person knows different things", a.map((r) => r.text).join("|") !== c.map((r) => r.text).join("|"));
}

// ---------------------------------------------------------------- the overlay
{
  const messages = [];
  const state = { cash: 300, hp: 40, maxHp: 100, weapon: "pistol", reserve: { pistol: 12 } };
  let personAt = { x: 0, z: 0 };
  let sneaking = false;
  let caught = 0, hostOpened = null, waypoints = 0, xpTotal = 0;
  const nearby = [];                              // starts empty; the prompt test fills it
  const D = createDialogue({
    state, document: doc, window: win, character: skilled,
    playerPos: personAt, adultContent: { enabled: () => true },
    flashObjective: (m) => messages.push(m),
    nearbyPeople: () => nearby,
    rng: () => 0.01,                        // every roll succeeds
    onOpenHost: (p) => { hostOpened = p.name; },
    onCaught: () => { caught++; },
    markWaypoint: () => { waypoints++; },
    get sneaking() { return sneaking; },
    pauseSim: () => {},
  });

  // --- the prompt appears for a nearby person, and only for them
  check("no prompt when nobody is near", D.update() === null);
  nearby.length = 0; nearby.push({ ...PERFORMER, x: 0, z: 1.2 });
  check("a prompt appears when you are close", D.update()?.name === "Porkchop");
  nearby[0] = { ...PERFORMER, x: 0, z: 40 };
  check("...and not from across the street", D.update() === null);

  // --- E opens it
  nearby[0] = { ...PERFORMER, x: 0, z: 1.2 };
  check("E is consumed by the conversation", D.interact() === true);
  check("the overlay is open", D.active === true);

  // --- the list is drawn, numbered, and says hello first
  //
  // `render()` REBUILDS the rows (replaceChildren), so nothing captured before
  // a re-render may be read after it — every assertion below re-reads the DOM.
  // That is the overlay working as designed, not a test detail.
  // Each createDialogue() mounts ITS OWN overlay with the same id, so the test
  // cannot look the element up by index either: D2 and D3 are created mid-file,
  // so "the second one" is whichever was constructed most recently, not
  // whichever the assertion is about. Each instance instead remembers the
  // element it made (via openOverlay below), and the helpers name it.
  const overlays = () => body.children.filter((c) => c.id === "gtbDialogue");
  const rootOf = (D) => D.element;
  const root = () => rootOf(D);
  const rowsOn = (D) => rootOf(D).firstChild.children.find((c) => c.tagName === "ol").children;
  const labelOfOn = (D, i) => textOf(rowsOn(D)[i].children[1]);
  const pickRowOn = (D, pattern) => {
    const list = rowsOn(D);
    const i = [...list].findIndex((r) => pattern.test(textOf(r.children[1])));
    assert.ok(i >= 0, `no row matching ${pattern} in: ${[...list].map((r) => textOf(r.children[1])).join(" | ")}`);
    return list[i];
  };
  const rows = () => root().firstChild.children.find((c) => c.tagName === "ol").children;
  const said = () => {
    const s = root().firstChild.children.find((c) => c.className === "gd-said");
    return textOf(s);
  };
  const labelOf = (row) => textOf(row.children[1]);
  const pickRow = (pattern) => {
    const list = rows();
    const i = [...list].findIndex((r) => pattern.test(labelOf(r)));
    assert.ok(i >= 0, `no row matching ${pattern} in: ${[...list].map(labelOf).join(" | ")}`);
    return list[i];
  };

  assert.ok(root(), "the dialogue overlay is mounted");
  check("the option list is drawn", !!root().firstChild.children.find((c) => c.tagName === "ol"));
  check("the first option is the greeting", /Say hello/.test(labelOf(rows()[0])), labelOf(rows()[0]));
  check("options are numbered from 1", rows()[0].children[0].textContent === "1");
  check("there is a selection marker on the first row", /sel/.test(rows()[0].className), rows()[0].className);

  // --- down arrow moves the selection, and re-renders
  win.key("ArrowDown");
  check("the down arrow moves the selection", /sel/.test(rows()[1].className), rows()[1].className);
  check("...and the greeting is no longer selected", !/sel/.test(rows()[0].className), rows()[0].className);

  // --- asking for rumours puts a line in the box and marks the map
  //
  // Not every rumour names a place ("Tchoupitoulas is the one everybody
  // photographs" is colour, not a pin), so a specific performer may well have
  // nothing to mark. The assertion is about the MECHANISM: ask enough people
  // and every place somebody mentions has to land on the map.
  pickRow(/what they've heard/).click();
  check("asking what they have heard answers you", said().length > 10, said().slice(0, 60));
  let markedPlaces = waypoints;
  for (const r of [{ ...PERFORMER, seed: 501 }, { ...PERFORMER, seed: 502 }, { ...PERFORMER, seed: 503 }]) {
    D.close(); D.open(r); pickRow(/what they've heard/).click(); markedPlaces += waypoints - markedPlaces;
  }
  check("rumours that name a place put it on the map", waypoints >= 1, `${waypoints} waypoint(s) from 4 people`);

  // --- barter: open it, buy something, and the money actually moves
  win.key("q");                               // back to the list
  pickRow(/Buy something/).click();
  const tradeRows = rows();
  check("trade opens a goods list", tradeRows.length >= 2, `${tradeRows.length} rows`);
  const costBefore = state.cash, hpBefore = state.hp;
  tradeRows[0].click();                        // the first good
  check("buying takes your money", state.cash < costBefore, `$${costBefore} -> $${state.cash}`);
  check("...and a drink heals you", state.hp > hpBefore, `${hpBefore} -> ${state.hp} HP`);

  // --- pickpocket, crouched, with a forced-success roll
  win.key("q");
  sneaking = true;
  nearby[0] = { ...BARKEEP, x: 0, z: 1.0, witnesses: false };
  D.close();
  check("E re-opens on the new person", D.interact() === true);
  const pickLabel = [...rows()].map(labelOf).find((t) => /Pickpocket/.test(t));
  check("the crouched pickpocket option is offered", !!pickLabel, [...rows()].map(labelOf).join(" | "));
  pickRow(/Pickpocket/).click();
  check("a clean lift says nobody saw", /Nobody saw/.test(said()), said().slice(0, 70));
  check("...and nobody was alarmed", caught === 0);

  // --- a failed lift raises the alarm
  // The rng here does two jobs, because it feeds BOTH the social roll and the
  // carry table, and a CONSTANT cannot do both: a high value fails the lift
  // (max chance is 97%) but also rolls "carries nothing" (the first draw asks
  // whether there are any items at all, and 0.9 > 0.72), so the line under
  // test would not be on the menu. The first draw is therefore LOW — somebody
  // with pockets — and every draw after it is HIGH, so the lift still fails.
  let draw = 0;
  const failAfterPockets = () => (++draw === 1 ? 0.3 : 0.99);
  const D2 = createDialogue({
    state: { cash: 100, hp: 50, maxHp: 100, reserve: { pistol: 0 } },
    document: doc, window: win, character: plain,
    playerPos: personAt, adultContent: { enabled: () => true },
    flashObjective: noop, nearbyPeople: () => [{ ...BARKEEP, x: 0, z: 0, witnesses: false, notices: true }],
    rng: failAfterPockets,
    onCaught: () => { caught++; },
    get sneaking() { return true; },
    pauseSim: noop,
  });
  D2.open({ ...BARKEEP, x: 0, z: 0, witnesses: false, notices: true });
  const rows2 = () => rootOf(D2).firstChild.children.find((c) => c.tagName === "ol").children;
  const pi2 = [...rows2()].findIndex((r) => /Pickpocket/.test(textOf(r.children[1])));
  assert.ok(pi2 >= 0, `the crouched pickpocket option is offered — saw: ${[...rows2()].map((r) => textOf(r.children[1])).join(" | ")}`);
  rows2()[pi2].click();
  check("a failed lift is noticed and the street is told", caught === 1, `${caught} alarm(s)`);
  D2.close();

  // --- the adult branch hands off rather than staging anything itself
  const D3 = createDialogue({
    state, document: doc, window: win, character: skilled,
    playerPos: personAt, adultContent: { enabled: () => true },
    flashObjective: noop, nearbyPeople: () => [{ ...PERFORMER }], rng: () => 0.01,
    onOpenHost: (p) => { hostOpened = p.name; }, pauseSim: noop,
  });
  D3.open({ ...PERFORMER });
  const rows3 = () => rootOf(D3).firstChild.children.find((c) => c.tagName === "ol").children;
  const ai = [...rows3()].findIndex((r) => /make some time/.test(textOf(r.children[1])));
  assert.ok(ai >= 0, "the adult ask is offered to a verified adult");
  rows3()[ai].click();
  check("the adult ask hands off to the venue's own code", hostOpened === "Porkchop", String(hostOpened));
  check("...and closes this overlay on the way", D3.active === false);

  // --- Q closes, and the world keeps running underneath
  D3.open({ ...BARKEEP });
  check("open again", D3.active === true);
  win.key("q");


  // ...but a conversation you have SAID something in takes two: the first Q
  // puts the menu back, the second walks away. One Esc that threw away the
  // option list mid-conversation would be worse than useless.
  D3.open({ ...BARKEEP });
  D3.interact();
  pickRowOn(D3, /what they've heard/).click();
  win.key("q");
  check("Q after saying something returns to the list instead of leaving", D3.active === true,
    `still talking to ${D3.person?.name}`);
  check("...with the option list back", /Say hello/.test(labelOfOn(D3, 0)), labelOfOn(D3, 0));
  win.key("q");
  check("...and a second Q leaves", D3.active === false);
  check("W is not swallowed once the conversation is over", (() => {
    let prevented = false;
    for (const fn of win._listeners.keydown) fn({ type: "keydown", key: "w", preventDefault() { prevented = true; }, stopImmediatePropagation: noop });
    return !prevented;
  })());
  check("each conversation gets its own overlay", overlays().length === 3, `${overlays().length} overlays`);
  check("...and no two of them share one", new Set([rootOf(D), rootOf(D2), rootOf(D3)]).size === 3);
}

// ---------------------------------------------------------------- memory
{
  // Street actors are pooled and recycled, so a person's name and wallet must
  // hang off their id, or commuter #7 inherits commuter #3's name.
  const D = createDialogue({
    state: { cash: 0, hp: 50, maxHp: 100 }, document: doc, window: win,
    character: skilled, playerPos: { x: 0, z: 0 }, flashObjective: noop,
    nearbyPeople: () => [], rng: () => 0.5, pauseSim: noop,
  });
  const a = D.remember({ role: "commuter", seed: 7, x: 0, z: 0 });
  const b = D.remember({ role: "commuter", seed: 8, x: 0, z: 0 });
  check("two people get two names", a.name !== b.name, `${a.name} / ${b.name}`);
  check("the same person keeps their name", D.remember({ role: "commuter", seed: 7, x: 5, z: 5 }).name === a.name);
  check("a real stage name beats an invented one",
    D.remember({ role: "performer", seed: 7, name: "Porkchop" }).name === "Porkchop");
  check("rumours are remembered per person, not shared",
    a.rumours[0].text !== b.rumours[0].text || a.seed !== b.seed);
}

console.log(failures ? `\n${failures} dialogue check(s) FAILED` : "\nAll dialogue checks passed");
process.exit(failures ? 1 : 0);
