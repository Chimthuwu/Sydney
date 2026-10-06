// ---------------------------------------------------------------------------
// input.js — one source of truth for controls.
//
// Gameplay code asks about ACTIONS ("forward", "interact"), never key codes, so
// rebinding a key is a one-line change here and no system invents its own idea
// of what W means. Mouse look belongs to camera.js; the cutscene keys (Enter /
// Esc) to cinema.js.
//
//   input.isDown("forward")            held?
//   input.axis("back", "forward")      −1 / 0 / +1
//   input.onPress("interact", fn)      edge-triggered, ignores key repeat
// ---------------------------------------------------------------------------

export const DEFAULT_BINDINGS = Object.freeze({
  // movement: on foot these are camera-relative, in a vehicle they are throttle / steering
  forward: ["KeyW", "ArrowUp"],
  back: ["KeyS", "ArrowDown"],
  left: ["KeyA"],
  right: ["KeyD"],
  sprint: ["ShiftLeft"],                   // on foot (Right Shift is the camera-turn modifier)
  brake: ["ShiftLeft"],                    // in a vehicle (handbrake)
  // Wheelie / nose-dive. Deliberately NOT ShiftLeft -- that is the handbrake, and a
  // wheelie on the handbrake would fire on every handbrake turn. Space is free in a
  // vehicle (it is only "jump" on foot) and is the conventional GTA binding for it.
  // Holding throttle + Space lifts the front; holding brake + Space stops the nose
  // diving. Released, the car settles back down on its own.
  wheelie: ["Space"],
  //
  // The camera no longer shares the keyboard with gameplay (human request
  // 2026-10-02: "E should be interact, we dont need no camera orbit... make the
  // numpad do that shit"). Arrows orbit, and Numpad4 / Numpad6 orbit too for
  // players who never touch the arrow cluster; Z / X with Right Shift still work
  // as the left-hand pair.
  //
  // This is what unblocks E. E used to be BOTH `interact` AND `orbitRightMod`, so
  // pressing it to get in a car also nudged the camera — which is why E was
  // banned outright and F took over. Moving the orbit to keys that are not also
  // gameplay keys removes the collision that caused that, so E can go back to
  // being interact, which is where it belongs.
  orbitLeft: ["ArrowLeft", "Numpad4"],
  orbitRight: ["ArrowRight", "Numpad6"],
  orbitModifier: ["ShiftRight"],           // Z / X turn the camera only while Right Shift is held
  orbitLeftMod: ["KeyZ"],
  orbitRightMod: ["KeyX"],
  //
  // E is "use": enter / exit a vehicle, work a thing, open a door. It was
  // banned because it collided with `orbitRightMod` (see above); the camera has
  // moved to the numpad, so E is safe and is interact again.
  interact: ["KeyE"],
  // F is the driver's key: get in / out of a car, jack a cruiser, and — when
  // there is no vehicle in range — the torch. Split from `interact` on
  // 2026-10-02 ("F is for Flashlight and for stealing cars"). The torch itself
  // stays unbound below; this action is what F is FOR, so it lives here rather
  // than as a second key.
  driveOrTorch: ["KeyF"],
  // T is "talk": the dialogue prompt, the same key the venue prompts already
  // describe themselves with. It was `trade` (multiplayer), which is a
  // different game mode and must not own the single-player conversation key, so
  // trade moves to Y.
  talk: ["KeyT"],
  // Q closes a dialogue without touching Esc, which is reserved for the pause
  // menu and nothing else. Q is otherwise only `orbitLeftMod` (with Right
  // Shift), and the two cannot collide: dialogue only offers Q while it is open,
  // and the camera modifier needs Shift held.
  closeDialog: ["KeyQ"],
  jump: ["Space"],
  crouch: ["KeyC"],
  descend: ["ControlLeft", "ControlRight", "KeyC"],   // the DeLorean: each press of Space climbs a step, each press of Ctrl (or C: Ctrl+W closes the browser tab) drops one (main.js updateHover)
  mute: ["KeyM"],
  // M mutes the soundtrack; K silences the in-car radio (radio.js) on its own,
  // so you can keep the music and lose the DJ.
  radio: ["KeyK"],
  gfxDown: ["BracketLeft"],
  gfxUp: ["BracketRight"],
  perf: ["F3"],
  debugOrientation: ["F4"],
  reload: ["KeyR"],
  // Put the weapon away / take it out again. With it holstered, left click does
  // nothing at all — you can walk and look around without firing every time you
  // click to grab the pointer.
  holster: ["KeyX"],
  equipBat: ["Digit1"],
  equipPistol: ["Digit2"], equipTec9: ["Digit3"], equipShotgun: ["Digit4"], equipRifle: ["Digit5"],   // weapon slots
  // The torch (first person). It has NO key of its own: the user's rule is that
  // F is the torch whenever F has nothing else to do, so `interact` (F) falls
  // through to it (main.js toggleFlashlight) and this action is deliberately left
  // unbound. It used to be F, then KeyL; both are gone — one key, one meaning.
  flashlight: [],
  pipboy: ["Tab"],                     // the character screen (zombie mode)
  viewToggle: ["KeyV"],                // first person <-> third person
  horn: ["KeyH"],                      // honk / call a prostitute to the passenger door
  trade: ["KeyY"],                     // offer a trade to the nearest player (multiplayer, 2026-09-28). It was T, which is now `talk`.
  medkit: ["KeyJ"],                    // use a banked medkit (+35 HP, carried between pickups)
});

