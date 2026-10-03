# Changelog

## 2026-10-03 `6c03c23..48e5841`

### Added
- README: a "How this differs" section placing the rig and analyzers next to knob panels, timeline editors, write-back tools, motion linters and prop inference.

## 2026-10-03 `root..9a1e513`

### Added
- `animation-rig`: a live tuning bench that drives a component through a normalized 0-1 clock (time or scroll), auto-wires knobs from its props, and on Apply writes the tune back as call-site props.
- `analyzers/`: zero-dependency motion-hygiene lint with 21 paired regression fixtures, prop-to-control inference, and seam inference for React/TSX components.
