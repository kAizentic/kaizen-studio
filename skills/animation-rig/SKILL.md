---
id: animation-rig
name: animation-rig
provenance: authored
slug: animation-rig
description: "Live parametric tuning bench for any animation/component: scrub a timeline, drag knobs, hit Apply to write tuned call-site props back to the code. Auto-wires knobs by reading the target's props; falls back to declared config. Trigger: /animation-rig, 'rig/tune this animation', 'knobs for this component'."
version: 1.1.0
category: Coding
status: active
hitl_gate: confirm
tags: [motion, tuning, bench, scrub, design]
inputs:
  - a target animation/component (a .tsx/.jsx component, a DOM/canvas animation, or an R3F effect) — optionally a rig.config.js declaring knobs/preview/write-targets
outputs:
  - an interactive rig bench (served locally) + on Apply, a `<Component>.usage.tsx` call-site file, an optional demo patch, and a JSON tune sidecar
tools: [Read, Write, Edit, Bash, mcp__claude-in-chrome]
triggers:
  - /animation-rig
  - rig this animation
  - tune this component live
  - give me knobs for this
  - live control over an animation's timing
dependencies: []
composes_with: []
references: [binding-model, runtime]
owner: the operator
last_updated: 2026-08-20
---

# Animation Rig

Stand up an interactive **tuning bench** for an animation you're building — a scrubbing timeline,
live knob controls, a live preview, and a Time/Scroll playhead toggle — dial the parameters by
feel, then **Apply** writes the tune back to the code as **call-site props** (it never mutates the
component's own defaults). The bench is a *driver*, not a re-implementation: the real animation runs,
the rig moves a normalized `0→1` clock through it.

Core model: one **clock-agnostic** `0→1` axis drives everything, so swapping the playhead between a
time loop and scroll position is nearly free. Knobs are the animation's *shape* parameters; optional
**content tracks** give separate DOM elements their own independent `from→to / start→end / easing`
timing layered over the animation. See `references/runtime.md`.

## Workflow

### Step 1 — Locate the target
Identify what's being rigged: a component file (`*.tsx`), a DOM/canvas animation, or an R3F effect.
Confirm the exact file/symbol before wiring.

### Step 2 — Auto-wire the knobs (PRIMARY — Option B)
**Read the target and generate the knob set from its parameters** — you do this, not a brittle parser:
- Extract each tunable prop/parameter: its **key**, **default value**, and **JSDoc/comment** (→ the
  knob's hover tooltip).
- **Infer the control range** from the default + type (heuristics in `references/binding-model.md`:
  e.g. a `0.93` fraction → `[0.75,1] step .01`; a `52`px weight → `[10,90] step 1`; an int count →
  `±2 step 1`). When a range is genuinely unclear, mark the knob `needsRange` and ask — don't guess wildly.
- Skip params that aren't shape/timing knobs (children, refs, className, `current`/`next` content).
- **Knob kinds.** Default is a numeric range. The template also renders `type: "color"` (a swatch
  picker) and `type: "text"` (a free-text field, width via `size`); both keep their value as a
  **string** end-to-end, and `serve.py`'s `PROPS` takes kind `"str"` to emit a quoted JSX prop.
  Use them — a colour or label param forced through a range slider renders at the rail and reports
  `NaN`, and hand-patching the bench per run means the fix never accumulates.

### Step 3 — Apply declared overrides (FALLBACK — Option A)
**Look for `rig.config.json` NEXT TO the target first — if one exists, the rig is already configured
and you must not re-derive any of it.** It is colocated with the target on purpose: the rig's own
`serve.py` is regenerated per session, so anything held there had to be re-pointed every time, and a
tune could silently land in the wrong place. A durable config makes the session-local setting exactly
one line: which target directory to rig.

```jsonc
{
  "target": "my-effect",
  "knobsFile": "index.html",          // the file whose KNOBS block Apply rewrites
  "writes": {                          // relative → resolved against this config; absolute → as-is
    "sidecar":  "../../rig-tunes/my-effect.json",
    "demoTune": "C:/…/my-site/app/tunes/my-effect.json"   // reaches a DEPLOYABLE repo
  },
  "reference": "…/reference.png",     // optional: what the bench measures against
  "decimals":  { "uRimGain": 2 },     // write precision per knob; default 3
  "knobs": [ { "key": "uCurve", "label": "curvature", "min": 0, "max": 2, "step": 0.005, "tip": "…" } ]
}
```

Serve it at `GET /config` (knobs) and `GET /targets` (write paths) so the **bench reads both from the
server** rather than carrying its own copy — a copy in the bench is how the two drift.

**Carry ranges and tooltips, never values.** The target file's own knob block stays the single source
of truth for current values, and the bench adopts them at boot. Ranges are the durable knowledge worth
keeping: a knob a user pins at its rail is a bug report about the range, and a session that re-derives
ranges re-derives that mistake.

Otherwise (no config): infer per Step 2, and **write a `rig.config.json` at the end** so the next
session doesn't start from nothing. Declared always wins over inferred.

### Step 4 — Bind the preview
Pick how the real animation renders in the bench (`references/runtime.md`):
- **inline** — a `render(state)` that drives elements in the bench's `#stage` (best for DOM/CSS/canvas;
  the reference sweep uses this).
- **iframe + hook** — point at the component's own runnable demo and drive it via `postMessage` to a
  tiny `window.__rig.render(knobs, clock)` hook the component exposes (best for React/R3F, incl. shader
  uniforms — pairs with *webgl r3f scrubbed effect debugging*: prove the uniform moves first).

> **SAME-HOST REQUIREMENT (iframe mode) — this has bitten twice; see `FAILURE_LOG.md`.**
> The bench and the target **must share a hostname**. Chrome treats `localhost` and `127.0.0.1` as
> different *sites*, and throttles `requestAnimationFrame` inside a cross-site iframe: the preview
> **freezes at frame one while still looking correctly composed**, which reads as a broken component
> rather than a broken harness. Ports are *not* part of a site, so `localhost:8792` framing
> `localhost:3117` is fine — mixing the two hostnames is what breaks.
> A second, nastier variant: Next's dev server serves HTML but **not JS** to a host it doesn't
> recognise, so the target silently renders its static no-JS fallback, which convincingly
> impersonates the working page (tell: an empty console where `[HMR] connected` should be).
> As of v1.1.0 the template **enforces** this rather than asking — it compares `location.hostname`
> against the iframe's and paints a blocking banner naming both when they differ. Don't remove it;
> the prose version of this rule already existed and was violated anyway
> (*gate enforced in the writer*).

### Step 5 — Assemble & serve
Fill the `RIG` config block in `templates/rig-bench.html` (knobs, content, preview, apply) and set
`serve.py`'s write-targets for this component. Serve over localhost (register the bg process with
`bg-run`), open a fresh browser tab **at `http://localhost:<port>/rig-bench.html`** — never
`127.0.0.1`, per the same-host requirement above — and screenshot to confirm it rendered. Never use
`file://`.

