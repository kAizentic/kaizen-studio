# Binding model — B (auto-wire) with A (declared) override

The rig binds to a target animation by producing a `RIG` config (knobs + content + preview + apply).
Two sources, with a fixed precedence: **declared (A) overrides inferred (B)**.

## B — auto-wire from the target's props (primary)

You (Claude) read the target and synthesize knobs. This is reliable *because a model reads the file* —
there is no brittle static parser to maintain.

For a React/TS component, read the destructured props + their JSDoc, e.g. from `DiagonalBorderSweep.tsx`:

```tsx
leadFinish = 0.93,   // /** scroll-fraction at which the LEADING layer reaches the edge; higher = tighter fan */
weightThin = 52,     // /** trailing-layer stroke px — keep ABOVE the peak mid-sweep gap */
```

→ becomes a knob:

```js
{ key:"leadFinish", label:"leadFinish", def:0.93, min:0.75, max:1, step:0.01,
  tip:"Scroll-fraction at which the leading layer parks; higher = tighter fan." }
```

### Range-inference heuristics
Infer `min/max/step` from the default's value and kind:

| Default looks like | Inferred range | step |
|---|---|---|
| a `0..1` fraction (`0.93`, `0.78`) | `[max(0, def−0.2 or 0.4 floor), 1]` | `0.01` |
| a small integer count (`5`) | `[max(1, def−2), def+2]` | `1` |
| a pixel size (`52`, `60`) | `[round(def×0.2), round(def×1.7)]` | `1` |
| a multiplier/scale (`1`, `1.5`) | `[0, def×2 or 2]` | `0.05` |
| degrees (`270`, `360`) | `[0, 360]` (or `def×1.5`) | `5` |
| a vh/px distance (`360`) | `[def×0.3, def×1.6]` | `10` |

Rules:
- **Tooltip = the JSDoc**, trimmed to one curt line. Every knob explains itself on hover.
- **Skip non-shape params:** `children`, `current`/`next` content, `className`, refs, callbacks.
- **`rebuild: true`** for knobs that change structure (layer count, element count) so the preview
  rebuilds rather than just re-renders.
- **Unknowable bounds → `needsRange: true`** and ask the user; never invent a wild range.

## A — declared config (override / supplement)

If the user provides `rig.config.js` (or declares any of the below inline), it wins. Shape:

```js
export default {
  target: "DiagonalBorderSweep",
  knobs: [ /* full or partial knob objects — merged by `key`, declared fields win */ ],
  content: [ { id:"n-title", label:"Next · title" } ],   // independent per-element tracks
  preview: { mode:"inline"|"iframe", /* … see runtime.md */ },
  apply: { usagePath:"…/DiagonalBorderSweep.usage.tsx", demoPath:"…/diagonal-border-sweep.html",
           sidecarPath:"…/rig-tunes/diagonal-border-sweep.json" },
};
```

Merge rule: for each knob `key`, start from the inferred knob, then deep-override with the declared
fields. Declared-only knobs are added. A declared `preview`/`apply` replaces the inferred one wholesale.

**When A is required (B can't infer):**
- a param whose sensible range isn't derivable from its default,
- **preview mounting** — how/where the real animation renders (esp. React/R3F, which need the iframe+hook),
- **canvas / R3F-uniform targets** — the knob drives a uniform, not a DOM style,
- **per-knob validity** — a constraint like the sweep's *stroke weight must beat the peak mid-sweep gap*
  (see `runtime.md` → validity checks).
