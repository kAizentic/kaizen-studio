/**
 * controls-schema — the descriptor shape an editor UI reads to render
 * ATTRIBUTE FIELDS + SLIDERS for a component. Generalised v1 (2026-07-11).
 *
 * The field SHAPE mirrors Framer Property Controls (`type/title/defaultValue/min/max/
 * step/unit`) for interop; the extra keys solve the parts no library gives you.
 *
 * ── Key generalisation: WIDGET KIND ≠ PROP VALUE TYPE ───────────────────────────
 * A slider (`kind:"number"`) can drive a prop whose actual value is a NUMBER (1500)
 * or a unit-STRING ("46vw"). `valueType` records the underlying prop type so the
 * editor serialises correctly on write-back:
 *    valueType "number" + unit "px"  → write `1500`      (unit is display-only)
 *    valueType "string" + unit "vw"  → write `"46vw"`    (`${value}${unit}`)
 * See `serialize()` below — the single source of that rule.
 *
 * ── Two-layer authoring ─────────────────────────────────────────────────────────
 *   1. AUTO (infer-controls.mjs): binds, kind, valueType, defaultValue, and a
 *      unit/exposure GUESS — inferred from the component's TS prop types + defaults.
 *   2. CURATE (human): min/max/step/nudge/tier + note. Ranges seeded from
 *      your motion-timing defaults + CSS-unit/token semantics (dimension). `curate:true` marks a field still carrying an auto guess.
 *
 * EXPOSURE RULE: expose perceptual-and-safe (feel; can't break layout/logic); keep
 * structural-and-logical in JSON; content props route to the copy/image editable layer.
 */

export type CssUnit = "px" | "vw" | "vh" | "rem" | "em" | "%" | "deg" | "s" | "ms";
export type ValueType = "number" | "string" | "boolean";
export type Tier = "basic" | "advanced";

interface Base {
  binds: string;
  title: string;
  tier?: Tier;
  note?: string;
  /** true = ranges/notes are still an auto guess awaiting human curation. */
  curate?: boolean;
}

export interface NumberControl extends Base {
  kind: "number";
  /** underlying prop type — drives serialization (see `serialize`). Default "number". */
  valueType?: Extract<ValueType, "number" | "string">;
  defaultValue: number;
  min: number;
  max: number;
  step: number;
  /** display + (when valueType==="string") serialization suffix. */
  unit?: CssUnit;
  /** Theatre.js-style drag sensitivity for fine motion tuning. */
  nudge?: number;
}

export interface EnumControl extends Base {
  kind: "enum";
  valueType?: ValueType;
  defaultValue: string | number;
  options: { label: string; value: string | number }[];
}

export interface BooleanControl extends Base {
  kind: "boolean";
  valueType?: "boolean";
  defaultValue: boolean;
}

export interface ColorControl extends Base {
  kind: "color";
  valueType?: "string";
  defaultValue: string;
}

/** Props that are NOT sliders: content (routed to the Editable layer) or structural
 *  (JSON-only). Declared so a manifest stays exhaustive over the component's props. */
export interface NonControl {
  kind: "content" | "structural";
  binds: string;
  /** copy-layer = editable text/list · image-layer = media · slot = composed in JSX. */
  routeTo?: "copy-layer" | "image-layer" | "slot";
  /** content that is an array (editable list) rather than a scalar. */
  list?: boolean;
  note?: string;
}

export type Control = NumberControl | EnumControl | BooleanControl | ColorControl;
export type ManifestEntry = Control | NonControl;

export interface ControlManifest {
  component: string;
  entries: ManifestEntry[];
  /** cross-prop invariants the editor enforces live (slider clamping). */
  constraints?: { rule: string; note?: string }[];
}

/**
 * The `--site-*` theming contract is a SITE-LEVEL control set (one per site, not per
 * component instance) — the editor renders these as a single "Theme" panel. Kept here
 * so the theme panel is also manifest-driven. Mirrors the `--site-*` theming contract.
 */
export const SITE_TOKENS: ColorControl[] = [
  { kind: "color", binds: "--site-paper", title: "Paper (bg)", defaultValue: "#faf9f5" },
  { kind: "color", binds: "--site-ink", title: "Ink (text/marks)", defaultValue: "#141413" },
  { kind: "color", binds: "--site-muted", title: "Muted (secondary)", defaultValue: "#6b6b6b" },
  { kind: "color", binds: "--site-hairline", title: "Hairline (dividers)", defaultValue: "rgba(0,0,0,0.15)" },
  { kind: "color", binds: "--site-accent", title: "Accent (highlight)", defaultValue: "#d97757" },
];

/** The one place widget value + prop type turn into the value written to site-content.json. */
export function serialize(c: Control, value: number | string | boolean): number | string | boolean {
  if (c.kind === "number" && c.valueType === "string") return `${value}${c.unit ?? ""}`;
  return value; // number / boolean / enum literal / color string write through as-is
}

export function isControl(e: ManifestEntry): e is Control {
  return e.kind === "number" || e.kind === "enum" || e.kind === "boolean" || e.kind === "color";
}
