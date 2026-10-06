// main_js_scope_test.mjs — main.js must not reference an undeclared identifier.
//
// Why this exists: commit ee50579 hoisted `const M = createMarkings(...)` out of
// buildLevel() into a new markUS167(), but left `markings: M` behind inside
// buildLevel(). `node --check` stayed happy — it only parses — and every unit
// test stayed green, because the QA harnesses call the district modules directly
// and never run buildLevel(). So the deployed build threw
//
//     ReferenceError: M is not defined
//         at buildLevel (src/main.js:3526:15)
//
// before the first district finished, and every player got "The game couldn't
// finish loading". Green tests and a broken game are not contradictory when
// nothing exercises the load path. This file does.
//
// No JS parser is available in this repo (no acorn, no eslint), so this is a
// lexical check rather than a true scope analysis: strip comments and string
// literals first, collect every binding the file introduces, then report any bare
// capital-letter identifier that is neither a real global nor bound anywhere.
// The capital-letter restriction is deliberate — it keeps this to zero false
// positives, and `M` is exactly the shape it has to catch.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

let fails = 0;
const ok = (c, m) => { console.log(`${c ? "  ok  " : "  FAIL"} ${m}`); if (!c) fails++; };

const here = dirname(fileURLToPath(import.meta.url));
const raw = readFileSync(join(here, "../../src/main.js"), "utf8");

// ---- strip comments, strings and regex literals in ONE pass -----------------
// Doing this with three sequential .replace() passes does not work, and the
// failure is silent: a `//` line comment whose prose contains a capital gets
// eaten by the regex-literal pass (its body runs on until it finds a `/` on some
// later line), while stripping line comments first eats genuine regex literals
// like /Taco|Grill/. Either order produced ~45 false positives made of words
// from the file's own comments. A single left-to-right scan decides per
// character, which is the only way to get a clean read of the code.
function stripNonCode(src) {
  let out = "";
  let i = 0;
  const n = src.length;
  // A `/` starts a regex only where a value cannot already have ended; after a
  // closing paren or an identifier it is division. Good enough for a sweep.
  let prev = "";
  while (i < n) {
    const c = src[i], two = src.slice(i, i + 2);
    if (two === "//") { const j = src.indexOf("\n", i); i = j < 0 ? n : j; continue; }
    if (two === "/*") { const j = src.indexOf("*/", i + 2); i = j < 0 ? n : j + 2; continue; }
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      i++;
      while (i < n) {
        if (src[i] === "\\") { i += 2; continue; }
        if (src[i] === q) { i++; break; }
        i++;
      }
      out += '""'; prev = '"'; continue;
    }
    // A `/` starts a regex literal only where a value cannot already have ended.
    // `prev` is the last significant character, so after `2` in `-Math.PI / 2` it
    // is a digit and this is division, not a regex -- and treating it as one
    // swallowed `2],    // Chatboro, by the spawn` as regex body, leaking the
    // comment's words into the sweep. Letters, digits, ), ] and quotes all mean
    // division; anything else (an operator, a comma, a bracket, nothing) can open
    // a literal.
    if (c === "/" && !/[\w)\]'\"`]/.test(prev) && src[i + 1] !== "/" && src[i + 1] !== "*" && src[i + 1] !== "=") {
      let j = i + 1, closed = false;
      while (j < n) {
        if (src[j] === "\\") { j += 2; continue; }
        if (src[j] === "\n") break;
        if (src[j] === "/") { closed = true; break; }
        j++;
      }
      if (closed) {
        j++;
        while (j < n && "gimsuyd".includes(src[j])) j++;
        // Keep a marker only when the body could contribute a capital, so the
        // sweep can see that a literal was here without reading its contents.
        out += /[A-Z]/.test(src.slice(i, j)) ? " /RE/ " : " ";
        i = j; prev = "/"; continue;
      }
    }
    out += c;
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return out;
}

const stripped = stripNonCode(raw);
let src = stripped;

// ---- collect every binding the file introduces ------------------------------
const bound = new Set();
const add = (n) => { if (/^[A-Za-z_$][\w$]*$/.test(n)) bound.add(n); };

