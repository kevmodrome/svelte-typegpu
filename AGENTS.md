# Renderer Development

Follow `/Users/kevin/.codex/RTK.md` for shell commands.

## Performance Is a Correctness Requirement

- Changes to rendering, reactivity, motion, lifecycle, or scheduling must include
  tests for frame delivery, not only final scene values or resource contents.
- Exercise 60, 120, and 144 Hz clocks. Test external animation callbacks both
  before and after the renderer callback; do not assume a fixed callback order.
- For Svelte motion integration, include a real compiled component and the real
  Tween/Spring producer with a controlled clock where practical. Verify frames
  are not skipped, duplicated, or deferred indefinitely.
- Demand mode must stop after work settles, manual mode must never schedule RAF,
  and disposal must cancel pending work. Do not fix cadence by keeping an idle
  renderer running or introducing a competing animation loop.
- Assert affected instance counts, upload ranges, buffer/bind-group/pipeline
  reuse, and bounded allocations for performance-sensitive paths.
- Check a live example before and after scheduling changes. Separate browser
  callback rate, rendered frames, CPU work, and GPU throughput; passing synthetic
  clock tests does not establish the physical monitor's refresh rate.
