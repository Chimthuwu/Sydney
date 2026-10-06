import assert from "node:assert/strict";
import { createAdultContent, makeBeatPattern, gradeRhythm } from "../../src/adultContent.js";

let focused = null;
function fakeElement(tag) {
  const listeners = {};
  return {
    tagName: tag.toUpperCase(), style: {}, children: [], dataset: {}, hidden: false, disabled: false, checked: false,
    append(...els) { this.children.push(...els); }, appendChild(el) { this.children.push(el); },
    replaceChildren(...els) { this.children.length = 0; this.children.push(...els); },   // (the real DOM API, which re-rendering code relies on)
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    dispatch(type, event = {}) { for (const fn of listeners[type] || []) fn({ type, target: this, preventDefault() {}, stopImmediatePropagation() {}, ...event }); },
    setAttribute() {}, remove() { this.removed = true; },
    focus() { focused = this; },
    click() {
      if (this.tagName === "INPUT" && this.type === "checkbox") { this.checked = !this.checked; this.dispatch("change"); }
      this.dispatch("click");
    },
  };
}
const body = fakeElement("body");
const doc = { body, createElement: fakeElement };
const winListeners = {};
const win = {
  addEventListener(type, fn) { (winListeners[type] ||= []).push(fn); },
  removeEventListener(type, fn) { winListeners[type] = (winListeners[type] || []).filter((x) => x !== fn); },
  dispatch(type, event = {}) { for (const fn of [...(winListeners[type] || [])]) fn({ type, preventDefault() {}, stopImmediatePropagation() {}, ...event }); },
};
const data = new Map();
const storage = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)) };
const find = (el, predicate) => { if (predicate(el)) return el; for (const c of el.children || []) { const hit = find(c, predicate); if (hit) return hit; } return null; };
const findBtn = (el, label) => find(el, (e) => e.tagName === "BUTTON" && String(e.textContent || "").includes(label));
// closed overlays are removed but stay in the fake body's children list, so
// scenes that open more than once must be looked up from the END
const findLast = (el, predicate) => { for (const c of [...(el.children || [])].reverse()) { const hit = findLast(c, predicate); if (hit) return hit; } return predicate(el) ? el : null; };

let adult = createAdultContent({ document: doc, window: win, storage });
const firstBody = body;
assert.equal(adult.acknowledged(), false, "18+ acknowledgement must start false on every launch");
let prevented = false;
win.dispatch("keydown", { key: "w", preventDefault() { prevented = true; }, stopImmediatePropagation() {} });
assert.equal(prevented, true, "launch gameplay keys are blocked until age confirmation");
// The 18+ gate is the ONLY gate (human request, 2026-10-01: the pause-menu
// checkbox was removed outright). There is no second switch, nothing is stored
// about it, and `enabled()` is exactly the age answer — nothing before it.
assert.equal(adult.enabled(), false, "still unavailable before age acknowledgement");
assert.equal(adult.setOptIn, undefined, "the opt-in setter is gone, not just defaulted on");
assert.equal(adult.createOptInControl, undefined, "...and so is the control that used to live in the pause menu");
const gate = find(body, (e) => e.id === "gtbAdultGate");
assert.ok(gate, "launch gate mounts over the launch view");
assert.match(gate.children[0].children[0].textContent, /YOU MUST BE OVER 18/);
assert.match(gate.children[0].children[1].textContent, /gore, drugs, violence, horror, and explicit sexual content/);
assert.match(gate.children[0].children[1].textContent, /NOT suitable for anyone under 18/);
assert.match(gate.children[0].children[1].textContent, /Nobody under 18 should play this game/);
assert.match(gate.children[0].children[2].textContent, /R18\+ game.*gore.*violence.*drug use.*sex.*horror/);
assert.doesNotMatch(gate.children[0].children[2].textContent, /Explicit sexual activity is not shown/);
assert.equal(adult.openRhythmGame(), false, "can't open the private activity before acknowledgement");

const card = gate.children[0];
const continueBtn = card.children.find((e) => e.textContent === "I AM OVER 18 YEARS OF AGE");
const leaveBtn = card.children.find((e) => e.textContent === "I AM UNDER 18 · LEAVE");
assert.ok(continueBtn && leaveBtn, "the gate offers exactly the two answers");
assert.equal(adult.acknowledged(), false, "nothing unlocks without pressing the button");
assert.equal(adult.enabled(), false, "nothing but pressing the age button opens the scenes");
win.dispatch("keydown", { key: "Tab", target: continueBtn });
assert.equal(focused, leaveBtn, "Tab moves focus to the leave option");
win.dispatch("keydown", { key: "Tab", shiftKey: true, target: leaveBtn });
assert.equal(focused, continueBtn, "Shift+Tab returns focus to the adult confirmation");
win.dispatch("keydown", { key: "Enter", target: continueBtn });
assert.equal(adult.acknowledged(), true);
assert.equal(adult.enabled(), true);
assert.equal(gate.removed, true, "the gate goes away once answered");