for (const m of src.matchAll(/import\s+([^;]*?)\s+from\s/g)) {
  for (const brace of m[1].matchAll(/\{([^}]*)\}/g))
    for (const part of brace[1].split(",")) {
      const bits = part.split(/\bas\b/);
      add((bits.pop() || "").trim());        // the local binding: `X` in `A as X`
      if (bits.length) add(bits[0].trim());  // and the name it came from: `A`
    }
  const bare = m[1].replace(/\{[^}]*\}/g, "").replace(/,/g, " ").trim();
  for (const w of bare.split(/\s+/)) if (w) add(w.replace(/^\*\s*as\s*/, ""));
}
// `const A = 1, B = 2` and `let a = f(), b = g()` declare more than one name, and
// the single-name pattern below only ever caught the first.
for (const m of src.matchAll(/(?:const|let|var)\s+([^;\n]+?);/g))
  for (const part of m[1].split(",")) add((part.split(":").pop() || "").split("=")[0].trim());
for (const m of src.matchAll(/(?:const|let|var)\s+([^;\n]+?)\n/g))
  for (const part of m[1].split(",")) add((part.split(":").pop() || "").split("=")[0].trim());
for (const m of src.matchAll(/(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g)) add(m[1]);
for (const m of src.matchAll(/(?:const|let|var)\s*\{([^}]*)\}\s*=/g))
  for (const part of m[1].split(",")) add((part.split(":").pop() || "").split("=")[0].trim());
for (const m of src.matchAll(/\(([^)]*)\)\s*=>/g))
  for (const part of m[1].split(",")) add((part.split(":").pop() || "").split("=")[0].trim());
for (const m of src.matchAll(/function\s*\*?\s*[A-Za-z_$][\w$]*\s*\(([^)]*)\)/g))
  for (const part of m[1].split(",")) add((part.split(":").pop() || "").split("=")[0].trim());