### Step 6 — Tune → Apply  (the gate)
The user tunes, then clicks **✓ Apply**. Apply POSTs the tune to `serve.py`, which writes:
`<Component>.usage.tsx` (call-site props), an optional demo patch, and a JSON sidecar. **Apply is the
human-triggered confirmation** — never fire it programmatically or apply on the user's behalf without
the click. Standing up the bench is read-only; only Apply writes.

### Step 7 — Record
Record the tuned result as the component's new canonical tune (commit the sidecar and the
`.usage.tsx` call site). If you promoted a hardcoded constant to a real prop to make it tunable, say so.

## Rules

**MUST:**
- Auto-wire from the target's real props first; treat declared config as the override layer on top.
- Preserve the **clock-agnostic** runtime — the animation is driven, not reimplemented.
- Keep Apply **human-triggered**; it writes **call-site props only**, never the component's defaults.
- Carry each prop's JSDoc into its knob tooltip; every knob explains itself on hover.
- Register any background server (`bg-run`); open results over localhost + screenshot to verify.
- In iframe mode, **serve the bench on the same hostname as the target** and open it at that
  hostname. A cross-site frame throttles rAF and the preview freezes while looking composed.
- Verify a motion preview by **measurement after a settle window** (computed style / position /
  pixel readback), never by a still. CDP screenshots capture the last composited frame, so a frozen
  renderer yields convincing images of states that were never live.

**MUST NEVER:**
- Programmatically click Apply or write tuned values without an explicit user action.
- Mutate the target component's default prop values (call-site is the contract).
- Invent a knob range when a param's bounds are unknowable — mark it and ask.
- Leave a preview element stuck invisible; a driven animation must be legible at every clock value.

## Cost Class
**Heavy** — ships a runtime (templated bench HTML + Python write-back server), plus references and the
sweep fixture. Load `references/*` only at the step that needs them; `templates/*` are copied per run.