// keys the browser must not act on (scrolling, find bar, …)
const SWALLOW = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space", "F3", "F4", "Tab"]);
// KeyE is gone from this set along with every other binding: it is not a key in
// this game any more, so Ctrl+E should reach the browser rather than fire actions.
// E replaces F in `interact`, so E joins this set and F stays (Ctrl+F is the
// browser's find shortcut, and these are all preventDefault'd so the page does
// not act on them behind the game's back).
const CTRL_CHORDS = new Set(["KeyS", "KeyD", "KeyA", "KeyE", "KeyF", "KeyG", "KeyR", "KeyP", "KeyH", "KeyU"]);

export function createInput({ bindings = DEFAULT_BINDINGS, target = window } = {}) {
  const held = new Set();                  // key codes currently down
  const mouseHeld = new Set();             // 0 = LMB, 2 = RMB
  const byCode = new Map();                // code -> [actions]
  for (const [action, codes] of Object.entries(bindings)) {
    for (const code of codes) {
      if (!byCode.has(code)) byCode.set(code, []);
      byCode.get(code).push(action);
    }
  }
  const handlers = new Map();              // action -> [fn]

  target.addEventListener("keydown", (e) => {
    if (SWALLOW.has(e.code)) e.preventDefault();
    // Ctrl is the DeLorean's "down": Ctrl+S / D / A / F / G held while driving must not save, bookmark, select or search (the browser still owns Ctrl+W: use C)
    if (e.ctrlKey && CTRL_CHORDS.has(e.code)) e.preventDefault();
    held.add(e.code);
    if (e.repeat) return;
    for (const action of byCode.get(e.code) || []) {
      for (const fn of handlers.get(action) || []) fn(e);
    }
  });
  target.addEventListener("keyup", (e) => held.delete(e.code));
  target.addEventListener("mousedown", (e) => {
    // The click that CAPTURES the mouse must not also swing the bat. camera.js
    // requests Pointer Lock on this same left-mousedown, so with the pointer
    // free every click-to-look fired — and with an automatic weapon, holding it
    // to drag the view emptied the magazine.
    //
    // The button is dropped BEFORE `mouseHeld.add`, not just before the handler
    // dispatch: main.js's automatic fire reads `input.isDown("attack")` from
    // `mouseHeld` and calls fire() straight from the tick, so a guard that only
    // skipped the edge-triggered handler let the held-trigger path through
    // untouched and changed nothing.
    //
    // Right click is deliberately not gated — camera.js keeps right-drag as the
    // look fallback while the pointer is free, and aiming has no side effects.
    //
    // `__qaPointerLock` / `__qaAim` are the headless escape hatches: a synthetic
    // mousedown can never hold Pointer Lock. Existing QA scripts set `__qaAim`
    // to get past fire()'s aim check, so either flag counts.
    if (e.button === 0 && !document.pointerLockElement
        && !window.__qaPointerLock && !window.__qaAim) return;
    mouseHeld.add(e.button);
    if (e.button === 2) {
      for (const fn of handlers.get("aim") || []) fn(e);
    } else if (e.button === 0) {
      for (const fn of handlers.get("attack") || []) fn(e);
    }
  });
  target.addEventListener("mouseup", (e) => mouseHeld.delete(e.button));
  let lastWheel = 0;
  target.addEventListener("wheel", (e) => {
    const now = performance.now();
    if (now - lastWheel < 100) return; // 100ms throttle
    lastWheel = now;
    if (e.deltaY > 0) {
      for (const fn of handlers.get("nextWeapon") || []) fn(e);
    } else if (e.deltaY < 0) {
      for (const fn of handlers.get("prevWeapon") || []) fn(e);
    }
  }, { passive: true });
  // alt-tab or a lost pointer lock must not leave W stuck down
  target.addEventListener("blur", () => { held.clear(); mouseHeld.clear(); });

  const isDown = (action) => action === "aim"
    ? mouseHeld.has(2)
    : action === "attack"
      ? mouseHeld.has(0)
      : (bindings[action] || []).some((c) => held.has(c));

  return {
    bindings,
    isDown,
    /** −1 when `negative` is held, +1 for `positive`, 0 for neither or both. */
    axis: (negative, positive) => (isDown(positive) ? 1 : 0) - (isDown(negative) ? 1 : 0),
    onPress(action, fn) {
      if (!handlers.has(action)) handlers.set(action, []);
      handlers.get(action).push(fn);
    },
    clear: () => { held.clear(); mouseHeld.clear(); },
  };
}
