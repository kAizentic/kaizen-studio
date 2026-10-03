# Runtime architecture

The bench (`templates/rig-bench.html`) is a config-driven driver. Generalized from the proven
diagonal-border-sweep prototype; do not reinvent it — fill its `RIG` block and go.

## The clock-agnostic core
A single normalized clock `t ∈ [0,1]` drives everything. Nothing downstream knows what moves it, so
the **Time/Scroll axis toggle is nearly free**:
- **Time** — a `requestAnimationFrame` loop advances `t` over an adjustable duration (play/pause/loop).
- **Scroll** — a scroll position maps to `t`.
Both call the same `applyClock(t)`. This is the load-bearing insight from the prototype — and
it's why building beats adopting Theatre.js for scroll-native work.

`applyClock(t)`:
1. `RIG.preview.render({ knobs, clock:t })` — the real animation, at this clock + knob values.
2. `applyContent(t)` — evaluate the independent content tracks and set element styles.
3. update playhead + run validity checks.

## Knobs
`knobs: [{ key, label, min, max, step, def, tip, rebuild?, validity? }]`. Rendered as labelled sliders
with the JSDoc as a hover tooltip (dotted-underline affordance). `knob[key]` holds the live value.
`rebuild:true` re-runs `preview.build?.()` on change (structural knobs like layer count).

## Content tracks (optional, independent per-element timing)
The original feature: give *separate elements* their own timing layered over the animation.
`content: [{ id, label }]` lists riggable elements; each track is
`{ target, property (opacity|x|y|scale|rotate), from, to, start, end, easing }`. Evaluated as
`local = clamp((t−start)/(end−start))`, eased, lerped `from→to`, grouped per element into one
transform + opacity. Drag clips to retime; the inspector edits from/to/easing.

## Preview binding
`RIG.preview` is one of:

**inline** (DOM/CSS/canvas — the sweep uses this):
```js
preview: {
  mode:"inline",
  build(){ /* optional: (re)create elements when a rebuild knob changes */ },
  render({knobs, clock}){ /* drive #stage elements from knobs + clock */ },
}
```

**iframe + hook** (React/R3F/shader uniforms):
```js
preview: { mode:"iframe", url:"http://localhost:3000/__rig/diagonal-border-sweep" }
```
The target page exposes a tiny hook; the bench posts `{knobs, clock}` each frame:
```js
// in the target demo page
window.__rig = { render(knobs, clock){ /* set props/uniforms, seek timeline to clock */ } };
window.addEventListener("message", e => { const {knobs,clock}=e.data||{}; window.__rig?.render(knobs,clock); });
```
For R3F, `render` writes a uniform / object transform and the r3f loop paints it — **prove the uniform
moves before critiquing the shader** (*webgl r3f scrubbed effect debugging*).

## Validity checks (the generalized "gotcha")
Some knob combinations are invalid (the sweep: *stroke weight must exceed the peak mid-sweep gap*).
A knob may declare `validity({knobs, stage}) → { ok:boolean, msg:string }`; the bench shows a live
✓/⚠ badge. Keep the check cheap (runs on knob change), and phrase the message as the build-note rule.

## Persistence & Apply
- **localStorage** on every mutation (knob, track, dur) → a reload never wipes the tune. Boot restores it.
- **Apply** POSTs `{knob, tracks, dur}` to `serve.py` `/apply`. The server writes **call-site props only**
  (a `.usage.tsx`), optionally patches a runnable demo, and drops a JSON sidecar — it must **never**
  edit the component's default prop values. Apply is fired by the button (the hitl `confirm` gate),
  never programmatically.

## Serving
Serve the bench folder from `serve.py` (which also handles `/apply`) so the page and the write-back
endpoint share an origin (no CORS). Register the bg process; open a fresh MCP tab; screenshot to verify.
The Apply button only works from the write-back server's origin.
