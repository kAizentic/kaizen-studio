#!/usr/bin/env node
/**
 * infer-controls.mjs — the AUTO half of the two-layer control-manifest workflow.
 *
 * Reads a component (.tsx) and emits a CANDIDATE control manifest by
 * inferring, per prop: binds · widget kind · valueType · defaultValue · a unit &
 * exposure GUESS. The human then CURATES min/max/step/note (seeded from your own motion
 * timing defaults) and renames `<Comp>.controls.candidate.ts` → `<Comp>.controls.ts`.
 *
 * Zero-dependency (matches the rest of this toolchain — no `typescript`, no npm). It parses
 * ONE authored idiom: `export default function Name({ a = d, ... }: { a?: T; ... })`.
 * It is not a general TS parser; it is exact for that shape and flags anything it
 * can't read rather than guessing silently.
 *
 * Usage:
 *   node infer-controls.mjs ../components/DossierStatGrid.tsx            # writes .controls.candidate.ts
 *   node infer-controls.mjs ../components/*.tsx --stdout                 # print, don't write
 */
import { readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

/* ── balanced / quote-aware scanning ─────────────────────────────────────────── */
function matchPair(str, openIdx, open, close) {
  let depth = 0, q = null;
  for (let i = openIdx; i < str.length; i++) {
    const c = str[i];
    if (q) { if (c === q && str[i - 1] !== "\\") q = null; continue; }
    if (c === '"' || c === "'" || c === "`") { q = c; continue; }
    if (c === open) depth++;
    else if (c === close && --depth === 0) return i;
  }
  return -1;
}
/** split a top-level list by any char in `delims`, respecting (){}[]<>`'" nesting. */
function splitTop(str, delims) {
  const out = []; let buf = "", depth = 0, q = null;
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (q) { if (c === q && str[i - 1] !== "\\") q = null; buf += c; continue; }
    if (c === '"' || c === "'" || c === "`") { q = c; buf += c; continue; }
    if ("({[<".includes(c)) depth++;
    else if (")}]>".includes(c)) depth--;
    if (depth === 0 && delims.includes(c)) { if (buf.trim()) out.push(buf.trim()); buf = ""; continue; }
    buf += c;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

/** strip /* *​/ and // comments, string-aware (so backticks/quotes inside a comment
 *  can't corrupt scanning — the real bug behind empty-type props). */
function stripComments(s) {
  let out = "", q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i], n = s[i + 1];
    if (q) { out += c; if (c === q && s[i - 1] !== "\\") q = null; continue; }
    if (c === '"' || c === "'" || c === "`") { q = c; out += c; continue; }
    if (c === "/" && n === "*") { const e = s.indexOf("*/", i + 2); i = e === -1 ? s.length : e + 1; continue; }
    if (c === "/" && n === "/") { const e = s.indexOf("\n", i + 2); i = e === -1 ? s.length : e - 1; continue; }
    out += c;
  }
  return out;
}

