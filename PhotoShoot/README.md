# PhotoShoot

Real-time hand tracking in the browser, no install, no backend. Started as a
finger-counting demo and grew into a hand-reactive 3D particle field and a
two-hand gesture that applies live video filters.

Runs entirely client-side: [MediaPipe Hand Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker)
(WASM/GPU) does 21-point hand landmark detection; everything downstream —
gesture recognition, physics, filters — is plain canvas/JS.

```bash
python3 -m http.server 5173
open http://localhost:5173
```

## What it does

**Hand + finger detection** ([app.js](app.js)) — tracks up to 2 hands, reports
which fingers are up, and recognizes a handful of static gestures (fist, open
palm, peace, pointing, thumbs up, pinch, OK, rock, call-me). Finger state is
computed from landmark distances rather than fixed angles, so it holds up
across hand rotation.

**3D particle field** ([field.js](field.js)) — 3,000 particles in a real
depth volume, projected with perspective. Depth comes from on-screen hand
size (landmark z is measured from the wrist, not the camera, so it's useless
for this). Particles defocus into soft bokeh the further they sit from the
focal plane, and hue shifts from warm to cool with distance — the two cues
that make a point cloud read as a volume instead of a flat sprite sheet.
Open palm repels, pinch creates a swirling vortex, closing then opening a
fist fires an expanding shockwave.

**Filter frame** ([filters.js](filters.js)) — hold an L-shape with both hands
(thumb + index out) and the rectangle between them gets a live filter. Drop
your hands and it stays in place; frame again and a new rectangle stacks on
top with the next filter in the cycle, so the frame fills up with regions
instead of replacing the last one.

## The interesting bug

Stacking filter regions meant running up to 12 of them per frame. Grayscale
and the other native `ctx.filter` strings cost nothing, but Posterize and
Thermal were originally per-pixel JS passes (`getImageData` → mutate →
`putImageData`) — correct, but **28ms for 12 stamps**, well past the 16.7ms
budget for 60fps.

The fix wasn't optimizing the pixel loop (it already ran on a downscaled
copy) — it was that `getImageData`/`putImageData` round-trips the GPU-backed
canvas through the CPU, and that cost scales with call count, not pixel
count. Rewriting both as SVG filters (`feComponentTransfer` for posterize,
a luminance matrix + color ramp for thermal) referenced via `ctx.filter =
"url(#id)"` keeps the whole pass on the GPU:

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
