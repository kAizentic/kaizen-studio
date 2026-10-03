#!/usr/bin/env node
/**
 * infer-seam.mjs — auto-derive a component's SEAM (the interface a caller
 * changes from the outside) + flag seam smells. The AUTO half; the human
 * confirms/trims the one-liner.
 *
 * A seam has two halves:
 *   - TOKEN seam — which `--site-*` theme vars the component reads (its "plug").
 *   - PROP seam  — its knobs (behaviour) + content slots, parsed from the signature.
 *
 * It reuses infer-controls.mjs's parser (one source of truth) and adds a token grep
 * + smell checks, then emits `<Component>.seam.md` (or --stdout). Zero npm deps.
 *
 * Smells surfaced (these double as the component↔contract drift-lint):
 *   - hardcoded hex used as a real value (not a `var(--token, #fallback)` fallback) → un-tokenised leak
 *   - `--site-*` token off the canonical contract (typo / private token)
 *   - prop declared but never referenced in the body → dead knob
 *   - non-content prop with no default → fragile knob
 *
 * Usage:
 *   node infer-seam.mjs ../components/DiagonalBorderSweep.tsx           # writes .seam.md
 *   node infer-seam.mjs ../components/*.tsx --stdout                    # print, don't write
 */
import { readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { extractProps, stripComments, unitFromString, enumOptions } from "./infer-controls.mjs";

const stripQuotes = (s) => (s == null ? s : s.replace(/^["'`]|["'`]$/g, ""));

/** the canonical theming contract (--site-paper / --site-ink / --site-muted / --site-hairline / --site-accent) */
const CANON = ["--site-paper", "--site-ink", "--site-muted", "--site-hairline", "--site-accent"];

/* ── token seam ──────────────────────────────────────────────────────────────── */
function tokenSeam(src) {
  const set = new Set();
  for (const m of src.matchAll(/--site-[\w-]+/g)) set.add(m[0]);
  return [...set].sort();
}

/* ── smells ──────────────────────────────────────────────────────────────────── */
// A canvas/WebGL component draws colours into a shader / 2D context, where a CSS
// `var(--token, #hex)` is meaningless — the correct seam for such a colour is a PROP with a
// hex default (the caller's override surface). So for these components a hex that is a prop
// default is NOT a leak; only a BURIED literal (a shader string, an inline gradient stop) is.
// DOM components keep the strict rule (theme colours belong in `var(--site-*, #hex)`).
const isCanvasComponent = (src) =>
  /getContext\(|WebGL|createShader|<canvas\b|from\s+["']three["']|import\(\s*["']three["']/.test(src);

// hex literals that are NOT the fallback slot of `var(--token, #hex)` → un-tokenised leaks
function hexLeaks(src, propDefaultHexes = null) {
  const leaks = [];
  for (const m of src.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
    const before = src.slice(Math.max(0, m.index - 80), m.index);
    if (/var\(\s*--[\w-]+\s*,\s*$/.test(before)) continue; // CSS token fallback — fine
    // JS token read with fallback — `getPropertyValue("--x")…|| "#hex"` — is the JS analogue of the
    // `var(--x, #hex)` slot: the hex is the fallback, not a leak. (Components that need a token's
    // value in JS/canvas can't use CSS `var()`, so they read it and `||` a default.)
    if (/(getPropertyValue\([\s\S]*|--site-[\w-]+[\s\S]*)\|\|\s*["'`]$/.test(before)) continue;
    if (propDefaultHexes && propDefaultHexes.has(m[0])) continue; // canvas/WebGL: prop default IS the seam
    leaks.push(m[0]);
  }
  return [...new Set(leaks)];
}
const offContract = (tokens) => tokens.filter((t) => !CANON.includes(t));

// prop referenced anywhere in the body (outside the signature)? cheap identifier grep.
function bodyReferences(src, name) {
  const re = new RegExp(`\\b${name}\\b`, "g");
  const total = (src.match(re) || []).length;
  return total > 2; // signature contributes ~2 (destructure + type); >2 means used in body
}

/* ── classify a prop into the seam ───────────────────────────────────────────── */
// knob = a BEHAVIOUR dial (number/boolean/enum/unit-string). content = copy/media/url slots.
// callback = event handler. structural = className/ref/id. Only knobs are the "behaviour seam".
function classify(name, typeInfo, def) {
  const type = (typeInfo?.type || "").trim();
  if (/className$/i.test(name) || /selector|^ref$|^id$/i.test(name)) return "structural";
  if (/=>|\bFunction\b/.test(type)) return "callback";
  if (/ReactNode/.test(type) || /\[\]\s*$/.test(type) || /^Array</.test(type) || /^\{[\s\S]*\}$/.test(type)) return "content";
  if (/^boolean$/.test(type) || /^number$/.test(type)) return "knob";
  if (enumOptions(type)) return "knob"; // literal union
  if (/^string$/.test(type)) return def !== undefined && unitFromString(stripQuotes(def)) ? "knob" : "content"; // unit-string is a dial; bare string is copy
  return "knob";
}

/* ── build the seam report for one component ─────────────────────────────────── */
function seamOf(rawSrc) {
  const src = stripComments(rawSrc);
  const { name, order, defaults, types } = extractProps(rawSrc);
  const tokens = tokenSeam(src);
  const props = order.map((n) => ({
    name: n,
    role: classify(n, types[n], defaults[n]),
    type: (types[n]?.type || "").trim(),
    default: defaults[n],
    optional: !!types[n]?.optional,
    used: bodyReferences(src, n),
  }));

  const knobs = props.filter((p) => p.role === "knob");
  const content = props.filter((p) => p.role === "content");

  // For canvas/WebGL components, a hex prop default is the legitimate seam (a shader can't read
  // a CSS var) — exempt those values from the leak check; buried literals still get flagged.
  const propDefaultHexes = isCanvasComponent(src)
    ? new Set(Object.values(defaults).map((d) => stripQuotes(d)).filter((v) => /^#[0-9a-fA-F]{3,8}$/.test(v || "")))
    : null;

  const smells = [];
  for (const h of hexLeaks(src, propDefaultHexes)) smells.push(`hardcoded hex \`${h}\` used as a value (not a \`var(--token, #hex)\` fallback) — tokenise it`);
  for (const t of offContract(tokens)) smells.push(`token \`${t}\` is off the canonical --site-* contract (typo or private token)`);
  for (const p of props) {
    if (!p.used) smells.push(`prop \`${p.name}\` is never referenced in the body — dead knob, cut it`);
    // an OPTIONAL behaviour knob with no default can let \`undefined\` reach the math (NaN)
    if (p.role === "knob" && p.optional && p.default === undefined) smells.push(`optional knob \`${p.name}\` has no default — undefined could reach the math`);
  }

  const draft =
    `seam = ${tokens.map((t) => "`" + t + "`").join(", ") || "(no tokens — hardcoded?)"} (tokens)` +
    ` + ${knobs.map((k) => "`" + k.name + "`").join(", ") || "(no knobs)"} (props)` +
    (content.length ? `; content slots: ${content.map((c) => "`" + c.name + "`").join(", ")}` : "");

  return { name, tokens, props, knobs, content, smells, draft };
}

/* ── emit markdown ───────────────────────────────────────────────────────────── */
function toMarkdown(s) {
  const canon = s.tokens.filter((t) => CANON.includes(t));
  const propRow = (p) =>
    `| \`${p.name}\` | ${p.role} | ${p.type || "—"} | ${p.default === undefined ? "—" : "`" + p.default + "`"} | ${p.used ? "✓" : "⚠ unused"} |`;
  return (
    `# ${s.name} — seam (AUTO — confirm/trim)\n\n` +
    `> **Draft seam line** (confirm, group, trim):\n> ${s.draft}\n\n` +
    `## Token seam (theme vars it reads)\n` +
    (canon.length ? canon.map((t) => `- \`${t}\``).join("\n") : "- _(none — check it isn't hardcoded)_") +
    `\n\n## Prop seam\n` +
    `| prop | role | type | default | used |\n|---|---|---|---|---|\n` +
    s.props.map(propRow).join("\n") +
    `\n\n## Smells\n` +
    (s.smells.length ? s.smells.map((m) => `- ⚠ ${m}`).join("\n") : "- ✓ none — fully tokenised, every prop used & defaulted") +
    `\n`
  );
}

/* ── main ────────────────────────────────────────────────────────────────────── */
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const args = process.argv.slice(2);
  const stdout = args.includes("--stdout");
  const files = args.filter((a) => !a.startsWith("--"));
  if (!files.length) { console.error("usage: node infer-seam.mjs <Component.tsx> [...] [--stdout]"); process.exit(1); }

  for (const file of files) {
    try {
      const s = seamOf(readFileSync(file, "utf8"));
      const md = toMarkdown(s);
      if (stdout) { console.log(`\n<!-- ===== ${basename(file)} ===== -->\n${md}`); }
      else { const dest = join(dirname(file), `${s.name}.seam.md`); writeFileSync(dest, md); console.log(`✓ ${s.name} → ${basename(dest)}  (${s.tokens.length} tokens, ${s.knobs.length} knobs, ${s.smells.length} smells)`); }
    } catch (e) { console.error(`✗ ${file}: ${e.message}`); }
  }
}

export { seamOf, toMarkdown };