for (const m of src.matchAll(/\bcatch\s*\(\s*([A-Za-z_$][\w$]*)/g)) add(m[1]);
for (const m of src.matchAll(/for\s*\(\s*(?:const|let|var)\s+([^;)]+)/g))
  for (const w of m[1].split(",")) add((w.split(":").pop() || "").split("=")[0].trim());

// ---- real globals the module is allowed to lean on --------------------------
const GLOBALS = new Set([
  "THREE", "GLTFLoader", "FBXLoader", "WebGLRenderer", "PCFSoftShadowMap",
  "ACESFilmicToneMapping", "SRGBColorSpace", "InstancedMesh", "Raycaster",
  "Vector2", "Vector3", "Quaternion", "Euler", "Box3", "Sphere", "Color",
  "AmbientLight", "DirectionalLight", "HemisphereLight", "PointLight",
  "SpotLight", "RectAreaLight", "MeshStandardMaterial", "MeshBasicMaterial",
  "MeshPhysicalMaterial", "MeshLambertMaterial", "MeshPhongMaterial", "Mesh",
  "Group", "Scene", "Fog", "FogExp2", "PlaneGeometry", "BoxGeometry",
  "CylinderGeometry", "SphereGeometry", "TorusGeometry", "CircleGeometry",
  "RingGeometry", "ConeGeometry", "BufferGeometry", "BufferAttribute",
  "Float32BufferAttribute", "ExtrudeGeometry", "Shape", "Path", "Texture",
  "CanvasTexture", "DataTexture", "RepeatWrapping", "ClampToEdgeWrapping",
  "NearestFilter", "LinearFilter", "LinearMipmapLinearFilter", "PMREMGenerator",
  "Line", "LineBasicMaterial", "LineSegments", "Sprite", "SpriteMaterial",
  "Points", "PointsMaterial", "MathUtils", "Curve", "CatmullRomCurve3", "Clock",
  "Loader", "LoadingManager", "Object3D", "GridHelper", "AxesHelper", "Plane",
  "document", "window", "console", "Math", "JSON", "Object", "Array", "Number",
  "String", "Boolean", "Promise", "Map", "Set", "WeakMap", "WeakSet", "Error",
  "TypeError", "RangeError", "SyntaxError", "ReferenceError", "Date", "RegExp",
  "isNaN", "isFinite", "parseInt", "parseFloat", "setTimeout", "clearTimeout",
  "setInterval", "clearInterval", "requestAnimationFrame", "cancelAnimationFrame",
  "fetch", "Headers", "Request", "Response", "AbortController", "performance",
  "localStorage", "sessionStorage", "location", "navigator", "globalThis",
  "undefined", "NaN", "Infinity", "Symbol", "Proxy", "Reflect", "BigInt",
  "Float32Array", "Float64Array", "Uint8Array", "Uint8ClampedArray",
  "Uint16Array", "Uint32Array", "Int8Array", "Int16Array", "Int32Array",
  "ArrayBuffer", "DataView", "TextEncoder", "TextDecoder", "URL",
  "URLSearchParams", "Blob", "File", "FileReader", "Image", "Audio",
  "AudioContext", "Event", "CustomEvent", "EventTarget", "ResizeObserver",
  "IntersectionObserver", "MutationObserver", "matchMedia", "alert", "confirm",
  "prompt", "postMessage", "structuredClone", "crypto", "Intl", "gc",
  "queueMicrotask", "RE",   // RE is this file's marker for a stripped regex literal
]);

// ---- report bare capitals that are neither bound nor global -----------------
const missing = new Map();   // name -> first line number
const lines = src.split("\n");
for (let i = 0; i < lines.length; i++) {
  for (const m of lines[i].matchAll(/(^|[^.\w$])([A-Z][\w$]*)/g)) {
    const name = m[2];
    if (GLOBALS.has(name) || bound.has(name)) continue;
    if (/^\s*:/.test(lines[i].slice(m.index + m[0].length))) continue;   // an object key, not a value
    if (!missing.has(name)) missing.set(name, i + 1);
  }
}

ok(missing.size === 0,
  missing.size === 0
    ? "every capital-letter identifier in main.js is a real global or is bound in the file"
    : `unbound: ${[...missing].map(([n, l]) => `${n} (line ${l})`).join(", ")}`);

// ---- the regression this file exists for, stated explicitly ----------------
// A file-wide "is M bound anywhere" check is not enough, and this test proved
// it: `const M` lives inside markUS167(), so `bound.has("M")` was true and the
// check passed against the exact bug it was written for. The question is never
// "does this name exist" but "does it exist HERE" -- so slice out buildLevel's
// own body and require the name to be bound inside that slice.
// Read the STRIPPED source, not the raw file: the comment explaining this very
// bug contains the text `const M`, and matching against the raw source found it
// there and concluded buildLevel was fine. Comments are not bindings.
const buildStart = stripped.indexOf("async function buildLevel()");
const buildEnd = stripped.indexOf("\nfunction ", buildStart + 10) > 0
  ? stripped.indexOf("\nfunction ", buildStart + 10)
  : stripped.length;
const build = stripped.slice(buildStart, buildEnd);

// every binding visible inside buildLevel's body
const buildBound = new Set();
{
  const addB = (n) => { if (/^[A-Za-z_$][\w$]*$/.test(n)) buildBound.add(n); };
  for (const m of build.matchAll(/(?:const|let|var)\s+([^;\n]+?)(?:;|\n)/g))
    for (const part of m[1].split(",")) addB((part.split(":").pop() || "").split("=")[0].trim());
  for (const m of build.matchAll(/(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g)) addB(m[1]);
  for (const m of build.matchAll(/(?:const|let|var)\s*\{([^}]*)\}\s*=/g))
    for (const part of m[1].split(",")) addB((part.split(":").pop() || "").split("=")[0].trim());
  // Arrow params only -- and NOT a call's argument list. `\(([^)]*)\)\s*=>`
  // alone also matches createOrleaRouge({ scene, ..., markings: M }), and
  // parsing "markings: M" out of that binds M as a destructured parameter, which
  // is exactly the bug this check exists to catch, silently passing. Requiring a
  // destructuring brace to open the list keeps this to real parameter lists.
  for (const m of build.matchAll(/\(\s*\{([^{}]*)\}[^)]*\)\s*=>/g))
    for (const part of m[1].split(",")) addB((part.split(":").pop() || "").split("=")[0].trim());
  for (const m of build.matchAll(/function\s*\*?\s*[A-Za-z_$][\w$]*\s*\(([^)]*)\)/g))
    for (const part of m[1].split(",")) addB((part.split(":").pop() || "").split("=")[0].trim());
  for (const m of build.matchAll(/for\s*\(\s*(?:const|let|var)\s+([^;)]+)/g))
    for (const w of m[1].split(",")) addB((w.split(":").pop() || "").split("=")[0].trim());
}

ok(!/markings:\s*M\s*,/.test(stripped) || buildBound.has("M"),
  "the `markings: M` handed to OrleaRouge is bound inside buildLevel itself, not just somewhere in the file");

console.log(fails ? `\n${fails} FAILURES` : "\nall main.js scope checks passed");
process.exit(fails ? 1 : 0);