let paused = false, result = null;
adult.setPauseHandler((v) => { paused = v; });
assert.equal(adult.openRhythmGame({ venue: "HAPPY HOGS", onFinish: (r) => { result = r; } }), true);
const game = find(body, (e) => e.id === "gtbDanceRhythm");
const start = find(game, (e) => e.textContent === "START PRIVATE DANCE");
start.click();
assert.equal(paused, true, "starting the activity requests simulation pause");
for (let i = 0; i < 8; i++) {
  const prompt = game.children[0].children[2].textContent;
  const key = { "↑": "ArrowUp", "↓": "ArrowDown", "←": "ArrowLeft", "→": "ArrowRight" }[prompt];
  assert.ok(key, "each beat has a valid arrow prompt");
  win.dispatch("keydown", { key });
}
assert.equal(game.children[0].children[2].textContent, "8 / 8", "correct arrows advance the rhythm game");
const done = find(game, (e) => e.textContent === "DONE");
done.click();
assert.equal(paused, false, "closing the activity releases its pause owner");
assert.equal(result.score, 8);
assert.equal(result.total, 8);
assert.equal(result.rating, "Bayou legend");

// The static age gate must not swallow keys typed into the higher-layer access form.
const staticBody = fakeElement("body");
const staticGate = fakeElement("div"); staticGate.id = "gtbAdultGate";
const staticYes = fakeElement("button"); staticYes.id = "gtbAgeYes";
const staticNo = fakeElement("button"); staticNo.id = "gtbAgeNo";
const accessGate = fakeElement("div"); accessGate.id = "gtbAccessGate";
const accessInput = fakeElement("input");
accessGate.contains = (target) => target === accessInput;
const staticNodes = { gtbAdultGate: staticGate, gtbAgeYes: staticYes, gtbAgeNo: staticNo, gtbAccessGate: accessGate };
const staticDoc = { body: staticBody, createElement: fakeElement, getElementById: (id) => staticNodes[id] || null };
const staticWinListeners = {};
const staticWin = {
  addEventListener(type, fn) { (staticWinListeners[type] ||= []).push(fn); },
  removeEventListener(type, fn) { staticWinListeners[type] = (staticWinListeners[type] || []).filter((x) => x !== fn); },
  dispatch(type, event = {}) { for (const fn of [...(staticWinListeners[type] || [])]) fn({ type, preventDefault() {}, stopImmediatePropagation() {}, ...event }); },
};
const staticAdult = createAdultContent({ document: staticDoc, window: staticWin, storage });
let accessKeyPrevented = false;
staticWin.dispatch("keydown", { key: "x", target: accessInput, preventDefault() { accessKeyPrevented = true; } });
assert.equal(accessKeyPrevented, false, "the age gate lets password typing pass through the access overlay");
assert.equal(staticAdult.acknowledged(), false, "typing the password never confirms age");

// Nothing about this persists: every fresh page load asks the age question
// again, and there is no second stored preference to lean on any more.
const secondBody = fakeElement("body");
const adult2 = createAdultContent({ document: { body: secondBody, createElement: fakeElement }, window: win, storage });
assert.equal(adult2.acknowledged(), false, "every fresh page load asks age again");
assert.equal(adult2.enabled(), false, "a fresh load starts closed");
const under18Choice = find(secondBody, (e) => e.textContent === "I AM UNDER 18 · LEAVE");
under18Choice.click();
assert.equal(adult2.acknowledged(), false, "the under-18 option never acknowledges the age gate");
assert.match(find(secondBody, (e) => e.textContent?.includes("Please close this page"))?.textContent || "", /only for adults aged 18 and over/);
// Hot-coffee-style scene (2026-09-28): opt-in, non-explicit, fade-to-black.
let coffeeResult = null;
// adult2 is opted in (persisted preference) but has NOT acknowledged the age
// gate on its fresh page load: the activity must refuse to open for it.
assert.equal(adult2.openCoffeeScene(), false, "an unacknowledged age gate blocks the coffee scene even when opted in");
assert.equal(adult.openCoffeeScene({ venue: "HAPPY HOGS", result: { rating: "Right on the beat" }, onFinish: (r) => { coffeeResult = r; } }), true);
const coffee = find(body, (e) => e.id === "gtbCoffeeScene");
assert.ok(coffee, "the coffee scene mounts its own overlay");
assert.match(coffee.children[0].children[1].textContent, /nothing explicit is shown/i, "the scene states its own non-explicit framing");
assert.match(coffee.children[0].children[2].textContent, /Not bad, handsome/, "an ordinary good dance gets the middle invitation");
assert.match(coffee.children[0].children[2].textContent, /Stay for coffee/, "the invitation names the coffee");
const stayBtn = find(coffee, (e) => e.textContent === "STAY FOR COFFEE");
const outBtn = find(coffee, (e) => e.textContent === "HEAD OUT");
assert.ok(stayBtn && outBtn, "the invitation offers stay/leave and nothing else");
stayBtn.click();
const brew = find(coffee, (e) => e.textContent === "☕");
assert.ok(brew, "staying fades to the coffee closer — no explicit content exists in the scene");
const closeBtn = find(coffee, (e) => e.textContent === "CLOSE");
closeBtn.click();
assert.equal(coffeeResult.coffee, true, "staying reports coffee to the club");
assert.equal(coffeeResult.tier, "coffee", "the tier rides along");
assert.equal(adult.gameActive, false, "closing releases the scene");
assert.equal(adult.openCoffeeScene({ onFinish: (r) => { coffeeResult = r; } }), true, "it can open again for another dance");
const coffee2 = findLast(body, (e) => e.id === "gtbCoffeeScene");
find(coffee2, (e) => e.textContent === "HEAD OUT").click();
assert.equal(coffeeResult, null, "heading out reports nothing");

