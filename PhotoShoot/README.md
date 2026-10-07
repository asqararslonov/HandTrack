<div align="center">

# PhotoShoot

**Real-time hand tracking in the browser — no install, no backend.**
Started as a finger-counting demo, grew into a two-hand gesture that
stacks live video filters over the feed.

[![MediaPipe](https://img.shields.io/badge/vision-MediaPipe%20Hand%20Landmarker-4285F4?style=flat-square&logo=google&logoColor=white)](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker)
[![Canvas 2D](https://img.shields.io/badge/render-Canvas%202D-F7DF1E?style=flat-square&logo=javascript&logoColor=black)](#)
[![No backend](https://img.shields.io/badge/backend-none-success?style=flat-square)](#)

</div>

```bash
python3 -m http.server 5173
open http://localhost:5173
```

Runs entirely client-side: MediaPipe (WASM/GPU) does 21-point hand landmark
detection; everything downstream — gesture recognition, physics, filters —
is plain canvas/JS.

## What it does

<div align="center">
<img src="docs/filter-stack.jpg" width="640" alt="Stacked filter frames with live hand tracking">
<br><sub>Filter frame — 7 stacked regions, live hand skeleton overlay, 30fps</sub>
</div>

<div align="center">
<img src="docs/filter-grid.jpg" width="640" alt="All eight filters">
<br><sub>The eight filters in the cycle — Grayscale through Dream</sub>
</div>

### Hand + finger detection
[`app.js`](app.js) — tracks up to 2 hands, reports which fingers are up, and
recognizes a handful of static gestures (fist, open palm, peace, pointing,
thumbs up, pinch, OK, rock, call-me). Finger state is computed from landmark
distances rather than fixed angles, so it holds up across hand rotation.

### Filter frame
[`filters.js`](filters.js) — hold an L-shape with both hands (index out,
middle curled) and the rectangle between them gets a live filter. Drop your
hands and it stays in place; frame again and a new rectangle stacks on top
with the next filter in the cycle, so the frame fills up with regions
instead of replacing the last one. In Filter Frame mode each tracked hand
gets a small **L ✓ / L ✗** readout at the wrist, so you can see which hand
the gesture check disagrees with instead of guessing.

## The interesting bugs

**Deployed, but the gesture never fired.** The first version of the
gesture check required index up *and* middle, ring, *and* pinky all fully
curled, on both hands, at once. That's much stricter than it sounds: ring
and pinky rarely curl all the way during a natural "L," and they're also
the two fingers MediaPipe reads least reliably (most self-occluded). Hand
tracking itself worked fine — the compound condition just almost never
passed. Fixed by dropping to the two signals that actually matter: index
up, middle down. Ring/pinky aren't checked at all anymore. The live L ✓/✗
badge exists specifically so this class of "tracking works, gesture
doesn't" bug is visible on-screen instead of invisible.

**The 12-stamp performance bug.**

Stacking filter regions meant running up to 12 of them per frame. Grayscale
and the other native `ctx.filter` strings cost nothing, but Posterize and
Thermal were originally per-pixel JS passes (`getImageData` → mutate →
`putImageData`) — correct, but **28ms for 12 stamps**, well past the 16.7ms
budget for 60fps.

The fix wasn't optimizing the pixel loop (it already ran on a downscaled
copy) — it was that `getImageData`/`putImageData` round-trips the GPU-backed
canvas through the CPU, and that cost scales with call count, not pixel
count. Rewriting both as SVG filters (`feComponentTransfer` for posterize,
a luminance matrix + color ramp for thermal) referenced via
`ctx.filter = "url(#id)"` keeps the whole pass on the GPU:

| | before | after |
|---|---|---|
| 12 stamps, Posterize | 28.6ms | 0.06ms (GPU work included: ~2.4ms) |
| 12 stamps, mixed filters | 14.3ms | ~2.4ms |

A second, smaller find: resizing the scratch `<canvas>` (`canvas.width = …`)
once per filter per frame — needed for the pixelate effect — reallocates the
backing store and alone cost ~30ms across 12 stamps. Allocating it once at
startup instead of per-call fixed it.

## Known gaps

- Gesture thresholds are hand-tuned heuristics, not learned — works, but is
  the obvious next thing to replace with a small trained classifier on
  landmark features.
- No persistent capture/gallery yet — this was the tracking + effects layer,
  the photo-booth flow (countdown, shutter, gallery) comes next.
