# kaizen-studio

Tooling for building motion components the way you'd build any other software: tune them against
the real running code, then lint them for the motion defects that are easy to ship and hard to see.

Two parts:

- **`skills/animation-rig/`** - a live tuning bench for any animation. It drives the real component
  through a normalized `0→1` clock (time loop or scroll, swappable), auto-wires knobs from the
  component's props, and on **Apply** writes the tune back as call-site props. It never touches the
  component's own defaults.
- **`analyzers/`** - zero-dependency static checks over React/TSX components: motion hygiene,
  prop-to-control inference, and the component's "seam" (the interface a caller changes from outside).

Some components built with these tools:
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

## How this differs

There are good tools nearby. This is where the line falls.

**Knob panels** ([Leva](https://github.com/pmndrs/leva), [Tweakpane](https://github.com/cocopon/tweakpane),
[lil-gui](https://github.com/georgealways/lil-gui)) give you live controls, but the tuned values stay
in the browser. Copying them back into code is your job. The rig's Apply writes them for you.

**Timeline editors** ([Theatre.js](https://github.com/theatre-js/theatre)) are built for authoring:
you build the animation in the editor and load its state at runtime. The rig works the other way
round. The animation is already written in code, and the bench only drives its clock and tunes its
props.

**Write-back tools** are the closest relatives, and each makes a different trade:

| | Setup in your component | What gets written | Engine |
|---|---|---|---|
| [tweakr](https://github.com/angelolibero/tweakr) | declare levers with `defineTweaks()` | the literal inside the component | React + Vite |
| [transitions.dev `refine`](https://github.com/Jakubantalik/transitions.dev/tree/main/refine) | none (injected into the running app) | transition timings, by a coding agent | CSS / Motion transitions |
| [loupe](https://github.com/arinze-clinton/loupe-motion) | wrap scenes in a `TimelineProvider` | notes for you or an agent, not code | Framer Motion |
| **animation-rig** | none (knobs are read from existing props) | **call-site props** in a `<Component>.usage.tsx`, never the component's defaults | GSAP, canvas, WebGL; time *or* scroll playhead |

Writing to the call site is deliberate. A component in a library has many callers, and a tune is
almost always about one of them, so it belongs where that caller lives.

**Motion linters.** [react-doctor](https://github.com/millionco/react-doctor) flags layout-property
animation and permanent `will-change` in React (on Motion element props and `element.animate()` calls), and
[stylelint-high-performance-animation](https://github.com/kristerkari/stylelint-high-performance-animation)
does the same for CSS. `motion-checks` reads the vars inside GSAP tween calls (`gsap.to/from/fromTo`),
which neither covers. It also adds per-component duration and easing sprawl, and every check ships
with a legitimate twin it must not flag.

**Prop inference.** [react-docgen](https://github.com/reactjs/react-docgen) (what Storybook uses) is
the general-purpose version of `infer-controls` and handles far more TypeScript. `infer-controls`
parses one component shape exactly and adds what a tuning panel needs on top: units read from prop
names, a range guess, and whether the prop is safe to expose.

## Credits

`analyzers/motion-checks.mjs` takes its central idea, that motion hygiene is greppable, from
[AThevon/genjutsu](https://github.com/AThevon/genjutsu)'s `design-audit` (MIT). The implementation
is a re-authored pass, not a copy.

## License

Source-available, not open source. See [LICENSE](LICENSE).