// The invitation scales with the dance (expanded 2026-09-29): aces get
// breakfast, ordinary passes get coffee, flops get teased.
const tiers = [[0.9, /breakfast/], [0.7, /Not bad, handsome/], [0.3, /stepped on my feet/]];
for (const [ratio, expected] of tiers) {
  assert.equal(adult.openCoffeeScene({ result: { score: Math.round(8 * ratio), total: 8, rating: "x" }, onFinish: () => {} }), true, `opening the ${ratio} tier`);
  const c = findLast(body, (e) => e.id === "gtbCoffeeScene");
  assert.match(c.children[0].children[2].textContent, expected, `a ${ratio} dance earns its tier line`);
  find(c, (e) => e.textContent === "HEAD OUT").click();
}

// The NIGHT: the interactive back-room minigame (2026-09-29). Same gating as
// every activity here; the fun is pickable moves, a heat meter, undressing
// both sides, dirty-tiered banter, and a FINALE THE PLAYER CHOOSES.
let nightResult = null, nightCharged = 0;
assert.equal(adult2.openNightScene(), false, "an unacknowledged age gate blocks the night minigame");
assert.equal(adult.openNightScene({ venue: "HAPPY HOGS", price: 250, performerName: "Porkchop", perks: { pay: () => { nightCharged = 250; return true; }, grant: () => ({ healed: 50 }) }, onFinish: (r) => { nightResult = r; } }), true);
const night = find(body, (e) => e.id === "gtbNightScene");
assert.ok(night, "the night scene mounts its own overlay");
const payBtn = findBtn(night, "TAKE HER BACK");
const walkBtn = findBtn(night, "WALK AWAY");
assert.ok(payBtn && walkBtn, "the door offers pay/leave, both adults, consensual framing");
payBtn.click();
assert.equal(nightCharged, 250, "the club's pay() charged at confirm, inside the room's flow");
// In the room: moves build heat; locked moves refuse; undress moves shed layers.
const moveBtn = (label) => findBtn(night, label);
const skirtBtn = moveBtn("Peel her skirt down");
assert.match(skirtBtn.textContent, /🔒/, "high-heat moves start locked");
for (let i = 0; i < 12; i++) moveBtn("Kiss her neck").click();      // build heat the polite way
assert.ok(!moveBtn("Peel her skirt down").textContent.includes("🔒"), "enough heat unlocks the filthier moves");
moveBtn("Slip her top off").click();
moveBtn("Slip her top off").click();                                // second press reports the layer already gone
assert.ok(moveBtn("Slip her top off").textContent.includes("(done)"), "undress moves show their layers spent");
assert.ok(!moveBtn("Carry her to the bed").textContent.includes("🔥"), "the finale row only appears when she's ready");
for (let i = 0; i < 30; i++) moveBtn("Whisper what you want").click();  // drive the meter up
const finaleBtn = findBtn(night, "Let her ride");
assert.ok(finaleBtn, "at 80+ heat the player picks how the night ends");
finaleBtn.click();
// assert.ok(findLast(night, (e) => String(e.textContent || "").includes("🅲")), "the finale cuts to the running censor gag — the dolls stay abstract");
const doneBtn = findBtn(night, "SLEEP · END THE NIGHT");
assert.ok(doneBtn, "the afterglow offers the way out (and one more round)");
doneBtn.click();
assert.equal(nightResult.night, true, "the night reports back to the club");
assert.equal(nightResult.finale, "her", "the chosen finale is remembered");
assert.deepEqual(nightResult.perk, { healed: 50 }, "the perk granted with the club's numbers");
assert.equal(adult.gameActive, false, "closing releases the night");
assert.equal(adult.openNightScene({ venue: "STOOGELETS", price: 250, onFinish: () => {} }), true, "another club, another night");
find(findLast(body, (e) => e.id === "gtbNightScene"), (e) => e.textContent === "WALK AWAY").click();

assert.equal(gradeRhythm(0, 0), "No score");
assert.equal(gradeRhythm(6, 8), "Right on the beat");
assert.deepEqual(makeBeatPattern(() => 0, 4), Array(4).fill("ArrowUp"));

console.log("Adult-content gate, rhythm, coffee and night tests passed");
