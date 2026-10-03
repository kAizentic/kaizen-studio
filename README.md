# kaizen-studio

Tooling for building motion components the way you'd build any other software: tune them against
the real running code, then lint them for the motion defects that are easy to ship and hard to see.

Two parts:

- **`skills/animation-rig/`** — a live tuning bench for any animation. It drives the real component
  through a normalized `0→1` clock (time loop or scroll, swappable), auto-wires knobs from the
  component's props, and on **Apply** writes the tune back as call-site props. It never touches the
  component's own defaults.
- **`analyzers/`** — zero-dependency static checks over React/TSX components: motion hygiene,
  prop-to-control inference, and the component's "seam" (the interface a caller changes from outside).

The components these tools were built against are on the live demo site:
**[mrmichael-parts-bin.netlify.app](https://mrmichael-parts-bin.netlify.app/)**.

## What's here

| Path | What it is |
|---|---|
| `skills/animation-rig/SKILL.md` | The rig as an agent skill: workflow, rules, and the Apply contract. |
| `skills/animation-rig/templates/rig-bench.html` | The bench UI: scrubbing timeline, knob panel, Time/Scroll playhead, content tracks. |
| `skills/animation-rig/templates/serve.py` | The local write-back server behind Apply (stdlib only). |
| `skills/animation-rig/references/` | The binding model (how props become knobs) and the clock-agnostic runtime. |
| `skills/animation-rig/FAILURE_LOG.md` | Traps that cost real debugging time, and the rules that now prevent them. |
| `analyzers/motion-checks.mjs` | Per-component motion lint: layout-property animation, duration/easing sprawl, uniform scale-to-zero, timer-driven animation, removed focus rings, `will-change` overuse, undecorated canvases. |
| `analyzers/infer-controls.mjs` | Reads a component's props and emits a candidate control manifest (widget kind, value type, unit, range guess). |
| `analyzers/infer-seam.mjs` | Derives the component's token seam (`--site-*` vars) and prop seam, and flags seam smells. |
| `analyzers/controls-schema.ts` | The control-manifest type the inferred manifests target. |

## Quick start

Requires Node 18+ (analyzers) and Python 3 (the rig's write-back server). No npm install.

```bash
node analyzers/motion-checks.test.mjs                 # 21 paired regression fixtures
node analyzers/motion-checks.mjs path/to/Hero.tsx     # human report; add --json for machines
node analyzers/infer-controls.mjs path/to/Hero.tsx --stdout
node analyzers/infer-seam.mjs path/to/Hero.tsx --stdout
```

The analyzers parse one idiom exactly, `export default function Name({ a = d, ... }: { a?: T; ... })`,
rather than being a general TypeScript parser. Anything outside that shape is flagged, not guessed.

## Two ideas it rests on

**The clock is the only thing the rig owns.** Every animation is driven by one normalized `0→1`
value, so swapping a time loop for scroll position is nearly free, and the rig never re-implements
the animation it's tuning. It moves the playhead and nothing else.

**A screenshot of motion is not evidence.** A still of a mid-flight animation is pixel-identical
to one that never started, and a throttled cross-site iframe will freeze a preview while it still
looks composed. The rig verifies motion by sampling computed style and position after a settle
window. `FAILURE_LOG.md` has the two cases that made this a rule.

## Credits

`analyzers/motion-checks.mjs` takes its central idea, that motion hygiene is greppable, from
[AThevon/genjutsu](https://github.com/AThevon/genjutsu)'s `design-audit` (MIT). The implementation
is a re-authored pass, not a copy.

## License

Source-available, not open source. See [LICENSE](LICENSE).
