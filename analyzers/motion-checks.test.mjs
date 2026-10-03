#!/usr/bin/env node
/**
 * motion-checks.test.mjs — regression fixtures for the motion-hygiene checks.
 *
 * WHY THIS FILE EXISTS: every check here has a "correct" case that looks almost identical to the
 * defect, and a real component library usually contains only ONE side of each pair. Running the checks against
 * the library therefore cannot prove they discriminate — a check that flagged everything and a check
 * that flagged the right things produce the same output on the day you write them. Each pair
 * below is a defect + its legitimate twin, and both assertions matter.
 *
 * Every case is a REAL shape that appeared during the 2026-08-01 port, not an invented example:
 * the gsap.set and scale-direction pairs are the two false-positive classes actually caught.
 *
 * Zero deps, matching the rest of scripts/:  node motion-checks.test.mjs
 */
import { motionOf } from "./motion-checks.mjs";

const has = (src, check) => motionOf(src, "t").findings.some((f) => f.check === check);

const CASES = [
  // ── scale_to_zero: DIRECTION is the whole check ────────────────────────────
  ["scale: entrance fromTo (ScrubRevealGrid shape) is fine", "scale_to_zero",
    'tl.fromTo(img, { scale: 0 }, { scale: 1, transformOrigin: "0% 0%", ease: "power3.out" }, 0);', false],
  ["scale: gsap.from({scale:0}) is an entrance", "scale_to_zero",
    "gsap.from(el, { scale: 0, duration: 0.4 });", false],
  ["scale: .to({scale:0}) is an exit — flag", "scale_to_zero",
    "gsap.to(modal, { scale: 0, opacity: 0, duration: 0.3 });", true],
  ["scale: fromTo destination 0 is an exit — flag", "scale_to_zero",
    "tl.fromTo(el, { scale: 1 }, { scale: 0, duration: 0.3 });", true],
  ["scale: exit survives a nested scrollTrigger block", "scale_to_zero",
    "gsap.to(el, { scale: 0, scrollTrigger: { trigger: x, scrub: true } });", true],
  ["scale: CSS scale(0) resting state — flag", "scale_to_zero",
    ".card-exit { transform: scale(0); }", true],
  ["scale: CSS scale(0.95) is the correct floor", "scale_to_zero",
    ".card-exit { transform: scale(0.95); opacity: 0; }", false],
  ["scale: axis wipe scaleX(0) is the bin's wipe idiom", "scale_to_zero",
    ".bar { transform: scaleX(0); transform-origin: left; }", false],

  // ── layout_animation: gsap.set assigns once, it does not animate ───────────
  ["layout: gsap.set for static sticky-track setup is fine", "layout_animation",
    'gsap.set(scene.current, { position: "sticky", top: 0, height: "100vh", width: "100vw" });', false],
  ["layout: a real height tween reflows every frame — flag", "layout_animation",
    'tl.fromTo(m, { height: 0 }, { height: "60vh", duration: 1, ease: "power2.inOut" }, t);', true],
  ["layout: CSS transition on height — flag", "layout_animation",
    ".drawer { transition: height 0.3s ease; }", true],
  ["layout: transition: all — flag", "layout_animation",
    ".x { transition: all 0.2s ease; }", true],
  ["layout: transform/opacity transition is correct", "layout_animation",
    ".x { transition: transform 0.3s ease-out, opacity 0.3s ease-out; }", false],
  ["layout: a style object is not a tween", "layout_animation",
    'return <div style={{ height: "100%", width: "100%" }} />;', false],

  // ── decorative_no_aria ─────────────────────────────────────────────────────
  ["aria: bare canvas — flag", "decorative_no_aria",
    "<canvas ref={canvasRef} style={{ position: 'absolute' }} />", true],
  ["aria: canvas with aria-hidden is fine", "decorative_no_aria",
    '<canvas ref={canvasRef} aria-hidden="true" />', false],

  // ── focus_ring_removed ─────────────────────────────────────────────────────
  ["focus: outline:none with no replacement — flag", "focus_ring_removed",
    ".btn { outline: none; }", true],
  ["focus: outline:none WITH :focus-visible is fine", "focus_ring_removed",
    ".btn { outline: none; } .btn:focus-visible { outline: 2px solid var(--site-ink); }", false],

  // ── timer_driven ───────────────────────────────────────────────────────────
  ["timer: setInterval driving motion — flag", "timer_driven",
    "setInterval(() => { el.style.transform = `translateX(${x}px)`; }, 16);", true],
  ["timer: setTimeout that only sets React state is fine", "timer_driven",
    "setTimeout(() => setReady(true), 200);", false],

  // ── comments must not be read as code ──────────────────────────────────────
  ["comments: a commented-out defect is not a defect", "layout_animation",
    "/* .drawer { transition: height 0.3s ease; } */ const a = 1;", false],
];

let pass = 0, fail = 0;
for (const [name, check, src, want] of CASES) {
  const got = has(src, check);
  if (got === want) { pass++; continue; }
  fail++;
  console.log(`FAIL  ${name}\n      check=${check} expected=${want} got=${got}`);
}
console.log(`\nmotion-checks: ${pass}/${CASES.length} passed${fail ? `, ${fail} FAILED` : ""}`);
process.exit(fail ? 1 : 0);
