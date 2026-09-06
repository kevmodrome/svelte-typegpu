# Preview performance

The docs shell must settle alongside a demand-rendered scene. A renderer's Idle
badge reports scene work, not background CSS painting or other browser GPU work.
The shell retains its static grid and short brand-hover transition, but no infinite
decorative CSS animation. `apps/docs/src/app-source.test.ts` parses the stylesheet
and rejects infinite animation declarations, including inside media queries.

## Startup investigation

On 2026-09-06, desktop Chromium headless shell 1228 with the SwiftShader WebGPU
adapter intermittently stalled in `requestAdapter` or `requestDevice` with normal
motion preferences. Both Reactive Collections and Svelte Motion started with the
reduced-motion preference. Their native GPU request options were identical.

A same-page intervention isolated the full-screen masked `grid-drift` background:

- Reactive Collections was still awaiting `requestDevice` after 10 seconds.
- Overriding only `.site-frame::before { animation: none }` let the existing
  request complete and the preview become ready within 375 ms.
- The browser preference remained normal; there was one adapter request, no
  renderer restart, and no JavaScript error.
- Svelte Motion started before intervention in that run. The stall is intermittent,
  not an assertion that CSS animations always prevent WebGPU initialization.

Removing the animation and its unused keyframes leaves renderer scheduling,
Svelte motion policy, TypeGPU initialization and GPU request options unchanged.
The source regression failed before removal and passed afterward.

## Rendered verification

After removal, both examples started with `prefers-reduced-motion: no-preference`
at 1440x1000 and 390x844. Browser checks asserted the computed background animation
was `none`; failing to become GPU-ready was a failure, not a skipped pixel check.

Reactive Collections passed height editing, shared checkbox selection,
add/remove/reset, desktop/mobile layout, nonblank canvas pixels and selection pixel
changes. Svelte Motion passed intermediate/final movement pixels, mid-animation
reduced-motion cancellation, unchanged-target re-enabling, stable settled pixels,
no further submissions at idle, and stable resource counts (10 buffers, 6 bind
groups and 2 render pipelines). Screenshots were inspected at both sizes; neither
example produced a page error.

The motion probe measured 9 rendered frames over 10 callback timestamps on desktop
and 63 over 64 on mobile, with no duplicate submissions per timestamp. The single
initial callback without a submission is tracked separately. Median measured
renderer RAF CPU time was 0.2/0.1 ms; browser callback rates were about 6.5/39.2 Hz.
These are software-GPU observations, not physical display or hardware throughput
benchmarks. Controlled-clock tests separately cover 60/120/144 Hz, both producer
orders, demand/manual rendering, upload ranges, resource reuse and disposal.

## Rechecking

Test both motion preferences on the served examples, not only unit fixtures.
Measure native adapter/device readiness before scene pixels. For motion, record
browser callback timestamps separately from queue submissions and renderer CPU
time; compare frame delivery against callbacks, not a fixed software-GPU FPS floor.
Check that demand rendering actually stops once motion settles. Inspect desktop
and mobile screenshots for framing and changed pixels, and reject page errors.

Physical refresh-rate verification still requires an unlocked Mac and a native
browser on the target display. Passing this software-WebGPU check does not close
that gate or justify claims of 120/144 Hz hardware performance.