/* ── extract the signature's destructure + type blocks ───────────────────────── */
function extractProps(rawSrc) {
  const src = stripComments(rawSrc);
  const m = src.match(/export default function\s+(\w+)\s*\(/);
  if (!m) throw new Error("no `export default function` found");
  const name = m[1];
  const parenOpen = m.index + m[0].length - 1;
  const parenClose = matchPair(src, parenOpen, "(", ")");
  const params = src.slice(parenOpen + 1, parenClose);

  const dOpen = params.indexOf("{");
  const dClose = matchPair(params, dOpen, "{", "}");
  const destructure = params.slice(dOpen + 1, dClose);
  const tOpen = params.indexOf("{", dClose + 1);
  const tClose = matchPair(params, tOpen, "{", "}");
  const typeBlock = params.slice(tOpen + 1, tClose);

  const defaults = {};
  for (const piece of splitTop(destructure, ",")) {
    if (piece.startsWith("...")) continue;
    const eq = piece.indexOf("=");
    if (eq === -1) { defaults[piece.trim()] = undefined; continue; }
    defaults[piece.slice(0, eq).trim()] = piece.slice(eq + 1).trim();
  }
  const types = {};
  for (const piece of splitTop(typeBlock, ";,")) {
    const mm = piece.match(/^(\w+)\s*(\?)?\s*:\s*([\s\S]+)$/);
    if (mm) types[mm[1]] = { optional: !!mm[2], type: mm[3].trim() };
  }
  return { name, order: Object.keys({ ...defaults, ...types }), defaults, types };
}

/* ── inference helpers ───────────────────────────────────────────────────────── */
const UNIT_BY_SUFFIX = [[/Px$/, "px"], [/Vh$/, "vh"], [/Vw$/, "vw"], [/Ms$/, "ms"],
  [/Deg$/, "deg"], [/Rem$/, "rem"], [/Duration$/i, "s"], [/Seconds$/i, "s"]];

function parseDefault(raw) {
  if (raw === undefined) return { kind: "none" };
  const s = raw.trim();
  const str = s.match(/^["'`](.*)["'`]$/);
  if (str) return { kind: "string", value: str[1] };
  if (/^-?\d+(\.\d+)?$/.test(s)) return { kind: "number", value: parseFloat(s) };
  if (s === "true" || s === "false") return { kind: "boolean", value: s === "true" };
  return { kind: "expr", value: s };
}
function unitFromString(v) {
  const m = String(v).match(/^(-?\d+(?:\.\d+)?)(px|vw|vh|rem|em|%|deg|s|ms)$/);
  return m ? { num: parseFloat(m[1]), unit: m[2] } : null;
}
function unitFromName(n) { for (const [re, u] of UNIT_BY_SUFFIX) if (re.test(n)) return u; return undefined; }
function enumOptions(type) {
  const toks = splitTop(type, "|").map(t => t.trim());
  if (toks.length < 2) return null;
  const opts = [];
  for (const t of toks) {
    const sm = t.match(/^["'`](.*)["'`]$/);
    if (sm) opts.push({ label: sm[1], value: sm[1] });
    else if (/^-?\d+(\.\d+)?$/.test(t)) opts.push({ label: t, value: parseFloat(t) });
    else return null; // not a pure-literal union
  }
  return opts;
}
function humanize(n) {
  let s = n.replace(/(Px|Vh|Vw|Ms|Deg|Rem|Em)$/, "").replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  s = s.replace(/\s+/g, " ").trim().toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}
const niceStep = d => Math.abs(d) >= 500 ? 50 : Math.abs(d) >= 50 ? 5 : Math.abs(d) >= 10 ? 1 : 0.1;
function guessRange(d, unit) {
  const v = typeof d === "number" ? d : 0;
  switch (unit) {
    case "vw": case "%": return { min: 0, max: 100, step: 1 };
    case "vh": return { min: 0, max: 150, step: 5 };
    case "deg": return { min: 0, max: 360, step: 1 };
    case "s": return { min: Math.max(1, Math.round(v / 4)), max: Math.max(4, Math.round(v * 3)), step: 1 };
    case "ms": return { min: 0, max: Math.max(100, Math.round(v * 3)), step: 10 };
    case "px": return { min: Math.round(v * 0.3), max: Math.max(10, Math.round(v * 2)), step: niceStep(v) };
    default: return { min: 0, max: v > 0 ? Math.round(v * 2) : 10, step: niceStep(v) };
  }
}
const isStructuralName = n => /className$/i.test(n) || /selector|rootSelector|^ref$|^id$/i.test(n);
const isMotionName = n => /distance|parallax|duration|travel|speed|stagger/i.test(n);

function inferEntry(name, def, typeInfo) {
  const type = typeInfo?.type || "";
  const dv = parseDefault(def);

  // structural
  if (isStructuralName(name)) return { kind: "structural", binds: name, note: "structural — JSON only." };
  // content: ReactNode slot
  if (/ReactNode/.test(type)) return { kind: "content", binds: name, routeTo: "slot", note: "composed in JSX; curate to image-layer if it's media." };
  // content: arrays / structured objects
  if (/\[\]\s*$/.test(type) || /^Array</.test(type)) return { kind: "content", binds: name, routeTo: "copy-layer", list: true, note: "editable list." };
  if (/^\{[\s\S]*\}$/.test(type.trim())) return { kind: "content", binds: name, routeTo: "copy-layer", note: "structured object — review." };
  // enum from literal union
  const opts = enumOptions(type);
  if (opts) return { kind: "enum", binds: name, title: humanize(name), defaultValue: dv.value ?? opts[0].value, options: opts, tier: "basic", curate: true };
  // boolean
  if (/^boolean$/.test(type) || dv.kind === "boolean") return { kind: "boolean", binds: name, title: humanize(name), defaultValue: dv.kind === "boolean" ? dv.value : false, tier: "basic", curate: true };
  // color
  if (/colou?r/i.test(name) && /string/.test(type)) return { kind: "color", binds: name, title: humanize(name), defaultValue: dv.kind === "string" ? dv.value : "#000000", tier: "basic", curate: true };
  // unit-string slider (e.g. "46vw")
  if (dv.kind === "string") {
    const us = unitFromString(dv.value);
    if (us) { const r = guessRange(us.num, us.unit); return { kind: "number", binds: name, valueType: "string", title: humanize(name), defaultValue: us.num, ...r, unit: us.unit, tier: "basic", curate: true, ...(isMotionName(name) ? { nudge: r.step / 5 } : {}) }; }
    return { kind: "content", binds: name, routeTo: "copy-layer", note: "editable copy." }; // string default, no unit
  }
  // plain string prop (with or without default) → editable copy
  if (/^string$/.test(type)) return { kind: "content", binds: name, routeTo: "copy-layer", note: "editable copy." };
  // number slider
  if (/^number$/.test(type) || dv.kind === "number") {
    const unit = unitFromName(name);
    const d = dv.kind === "number" ? dv.value : 0;
    const r = guessRange(d, unit);
    const tier = /max|cap|stage/i.test(name) ? "advanced" : "basic";
    return { kind: "number", binds: name, title: humanize(name), defaultValue: d, ...r, ...(unit ? { unit } : {}), tier, curate: true, ...(isMotionName(name) ? { nudge: r.step / 5 } : {}) };
  }
  // fallback — string with no default = editable copy
  return { kind: "content", binds: name, routeTo: "copy-layer", note: `unresolved type \`${type}\` — review.` };
}

/* ── emit ────────────────────────────────────────────────────────────────────── */
function printVal(v) { return typeof v === "string" ? JSON.stringify(v) : String(v); }
function printEntry(e) {
  const keys = Object.keys(e);
  const body = keys.map(k => {
    if (k === "options") return `options: [${e.options.map(o => `{ label: ${printVal(o.label)}, value: ${printVal(o.value)} }`).join(", ")}]`;
    return `${k}: ${printVal(e[k])}`;
  }).join(", ");
  const tail = e.curate ? " // TODO curate: range/note" : "";
  return `    { ${body} },${tail}`;
}
function toManifest(name, entries) {
  return `// AUTO-GENERATED candidate — scripts/infer-controls.mjs. CURATE the "// TODO" lines\n`
    + `// (min/max/step/note, seed ranges from your motion-timing defaults), then rename to ${name}.controls.ts\n`
    + `import type { ControlManifest } from "./controls-schema";\n\n`
    + `const manifest: ControlManifest = {\n  component: ${JSON.stringify(name)},\n  entries: [\n`
    + entries.map(printEntry).join("\n") + `\n  ],\n};\n\nexport default manifest;\n`;
}

/* ── shared parser exports (one source of truth for infer-seam.mjs et al.) ────── */
export { extractProps, splitTop, stripComments, inferEntry, humanize, unitFromString, enumOptions };

/* ── main (only when run directly, not when imported) ────────────────────────── */
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const args = process.argv.slice(2);
  const stdout = args.includes("--stdout");
  const files = args.filter(a => !a.startsWith("--"));
  if (!files.length) { console.error("usage: node infer-controls.mjs <Component.tsx> [...] [--stdout]"); process.exit(1); }

  for (const file of files) {
    try {
      const src = readFileSync(file, "utf8");
      const { name, order, defaults, types } = extractProps(src);
      const entries = order.map(n => inferEntry(n, defaults[n], types[n]));
      const out = toManifest(name, entries);
      if (stdout) { console.log(`\n/* ===== ${basename(file)} ===== */\n${out}`); }
      else { const dest = join(dirname(file), `${name}.controls.candidate.ts`); writeFileSync(dest, out); console.log(`✓ ${name} → ${dest}  (${entries.length} props)`); }
    } catch (e) { console.error(`✗ ${file}: ${e.message}`); }
  }
}
