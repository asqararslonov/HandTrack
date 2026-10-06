<div align="center">

# Constellation

**Your hands as a live network.** Every joint is a node, fingertips wire
together into a mesh, and whichever fingers you raise close into a filled
shape.

[![MediaPipe](https://img.shields.io/badge/vision-MediaPipe%20Hand%20Landmarker-4285F4?style=flat-square&logo=google&logoColor=white)](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker)
[![Canvas 2D](https://img.shields.io/badge/render-Canvas%202D-F7DF1E?style=flat-square&logo=javascript&logoColor=black)](#)
[![No backend](https://img.shields.io/badge/backend-none-success?style=flat-square)](#)

<img src="docs/mesh-demo.jpg" width="640" alt="Two hands meshed together, one forming a triangle, bridged by a dashed line between matching fingertips">
<br><sub>Right hand: 3 fingers → triangle. Left hand: 2 fingers → line. Matching index fingertips bridge across both hands.</sub>

</div>

```bash
python3 -m http.server 5174
open http://localhost:5174
```

Same MediaPipe Hand Landmarker base as [PhotoShoot](../PhotoShoot), rebuilt
around one idea: don't just draw the skeleton, wire everything together.

## What it does

**Skeletal bones** — the standard 21-point hand graph, drawn faint, as a
backdrop.

**Fingertip mesh** — every fingertip connects to every other fingertip
within the same hand (10 lines), gradient-colored between each pair, with
opacity scaled by distance. Bring fingers together and the mesh between
them visibly tightens.

**Raised-finger shapes** — whichever fingers are extended close into a
filled polygon: 1 finger is a point, 2 a line, 3 a triangle, 4 a quad, 5 a
pentagon. Points are ordered by angle around their centroid before filling,
so the shape never self-intersects no matter how the hand is rotated —
following anatomical finger order instead would cross lines the moment
fingers spread unevenly.

**Cross-hand bridges** — with two hands visible, matching raised fingers
(both index, both pinky, etc.) connect with a pulsing dashed line. Bring
both palms close enough and a "⚡ Hands linked" badge lights up.

**Pulsing, velocity-reactive nodes** — every joint breathes gently via a
sine pulse, and fast-moving joints swell larger, so quick gestures leave a
brief glow.

**Fading trails** — raised fingertips leave a short trail as they move;
drop the finger and the trail shrinks back to nothing over about half a
second rather than vanishing instantly.

## Why this needed its own project

It reuses the same finger-state detection as PhotoShoot (distance-based,
not angle-based, so it holds up across rotation), but the rendering model is
different enough to be its own thing: PhotoShoot treats hands as *input* to
effects elsewhere in the frame; this treats the hand itself as the subject —
everything drawn is derived directly from the 21 landmarks, nothing else on
screen.

## Known gaps

- Polygon fill is a flat color per finger-count, not derived from which
  specific fingers are raised — holding thumb+pinky+middle looks identical
  to index+middle+ring, both just "triangle."
- No persistence — nothing is captured or saved, this is the live-tracking
  layer only.
