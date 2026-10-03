# Failure log — animation-rig

Recurring failures and the rules that prevent them. Add an entry only when a gap recurs across
runs or is a reusable technical trap — not for one-off tuning nits.

## 2026-08-07 — A bench iframe silently freezes when bench and target don't share a host, and a no-JS fallback impersonates the working page

**Symptom.** The target page, framed in the bench's `#stage`, looks broken. Two distinct
presentations, both of which read as "my component is buggy":
- *Partial freeze* — tweens sit at frame one while `gsap.set` (synchronous) still works, so **some**
  animations appear broken and others don't. A WebGL/canvas target with its own rAF loop presents as
  a still image that is nonetheless correctly composed.
- *Total impersonation* — the page renders, looks plausible, and has **zero console output**.

**Cause 1 — Chrome throttles rAF/timers in cross-*site* iframes.** `127.0.0.1` and `localhost` are
different *sites* to Chrome's site-isolation model even though both resolve to the same machine.
Framing one host from the other throttles the iframe's animation clock. Note ports are **not** part
of a site, so `localhost:8792` framing `localhost:3117` is same-site and fine — it is specifically
mixing the two *hostnames* that breaks.

**Cause 2 — Next's dev server serves HTML but not JS to hosts it doesn't recognise.** Framing
`127.0.0.1:3001` when Next only expects `localhost:3001` produced a page with no HMR handshake and
no React boot, silently rendering the site's static no-JS fallback. This is the dangerous one: **a
well-built no-JS fallback convincingly impersonates the working page**, so the failure reads as a
subtle layout bug rather than "the JS never loaded."

**The rule (now enforced, not requested).** Bench and target MUST share a hostname. Prose alone
failed here once already — per *gate enforced in the writer*, a gate in prose is a request —
so as of v1.1.0 `rig-bench.html` compares `location.hostname` against the iframe's hostname at boot
and paints a blocking banner naming both when they differ. It fails loudly instead of freezing
silently. `serve.py` also prints the `localhost` URL rather than a bare port.

**Diagnostic order, if it ever presents anyway.** Console for the HMR handshake first (rules out
cause 2), then whether `gsap.set` (sync) works while tweens don't (confirms cause 1), then whether a
lock is held with no liveness escape (an orthogonal third cause — a time-based lock whose
`onComplete` never fires because the timeline died mid-freeze; fix with a watchdog on
`tl.isActive()`).

**Standing lesson reinforced.** Screenshots taken over CDP capture the **last composited frame**, so
a frozen renderer produces convincing stills of states that were never live. Motion verdicts need
computed-style/position sampling after a settle window, never the eye.

*First hit 2026-08-07 on a portfolio-site bench build. Folded into this skill 2026-08-20 after the
trap was hit a second time, rigging a WebGL component.*

## 2026-08-20 — The bench template could only render numeric knobs, so colour/text params had to be re-added per run

**Symptom.** Rigging a component whose tunables include colour props (`paperColor`, `inkColor`,
`accentColor`) and text props (`text`, `ctaLabel`) produced a knob row of broken range sliders —
`<input type="range">` with a hex string as its value renders at the rail and reports `NaN` on input.

**Cause.** `buildKnobs()` emitted a range input unconditionally, and both `oninput` and `setKnobDom()`
ran every value through `parseFloat`/`fmt()`. There was no knob `type`.

**Why it mattered beyond the one run.** The skill already warns that "a session that re-derives ranges
re-derives that mistake." The same argument applies to knob *kinds*: leaving the gap in the template
guarantees the next session hand-patches its own copy and the fix never accumulates.

**Fix (v1.1.0).** `type: "color"` and `type: "text"` knobs are first-class in the template. Values are
kept as strings end-to-end (state init already took `k.def` uncoerced, so persistence and Apply needed
no change), and `serve.py`'s `PROPS` gained a `"str"` kind that emits a quoted JSX prop.
